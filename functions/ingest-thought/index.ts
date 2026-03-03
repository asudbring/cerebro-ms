/**
 * ingest-thought — Azure Function
 *
 * Receives a Teams Outgoing Webhook POST, generates an embedding,
 * extracts metadata, stores in PostgreSQL, and returns a reply card.
 *
 * Teams Outgoing Webhooks are synchronous: the JSON you return is
 * displayed as the bot's reply. No separate API call needed.
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import * as crypto from "crypto";
import { generateEmbedding, extractMetadata } from "../../lib/azure-openai.js";
import { insertThought } from "../../lib/database.js";
import type { TeamsWebhookPayload } from "../../lib/types.js";

/**
 * Validate the HMAC-SHA256 signature from Teams Outgoing Webhook.
 * Teams sends the signature as base64 in the Authorization header.
 */
function validateTeamsSignature(body: string, authHeader: string | null, secret: string): boolean {
  if (!authHeader) return false;

  // Teams sends: "HMAC <base64-signature>"
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "HMAC") return false;

  const providedSignature = parts[1];
  const bufSecret = Buffer.from(secret, "base64");
  const computedSignature = crypto
    .createHmac("sha256", bufSecret)
    .update(body, "utf8")
    .digest("base64");

  return crypto.timingSafeEqual(
    Buffer.from(providedSignature, "base64"),
    Buffer.from(computedSignature, "base64")
  );
}

/**
 * Strip the @mention of the bot from the message text.
 * Teams includes <at>BotName</at> in the text for outgoing webhooks.
 */
function stripBotMention(text: string): string {
  return text.replace(/<at>.*?<\/at>\s*/gi, "").trim();
}

/**
 * Format the captured metadata into a Teams reply string.
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

async function ingestThought(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const bodyText = await req.text();

  // Validate HMAC signature
  const secret = process.env.TEAMS_WEBHOOK_SECRET;
  if (secret) {
    const authHeader = req.headers.get("authorization");
    if (!validateTeamsSignature(bodyText, authHeader, secret)) {
      context.log("Invalid HMAC signature — rejecting request.");
      return { status: 401, body: "Unauthorized" };
    }
  }

  let payload: TeamsWebhookPayload;
  try {
    payload = JSON.parse(bodyText) as TeamsWebhookPayload;
  } catch {
    return { status: 400, body: "Invalid JSON" };
  }

  const rawText = payload.text;
  if (!rawText) {
    return { status: 200, jsonBody: { type: "message", text: "No text found in message." } };
  }

  const cleanText = stripBotMention(rawText);
  if (!cleanText) {
    return { status: 200, jsonBody: { type: "message", text: "Empty message after removing mention." } };
  }

  context.log(`Processing thought from ${payload.from?.name}: "${cleanText.substring(0, 80)}..."`);

  try {
    // Generate embedding and extract metadata in parallel
    const [embedding, metadata] = await Promise.all([
      generateEmbedding(cleanText),
      extractMetadata(cleanText),
    ]);

    // Store in database
    const thought = await insertThought(cleanText, embedding, metadata, "teams");

    context.log(`Stored thought ${thought.id} as ${metadata.type}`);

    // Return reply for Teams to display
    return {
      status: 200,
      jsonBody: {
        type: "message",
        text: formatReply(metadata as Record<string, unknown>),
      },
    };
  } catch (error) {
    context.error("Failed to process thought:", error);
    return {
      status: 200,
      jsonBody: {
        type: "message",
        text: "⚠️ Something went wrong capturing that thought. Check the function logs.",
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
