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
import { insertThought } from "../lib/database.js";

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
    body = await req.json() as Record<string, unknown>;
  } catch {
    return { status: 400, body: "Invalid JSON" };
  }

  // Extract text — support both { text } and legacy Teams { text with <at> }
  let rawText = (body.text as string) || "";
  if (!rawText) {
    return { status: 400, jsonBody: { error: "text is required" } };
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

    // Store in database
    const thought = await insertThought(cleanText, embedding, metadata, "teams");

    context.log(`Stored thought ${thought.id} as ${metadata.type}`);

    const reply = formatReply(metadata as Record<string, unknown>);

    // Return structured JSON that Power Automate can parse
    return {
      status: 200,
      jsonBody: {
        id: thought.id,
        reply: reply,
        type: metadata.type,
        title: metadata.title,
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
