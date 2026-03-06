/**
 * digest — Azure Function (HTTP Triggers)
 *
 * Two endpoints called by Power Automate on a schedule:
 *   - GET /api/daily-digest  — last 24 hours summary
 *   - GET /api/weekly-digest — last 7 days summary
 *
 * Returns JSON with title, summary, and thought list.
 * Power Automate posts the result to Teams and sends email.
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { AzureOpenAI } from "openai";
import { getThoughtsSince, getCompletedThoughtsSince, getStats } from "../lib/database.js";
import type { ThoughtRow } from "../lib/types.js";

// ── Azure OpenAI client ──────────────────────────────────────────────

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

// ── Auth ─────────────────────────────────────────────────────────────

function validateAccess(req: HttpRequest): boolean {
  const expected = process.env.MCP_ACCESS_KEY;
  if (!expected) return true;
  const fromHeader = req.headers.get("x-brain-key");
  const fromQuery = req.query.get("key");
  return fromHeader === expected || fromQuery === expected;
}

// ── Formatting helpers ───────────────────────────────────────────────

function formatThoughtList(thoughts: ThoughtRow[]): string {
  return thoughts
    .map((t) => {
      const title = t.metadata?.title || "Untitled";
      const type = t.metadata?.type || "other";
      const date = new Date(t.created_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      return `- **${title}** (${type}, ${date}): ${t.content.slice(0, 150)}${t.content.length > 150 ? "…" : ""}`;
    })
    .join("\n");
}

function formatThoughtListHtml(thoughts: ThoughtRow[]): string {
  return "<ul>" + thoughts
    .map((t) => {
      const title = t.metadata?.title || "Untitled";
      const type = t.metadata?.type || "other";
      const date = new Date(t.created_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      const snippet = t.content.slice(0, 150) + (t.content.length > 150 ? "…" : "");
      return `<li><strong>${title}</strong> (${type}, ${date}): ${snippet}</li>`;
    })
    .join("") + "</ul>";
}

function groupByType(thoughts: ThoughtRow[]): Map<string, ThoughtRow[]> {
  const groups = new Map<string, ThoughtRow[]>();
  for (const t of thoughts) {
    const type = t.metadata?.type || "other";
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type)!.push(t);
  }
  return groups;
}

// ── AI Summary Generation ────────────────────────────────────────────

async function generateDigestSummary(
  thoughts: ThoughtRow[],
  period: "daily" | "weekly"
): Promise<string> {
  const ai = getClient();
  const grouped = groupByType(thoughts);

  let thoughtsText = "";
  for (const [type, items] of grouped) {
    thoughtsText += `\n## ${type} (${items.length})\n`;
    for (const t of items) {
      thoughtsText += `- ${t.content}\n`;
    }
  }

  const systemPrompt =
    period === "daily"
      ? `You are a personal knowledge assistant. Given today's captured thoughts, write a brief daily digest (3-5 bullet points). Highlight key decisions, action items, and notable insights. Be concise and direct. Use markdown formatting.`
      : `You are a personal knowledge analyst. Given this week's captured thoughts, write a weekly digest that: 1) Identifies the 3-5 main themes, 2) Lists any open action items or unresolved decisions, 3) Notes connections between thoughts from different days, 4) Suggests what to focus on next week. Be concise. Use markdown formatting.`;

  const response = await ai.chat.completions.create({
    model: process.env.AZURE_OPENAI_CHAT_DEPLOYMENT!,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Here are ${period === "daily" ? "today's" : "this week's"} captured thoughts (${thoughts.length} total):\n${thoughtsText}`,
      },
    ],
    temperature: 0.3,
    max_tokens: 1000,
  });

  return response.choices[0]?.message?.content || "Could not generate summary.";
}

function markdownToHtml(md: string): string {
  return md
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.*?)`/g, "<code>$1</code>")
    .replace(/^- (.*)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>)/s, "<ul>$1</ul>")
    .replace(/\n/g, "<br>");
}

function formatCompletedMarkdown(completed: ThoughtRow[]): string {
  if (completed.length === 0) return "";
  const items = completed
    .map((t) => {
      const title = t.metadata?.title || "Untitled";
      return `- ✅ ~~${title}~~`;
    })
    .join("\n");
  return `\n\n**Completed:**\n${items}`;
}

function formatCompletedHtml(completed: ThoughtRow[]): string {
  if (completed.length === 0) return "";
  const items = completed
    .map((t) => {
      const title = t.metadata?.title || "Untitled";
      return `<li>✅ <s>${title}</s></li>`;
    })
    .join("");
  return `<h3>Completed</h3><ul>${items}</ul>`;
}

// ── Daily Digest ─────────────────────────────────────────────────────

async function dailyDigest(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (!validateAccess(req)) {
    return { status: 401, body: "Unauthorized" };
  }

  context.log("Daily digest requested");

  const since = new Date();
  since.setHours(since.getHours() - 24);

  const [thoughts, completed] = await Promise.all([
    getThoughtsSince(since),
    getCompletedThoughtsSince(since, 3),
  ]);

  if (thoughts.length === 0 && completed.length === 0) {
    return {
      status: 200,
      jsonBody: { skipped: true, reason: "No thoughts captured in the last 24 hours." },
    };
  }

  // Filter out completion-type thoughts from the main list for cleaner summaries
  const activeThoughts = thoughts.filter((t) => t.status !== "done" && !t.metadata?.is_completion);

  let summary = "";
  if (activeThoughts.length > 0) {
    summary = await generateDigestSummary(activeThoughts, "daily");
  }

  const title = `🧠 Daily Brain Digest — ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}`;
  const completedMd = formatCompletedMarkdown(completed);
  const completedHtml = formatCompletedHtml(completed);
  const thoughtListMd = formatThoughtList(activeThoughts);
  const thoughtListHtml = formatThoughtListHtml(activeThoughts);
  const fullMarkdown = `**${thoughts.length} thought${thoughts.length === 1 ? "" : "s"}** captured today${completedMd}\n\n${summary}\n\n---\n${thoughtListMd}`;
  // Teams messages have a ~28KB limit — truncate if needed, keeping summary intact
  const MAX_TEAMS_LENGTH = 24000;
  const bodyMarkdown = fullMarkdown.length > MAX_TEAMS_LENGTH
    ? `**${thoughts.length} thought${thoughts.length === 1 ? "" : "s"}** captured today${completedMd}\n\n${summary}\n\n---\n*(${activeThoughts.length} thoughts — full list in email)*`
    : fullMarkdown;
  // Email has no practical size limit — always include full list
  const bodyHtml = `<h2>${title}</h2><p><strong>${thoughts.length} thought${thoughts.length === 1 ? "" : "s"}</strong> captured today</p>${completedHtml}${summary ? markdownToHtml(summary) : ""}<hr>${thoughtListHtml}`;

  return {
    status: 200,
    jsonBody: {
      skipped: false,
      title,
      summary: bodyMarkdown,
      summaryHtml: bodyHtml,
      thoughtCount: thoughts.length,
    },
  };
}

app.http("daily-digest", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: dailyDigest,
});

// ── Weekly Digest ────────────────────────────────────────────────────

async function weeklyDigest(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  if (!validateAccess(req)) {
    return { status: 401, body: "Unauthorized" };
  }

  context.log("Weekly digest requested");

  const since = new Date();
  since.setDate(since.getDate() - 7);

  const [thoughts, completed, stats] = await Promise.all([
    getThoughtsSince(since),
    getCompletedThoughtsSince(since, 5),
    getStats(),
  ]);

  if (thoughts.length === 0 && completed.length === 0) {
    return {
      status: 200,
      jsonBody: { skipped: true, reason: "No thoughts captured this week." },
    };
  }

  const activeThoughts = thoughts.filter((t) => t.status !== "done" && !t.metadata?.is_completion);

  let summary = "";
  if (activeThoughts.length > 0) {
    summary = await generateDigestSummary(activeThoughts, "weekly");
  }

  const title = `🧠 Weekly Brain Review — Week of ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

  const grouped = groupByType(activeThoughts);
  const typeSummary = Array.from(grouped.entries())
    .map(([type, items]) => `${type}: ${items.length}`)
    .join(", ");

  const completedMd = formatCompletedMarkdown(completed);
  const completedHtml = formatCompletedHtml(completed);
  const fullMarkdown = `**${thoughts.length} thought${thoughts.length === 1 ? "" : "s"}** this week (${typeSummary})\n**${stats.total_thoughts} total** in your brain${completedMd}\n\n${summary}`;
  const MAX_TEAMS_LENGTH = 24000;
  const bodyMarkdown = fullMarkdown.length > MAX_TEAMS_LENGTH
    ? `**${thoughts.length} thought${thoughts.length === 1 ? "" : "s"}** this week (${typeSummary})\n**${stats.total_thoughts} total** in your brain${completedMd}\n\n*(Full summary in email)*`
    : fullMarkdown;
  const bodyHtml = `<h2>${title}</h2><p><strong>${thoughts.length} thought${thoughts.length === 1 ? "" : "s"}</strong> this week (${typeSummary})<br><strong>${stats.total_thoughts} total</strong> in your brain</p>${completedHtml}${summary ? markdownToHtml(summary) : ""}`;

  return {
    status: 200,
    jsonBody: {
      skipped: false,
      title,
      summary: bodyMarkdown,
      summaryHtml: bodyHtml,
      thoughtCount: thoughts.length,
      totalThoughts: stats.total_thoughts,
    },
  };
}

app.http("weekly-digest", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: weeklyDigest,
});
