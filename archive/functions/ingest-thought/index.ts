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
import { uploadFile, generateSasUrl } from "../lib/blob-storage.js";
import { analyzeFile, type FileAnalysisResult } from "../lib/file-analysis.js";

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
 * Resolve MIME type from file extension (Teams sends "reference" for hosted files).
 */
function mimeFromExtension(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    doc: "application/msword",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    txt: "text/plain", csv: "text/csv",
  };
  return map[ext] || "application/octet-stream";
}

/**
 * Get a Graph API access token using client credentials.
 */
async function getGraphToken(): Promise<string | null> {
  const tenantId = process.env.GRAPH_TENANT_ID;
  const clientId = process.env.GRAPH_CLIENT_ID;
  const clientSecret = process.env.GRAPH_CLIENT_SECRET;
  if (!tenantId || !clientId || !clientSecret) return null;

  const resp = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!resp.ok) return null;
  const data = await resp.json() as { access_token?: string };
  return data.access_token || null;
}

/**
 * Download a file from a SharePoint contentUrl via Graph API.
 * Converts SharePoint URL to Graph API path and follows redirects.
 */
async function downloadViaGraph(contentUrl: string, context: InvocationContext): Promise<Buffer | null> {
  const token = await getGraphToken();
  if (!token) {
    context.warn("Graph API credentials not configured — cannot download SharePoint files");
    return null;
  }

  // Parse SharePoint URL: https://tenant.sharepoint.com/sites/SiteName/Shared Documents/path/file.ext
  const match = contentUrl.match(/https:\/\/([^/]+)\/sites\/([^/]+)\/Shared%20Documents\/(.+)|https:\/\/([^/]+)\/sites\/([^/]+)\/Shared Documents\/(.+)/);
  if (!match) {
    context.warn(`Cannot parse SharePoint URL: ${contentUrl}`);
    // Try direct download as fallback
    const resp = await fetch(contentUrl);
    return resp.ok ? Buffer.from(await resp.arrayBuffer()) : null;
  }

  const hostname = match[1] || match[4];
  const siteName = match[2] || match[5];
  const filePath = encodeURIComponent(match[3] || match[6]).replace(/%2F/g, "/");

  // First get the site ID
  const siteResp = await fetch(`https://graph.microsoft.com/v1.0/sites/${hostname}:/sites/${siteName}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!siteResp.ok) {
    context.warn(`Failed to get site: ${siteResp.status}`);
    return null;
  }
  const site = await siteResp.json() as { id: string };

  // Download file content (follow redirect)
  const fileResp = await fetch(
    `https://graph.microsoft.com/v1.0/sites/${site.id}/drive/root:/${filePath}:/content`,
    { headers: { Authorization: `Bearer ${token}` }, redirect: "follow" },
  );
  if (!fileResp.ok) {
    context.warn(`Failed to download file via Graph: ${fileResp.status}`);
    return null;
  }

  const buffer = Buffer.from(await fileResp.arrayBuffer());
  context.log(`Downloaded via Graph API: ${buffer.length} bytes`);
  return buffer;
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
  const attachments = body.attachments as Array<{ name: string; contentUrl: string; contentType: string }> | undefined;
  const hasAttachments = attachments && attachments.length > 0;

  if (!rawText && !hasAttachments) {
    return { status: 400, jsonBody: { error: "text or attachments required", receivedKeys: Object.keys(body) } };
  }

  const cleanText = stripBotMention(rawText) || (hasAttachments ? "(file attachment)" : "");
  if (!cleanText) {
    return { status: 400, jsonBody: { error: "Empty message after processing" } };
  }

  // Loop guard: reject messages that look like our own reply (bot re-capturing itself)
  if (cleanText.startsWith("**Captured**") || cleanText.startsWith("✅ **Marked done") || cleanText.startsWith("🔄 **Reopened")) {
    context.log("Loop guard: rejecting bot reply re-capture");
    return { status: 200, jsonBody: { skipped: true, reason: "Bot reply detected — not re-capturing" } };
  }

  // Extract sender name
  const from = typeof body.from === "string"
    ? body.from
    : (body.from as Record<string, unknown>)?.name as string || "Unknown";

  context.log(`Processing thought from ${from}: "${cleanText.substring(0, 80)}..."`);

  try {
    // Process attachments if present
    let fileAnalysis: FileAnalysisResult | null = null;
    let fileUrl: string | null = null;
    let fileType: string | null = null;

    if (hasAttachments) {
      const att = attachments[0]; // process first attachment

      // Detect actual MIME type — Teams sends "reference" for hosted files
      const resolvedContentType = att.contentType === "reference"
        ? mimeFromExtension(att.name)
        : att.contentType;

      context.log(`Processing attachment: ${att.name} (${resolvedContentType})`);

      try {
        let fileBuffer: Buffer | null = null;

        // Prefer base64 content passed by Power Automate
        if (body.fileContent) {
          const base64Data = (body.fileContent as string).replace(/^data:[^;]+;base64,/, "");
          fileBuffer = Buffer.from(base64Data, "base64");
          context.log(`Received file via base64: ${fileBuffer.length} bytes`);
        } else if (att.contentUrl) {
          // Download via Graph API for SharePoint-hosted files
          fileBuffer = await downloadViaGraph(att.contentUrl, context);
        }

        if (fileBuffer) {
          // Upload to blob storage and analyze in parallel
          const [uploadResult, analysis] = await Promise.all([
            uploadFile(fileBuffer, att.name, resolvedContentType),
            analyzeFile(fileBuffer, resolvedContentType, att.name),
          ]);

          fileUrl = generateSasUrl(uploadResult.blobName);
          fileType = resolvedContentType;
          fileAnalysis = analysis;
          context.log(`File uploaded: ${uploadResult.blobName}, analysis: ${analysis.fileType}`);
        }
      } catch (fileError) {
        context.warn("Attachment processing failed, continuing with text only:", fileError);
      }
    }

    // Combine text + file analysis for embedding and metadata
    const contentForEmbedding = fileAnalysis
      ? `${cleanText}\n\n[Attached ${fileAnalysis.fileType}: ${fileAnalysis.description}]`
      : cleanText;

    // Generate embedding and extract metadata in parallel
    const [embedding, metadata] = await Promise.all([
      generateEmbedding(contentForEmbedding),
      extractMetadata(contentForEmbedding),
    ]);

    // Add file metadata if present
    if (fileAnalysis && fileUrl) {
      metadata.has_file = true;
      metadata.file_name = attachments![0].name;
      metadata.file_description = fileAnalysis.description.slice(0, 500);
      metadata.file_url = fileUrl;
    }

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
    const thought = await insertThought(cleanText, embedding, metadata, "teams", fileUrl, fileType);

    context.log(`Stored thought ${thought.id} as ${metadata.type}${fileUrl ? " (with file)" : ""}`);

    let reply = formatReply(metadata as Record<string, unknown>);

    // Add file confirmation to reply
    if (fileAnalysis && fileUrl) {
      reply += `\n\n📎 **File:** ${attachments![0].name} — ${fileAnalysis.description.slice(0, 150)}`;
    }

    if (markedDoneThought) {
      const doneTitle = markedDoneThought.metadata?.title || markedDoneThought.content.substring(0, 60);
      reply = `✅ **Marked done:** ${doneTitle}\n\n${reply}`;
    } else if (isCompletion) {
      reply = `✅ Noted as completed (no matching open task found to mark done)\n\n${reply}`;
    }

    // Add reminder confirmation to reply
    if (metadata.has_reminder && metadata.reminder_title && metadata.reminder_datetime) {
      const reminderDate = new Date(metadata.reminder_datetime);
      const formatted = reminderDate.toLocaleString("en-US", {
        weekday: "short", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit", hour12: true,
      });
      reply += `\n\n📅 **Reminder:** ${metadata.reminder_title} — ${formatted}`;
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
        has_reminder: metadata.has_reminder || false,
        reminder_title: metadata.reminder_title || null,
        reminder_datetime: metadata.reminder_datetime || null,
        has_file: !!fileUrl,
        file_url: fileUrl || null,
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
