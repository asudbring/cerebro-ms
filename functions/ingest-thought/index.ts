/**
 * ingest-thought — Azure Function
 *
 * Receives a thought via HTTP POST, generates an embedding,
 * extracts metadata, stores in PostgreSQL, and returns a reply.
 *
 * Called by Power Automate when a keyword is detected in Teams.
 * Also callable directly via API key for testing.
 *
 * Accepts two formats:
 *   1. Power Automate: { "text": "...", "from": "Person Name" }
 *   2. Legacy Teams webhook: { "text": "<at>Brain</at> ...", "from": { "name": "..." } }
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { generateEmbedding, extractMetadata } from "../lib/azure-openai.js";
import { insertThought, searchOpenTasks, searchDoneTasks, markThoughtDone, reopenThought } from "../lib/database.js";

/**
 * Check if text starts with a completion keyword prefix.
 * Returns the description portion if matched, or null.
 */
function extractCompletionPrefix(text: string): string | null {
  const prefixes = ["done:", "completed:", "finished:", "shipped:", "closed:"];
  const lower = text.toLowerCase();
  for (const prefix of prefixes) {
    if (lower.startsWith(prefix)) {
      return text.slice(prefix.length).trim();
    }
  }
  return null;
}

/**
 * Check if text starts with a reopen keyword prefix.
 * Returns the description portion if matched, or null.
 */
function extractReopenPrefix(text: string): string | null {
  const prefixes = ["reopen:", "undo:", "not done:", "re-open:", "unfinish:"];
  const lower = text.toLowerCase();
  for (const prefix of prefixes) {
    if (lower.startsWith(prefix)) {
      return text.slice(prefix.length).trim();
    }
  }
  return null;
}

/**
 * Strip any @mention XML tags from the message text.
 */
function stripBotMention(text: string): string {
  return text.replace(/<at>.*?<\/at>\s*/gi, "").trim();
}

/**
 * Format the captured metadata into a reply string.
 */
function formatReply(metadata: Record<string, unknown>): string {
  const parts: string[] = [];

  const title = metadata.title || "Untitled";
  const type = metadata.type || "other";
  parts.push(`**Captured** as \`${type}\` — ${title}`);

  const people = metadata.people as string[] | undefined;
  if (people && people.length > 0) {
    parts.push(`**People:** ${people.join(", ")}`);
  }

  const actions = metadata.action_items as string[] | undefined;
  if (actions && actions.length > 0) {
    parts.push(`**Action items:** ${actions.join("; ")}`);
  }

  const tags = metadata.tags as string[] | undefined;
  if (tags && tags.length > 0) {
    parts.push(`**Tags:** ${tags.join(", ")}`);
  }

  return parts.join("\n\n");
}

/**
 * Validate access via API key (header or query param).
 */
function validateAccess(req: HttpRequest): boolean {
  const expected = process.env.INGEST_API_KEY || process.env.MCP_ACCESS_KEY;
  if (!expected) return true; // no key configured = open

  const fromHeader = req.headers.get("x-brain-key");
  const fromQuery = req.query.get("key");
  return fromHeader === expected || fromQuery === expected;
}

async function ingestThought(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  // Validate access
  if (!validateAccess(req)) {
    return { status: 401, body: "Unauthorized" };
  }

  let body: Record<string, unknown>;
  try {
    // Try parsing as JSON first, fall back to reading text and parsing
    try {
      body = await req.json() as Record<string, unknown>;
    } catch {
      const text = await req.text();
      body = JSON.parse(text) as Record<string, unknown>;
    }
  } catch (e) {
    context.error("Failed to parse request body:", e);
    return { status: 400, jsonBody: { error: "Invalid JSON", detail: String(e) } };
  }

  context.log("Received body:", JSON.stringify(body).substring(0, 500));

  // Extract text — support multiple field names PA might send
  let rawText = (body.text as string) || (body.message as string) || (body.content as string) || "";
  if (!rawText) {
    return { status: 400, jsonBody: { error: "text is required", receivedKeys: Object.keys(body) } };
  }

  const cleanText = stripBotMention(rawText);
  if (!cleanText) {
    return { status: 400, jsonBody: { error: "Empty message after processing" } };
  }

  // Extract sender name
  const from = typeof body.from === "string"
    ? body.from
    : (body.from as Record<string, unknown>)?.name as string || "Unknown";

  context.log(`Processing thought from ${from}: "${cleanText.substring(0, 80)}..."`);

  try {
    // Generate embedding and extract metadata in parallel
    const [embedding, metadata] = await Promise.all([
      generateEmbedding(cleanText),
      extractMetadata(cleanText),
    ]);

    // Check for reopen intent — keyword prefix
    const reopenMatch = extractReopenPrefix(cleanText);

    if (reopenMatch) {
      const searchEmbedding = await generateEmbedding(reopenMatch);
      const matches = await searchDoneTasks(searchEmbedding, 1);

      if (matches.length > 0 && matches[0].similarity > 0.3) {
        const reopened = await reopenThought(matches[0].id);
        if (reopened) {
          const reopenedTitle = reopened.metadata?.title || reopened.content.substring(0, 60);
          context.log(`Reopened task ${reopened.id}: "${reopenedTitle}"`);
          return {
            status: 200,
            jsonBody: {
              id: reopened.id,
              reply: `🔄 **Reopened:** ${reopenedTitle}`,
              type: "reopen",
              title: reopenedTitle,
              reopened: reopened.id,
            },
          };
        }
      }

      // No match found — still store the thought
      const [embedding, metadata] = await Promise.all([
        generateEmbedding(cleanText),
        extractMetadata(cleanText),
      ]);
      const thought = await insertThought(cleanText, embedding, metadata, "teams");
      return {
        status: 200,
        jsonBody: {
          id: thought.id,
          reply: `🔄 Noted, but no matching completed task found to reopen`,
          type: metadata.type,
          title: metadata.title,
          reopened: null,
        },
      };
    }

    // Check for completion intent — keyword prefix OR AI-detected
    const prefixMatch = extractCompletionPrefix(cleanText);
    const isCompletion = !!prefixMatch || metadata.is_completion === true;
    const completionDesc = prefixMatch || (metadata.completion_description as string) || cleanText;

    let markedDoneThought = null;

    if (isCompletion) {
      // Generate embedding for just the completion description for better matching
      const searchEmbedding = prefixMatch
        ? await generateEmbedding(prefixMatch)
        : embedding;

      // Find the closest matching open task
      const matches = await searchOpenTasks(searchEmbedding, 1);
      if (matches.length > 0 && matches[0].similarity > 0.3) {
        markedDoneThought = await markThoughtDone(matches[0].id);
        context.log(`Marked task ${matches[0].id} as done: "${matches[0].content.substring(0, 80)}"`);
      }
    }

    // Store the thought itself
    const thought = await insertThought(cleanText, embedding, metadata, "teams");

    context.log(`Stored thought ${thought.id} as ${metadata.type}`);

    let reply = formatReply(metadata as Record<string, unknown>);

    if (markedDoneThought) {
      const doneTitle = markedDoneThought.metadata?.title || markedDoneThought.content.substring(0, 60);
      reply = `✅ **Marked done:** ${doneTitle}\n\n${reply}`;
    } else if (isCompletion) {
      reply = `✅ Noted as completed (no matching open task found to mark done)\n\n${reply}`;
    }

    // Return structured JSON that Power Automate can parse
    return {
      status: 200,
      jsonBody: {
        id: thought.id,
        reply: reply,
        type: metadata.type,
        title: metadata.title,
        markedDone: markedDoneThought ? markedDoneThought.id : null,
      },
    };
  } catch (error) {
    context.error("Failed to process thought:", error);
    return {
      status: 500,
      jsonBody: {
        error: "Failed to capture thought",
        reply: "⚠️ Something went wrong capturing that thought.",
      },
    };
  }
}

app.http("ingest-thought", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: ingestThought,
});

export default ingestThought;
