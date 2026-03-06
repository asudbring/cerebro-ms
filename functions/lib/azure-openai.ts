/**
 * Azure OpenAI helpers — embedding generation and metadata extraction.
 *
 * Uses the @azure/openai SDK with deployment names (not model names).
 * Requires env vars: AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY,
 * AZURE_OPENAI_EMBEDDING_DEPLOYMENT, AZURE_OPENAI_CHAT_DEPLOYMENT.
 */

import { AzureOpenAI } from "openai";
import type { ThoughtMetadata } from "./types.js";

let client: AzureOpenAI | null = null;

function getClient(): AzureOpenAI {
  if (!client) {
    client = new AzureOpenAI({
      endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
      apiKey: process.env.AZURE_OPENAI_API_KEY!,
      apiVersion: "2024-10-21",
    });
  }
  return client;
}

/**
 * Generate a 1536-dimensional embedding for the given text.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const ai = getClient();
  const response = await ai.embeddings.create({
    model: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT!,
    input: text,
  });
  return response.data[0].embedding;
}

const METADATA_SYSTEM_PROMPT = `You are a metadata extractor for a personal knowledge base. Given a raw thought, extract structured metadata. Return ONLY valid JSON with these fields:

{
  "title": "Short descriptive title (3-8 words)",
  "type": "One of: person_note, project_update, idea, task, meeting_note, decision, reflection, reference, other",
  "people": ["Array of people names mentioned, or empty array"],
  "action_items": ["Array of action items found, or empty array"],
  "tags": ["2-4 relevant topic tags, lowercase"],
  "is_completion": false,
  "completion_description": "",
  "has_reminder": false,
  "reminder_title": "",
  "reminder_datetime": ""
}

Rules:
1. Return ONLY valid JSON. No markdown, no explanation.
2. Be specific with titles — they should distinguish this thought from others.
3. Extract ALL people mentioned by name.
4. Only include action_items if there's a clear to-do or follow-up.
5. Tags should be topical, not generic (e.g., "api-redesign" not "work").
6. Set is_completion to true if the thought reports finishing/completing a previous task. Keywords include: "done", "completed", "finished", "shipped", "wrapped up", "closed out", "checked off". Both explicit ("done: vnet docs") and natural ("finally finished the vnet troubleshooting docs") count.
7. When is_completion is true, set completion_description to a short phrase describing WHAT was completed (without the "done"/"completed" prefix).
8. Set has_reminder to true if the thought asks to be reminded, schedule something, or has a deadline/time. Keywords include: "remind me", "don't forget", "remember to", "by [date/time]", "before [date]", "follow up", "due", "deadline", "schedule". Phrases like "I need to do X by Friday" count.
9. When has_reminder is true, set reminder_title to a short action phrase (e.g., "Submit TPS report"), and set reminder_datetime to an ISO 8601 datetime string. Use the current date (provided below) to resolve relative dates like "tomorrow", "next Tuesday", "Friday". If only a date is given with no time, default to 09:00. Always use the timezone offset -06:00 (Central Time).
10. Current date/time for resolving relative dates: PROVIDED_AT_RUNTIME`;

/**
 * Build the metadata prompt with current date injected.
 */
function buildMetadataPrompt(): string {
  return METADATA_SYSTEM_PROMPT.replace("PROVIDED_AT_RUNTIME", new Date().toISOString());
}

/**
 * Extract structured metadata from a raw thought using the chat model.
 */
export async function extractMetadata(text: string): Promise<ThoughtMetadata> {
  const ai = getClient();
  const response = await ai.chat.completions.create({
    model: process.env.AZURE_OPENAI_CHAT_DEPLOYMENT!,
    messages: [
      { role: "system", content: buildMetadataPrompt() },
      { role: "user", content: text },
    ],
    temperature: 0.2,
    max_tokens: 500,
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    return { title: "Untitled thought", type: "other", tags: [] };
  }

  try {
    return JSON.parse(content) as ThoughtMetadata;
  } catch {
    return { title: "Untitled thought", type: "other", tags: [] };
  }
}
