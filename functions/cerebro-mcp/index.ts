/**
 * cerebro-mcp — Azure Function
 *
 * MCP (Model Context Protocol) server that exposes 4 tools:
 *   - search_thoughts: semantic search by meaning
 *   - browse_recent: list recent thoughts with optional type filter
 *   - cerebro_stats: overview of your cerebro's contents
 *   - capture_thought: add a thought from any MCP client
 *
 * Authenticates via x-brain-key header or ?key= query param.
 * Uses SSE (Server-Sent Events) transport for MCP protocol.
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { generateEmbedding, extractMetadata } from "../lib/azure-openai.js";
import { searchThoughts, getRecentThoughts, getStats, insertThought, searchOpenTasks, searchDoneTasks, markThoughtDone, reopenThought } from "../lib/database.js";
import type { SearchResult, ThoughtRow, BrainStats } from "../lib/types.js";

/**
 * Validate the access key from header or query parameter.
 */
function validateAccessKey(req: HttpRequest): boolean {
  const expected = process.env.MCP_ACCESS_KEY;
  if (!expected) return true; // No key configured = open access (dev only)

  const headerKey = req.headers.get("x-brain-key");
  const queryKey = req.query.get("key");
  const provided = headerKey || queryKey;

  if (!provided) return false;
  return provided === expected;
}

/**
 * Format search results for display.
 */
function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) return "No matching thoughts found.";

  return results
    .map((r, i) => {
      const date = new Date(r.created_at).toLocaleDateString();
      const sim = (r.similarity * 100).toFixed(0);
      const meta = r.metadata;
      const title = meta?.title || "Untitled";
      const type = meta?.type || "unknown";
      const fileInfo = meta?.has_file ? `\n📎 File: ${meta.file_name || "attached"} — [View](${meta.file_url || ""})` : "";
      return `**${i + 1}. ${title}** (${type}, ${sim}% match, ${date})\n${r.content}${fileInfo}`;
    })
    .join("\n\n---\n\n");
}

/**
 * Format recent thoughts for display.
 */
function formatRecentThoughts(thoughts: ThoughtRow[]): string {
  if (thoughts.length === 0) return "No thoughts found.";

  return thoughts
    .map((t, i) => {
      const date = new Date(t.created_at).toLocaleDateString();
      const meta = t.metadata;
      const title = meta?.title || "Untitled";
      const type = meta?.type || "unknown";
      const fileInfo = meta?.has_file ? `\n📎 File: ${meta.file_name || "attached"} — [View](${meta.file_url || ""})` : "";
      return `**${i + 1}. ${title}** (${type}, ${date})\n${t.content}${fileInfo}`;
    })
    .join("\n\n---\n\n");
}

/**
 * Format cerebro stats for display.
 */
function formatStats(stats: BrainStats): string {
  const lines: string[] = [];
  lines.push(`**Total thoughts:** ${stats.total_thoughts}`);

  if (stats.earliest) {
    lines.push(`**First captured:** ${new Date(stats.earliest).toLocaleDateString()}`);
    lines.push(`**Most recent:** ${new Date(stats.latest!).toLocaleDateString()}`);
  }

  if (stats.top_types.length > 0) {
    lines.push("\n**By type:**");
    stats.top_types.forEach((t) => lines.push(`- ${t.type}: ${t.count}`));
  }

  if (stats.top_people.length > 0) {
    lines.push("\n**Most mentioned people:**");
    stats.top_people.forEach((p) => lines.push(`- ${p.person}: ${p.count} mentions`));
  }

  return lines.join("\n");
}

/**
 * Simple JSON-RPC style MCP handler.
 *
 * For a production deployment, use the full @modelcontextprotocol/sdk with
 * SSE transport. This simplified handler supports the core tool-calling flow
 * that Claude Desktop and other MCP clients use.
 */
async function handleMcpRequest(
  body: Record<string, unknown>,
  context: InvocationContext
): Promise<Record<string, unknown>> {
  const method = body.method as string;
  const params = (body.params || {}) as Record<string, unknown>;
  const id = body.id;

  // List available tools
  if (method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        tools: [
          {
            name: "search_thoughts",
            description:
              "Search your cerebro by meaning. Uses vector similarity to find thoughts related to your query, even if they don't share exact keywords.",
            inputSchema: {
              type: "object",
              properties: {
                query: { type: "string", description: "What to search for (natural language)" },
                threshold: {
                  type: "number",
                  description: "Minimum similarity score 0.0-1.0 (default: 0.3)",
                  default: 0.3,
                },
                limit: {
                  type: "number",
                  description: "Maximum results to return (default: 10)",
                  default: 10,
                },
              },
              required: ["query"],
            },
          },
          {
            name: "browse_recent",
            description:
              "Browse your most recent thoughts, optionally filtered by type (person_note, project_update, idea, task, meeting_note, decision, reflection, reference). Searches your cerebro.",
            inputSchema: {
              type: "object",
              properties: {
                limit: { type: "number", description: "Number of thoughts (default: 20)", default: 20 },
                type: { type: "string", description: "Filter by metadata type (optional)" },
              },
            },
          },
          {
            name: "cerebro_stats",
            description:
              "Get an overview of your cerebro — total thoughts, date range, most common types, most mentioned people.",
            inputSchema: { type: "object", properties: {} },
          },
          {
            name: "capture_thought",
            description:
              "Save a new thought to your cerebro. It will be embedded and classified automatically. Use this when the user wants to remember something.",
            inputSchema: {
              type: "object",
              properties: {
                text: { type: "string", description: "The thought to capture" },
              },
              required: ["text"],
            },
          },
          {
            name: "complete_task",
            description:
              "Mark a task as done. Describe the task and it will find the closest matching open task by meaning and mark it complete.",
            inputSchema: {
              type: "object",
              properties: {
                description: { type: "string", description: "Description of the task that was completed" },
              },
              required: ["description"],
            },
          },
          {
            name: "reopen_task",
            description:
              "Reopen a completed task. Describe the task and it will find the closest matching done task and set it back to open.",
            inputSchema: {
              type: "object",
              properties: {
                description: { type: "string", description: "Description of the task to reopen" },
              },
              required: ["description"],
            },
          },
        ],
      },
    };
  }

  // Call a tool
  if (method === "tools/call") {
    const toolName = params.name as string;
    const args = (params.arguments || {}) as Record<string, unknown>;

    try {
      switch (toolName) {
        case "search_thoughts": {
          const query = args.query as string;
          const threshold = (args.threshold as number) || 0.3;
          const limit = (args.limit as number) || 10;

          const embedding = await generateEmbedding(query);
          const results = await searchThoughts(embedding, threshold, limit);

          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: formatSearchResults(results) }],
            },
          };
        }

        case "browse_recent": {
          const limit = (args.limit as number) || 20;
          const typeFilter = args.type as string | undefined;
          const thoughts = await getRecentThoughts(limit, typeFilter);

          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: formatRecentThoughts(thoughts) }],
            },
          };
        }

        case "cerebro_stats": {
          const stats = await getStats();
          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: formatStats(stats) }],
            },
          };
        }

        case "capture_thought": {
          const text = args.text as string;
          if (!text) {
            return {
              jsonrpc: "2.0",
              id,
              result: { content: [{ type: "text", text: "Error: text is required." }] },
            };
          }

          const [embedding, metadata] = await Promise.all([
            generateEmbedding(text),
            extractMetadata(text),
          ]);
          const thought = await insertThought(text, embedding, metadata, "mcp");

          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: `Captured as \`${metadata.type || "other"}\` — ${metadata.title || "Untitled"}\nID: ${thought.id}`,
                },
              ],
            },
          };
        }

        case "complete_task": {
          const desc = args.description as string;
          if (!desc) {
            return {
              jsonrpc: "2.0",
              id,
              result: { content: [{ type: "text", text: "Error: description is required." }] },
            };
          }

          const taskEmbedding = await generateEmbedding(desc);
          const matches = await searchOpenTasks(taskEmbedding, 1);

          if (matches.length === 0 || matches[0].similarity <= 0.3) {
            return {
              jsonrpc: "2.0",
              id,
              result: { content: [{ type: "text", text: "No matching open task found. Try being more specific in your description." }] },
            };
          }

          const completed = await markThoughtDone(matches[0].id);
          const completedTitle = completed?.metadata?.title || matches[0].content.substring(0, 60);

          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: `✅ **Marked done:** ${completedTitle}\nID: ${matches[0].id}\nSimilarity: ${(matches[0].similarity * 100).toFixed(0)}%`,
                },
              ],
            },
          };
        }

        case "reopen_task": {
          const desc = args.description as string;
          if (!desc) {
            return {
              jsonrpc: "2.0",
              id,
              result: { content: [{ type: "text", text: "Error: description is required." }] },
            };
          }

          const reopenEmbedding = await generateEmbedding(desc);
          const doneMatches = await searchDoneTasks(reopenEmbedding, 1);

          if (doneMatches.length === 0 || doneMatches[0].similarity <= 0.3) {
            return {
              jsonrpc: "2.0",
              id,
              result: { content: [{ type: "text", text: "No matching completed task found. Try being more specific in your description." }] },
            };
          }

          const reopened = await reopenThought(doneMatches[0].id);
          const reopenedTitle = reopened?.metadata?.title || doneMatches[0].content.substring(0, 60);

          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: `🔄 **Reopened:** ${reopenedTitle}\nID: ${doneMatches[0].id}`,
                },
              ],
            },
          };
        }

        default:
          return {
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `Unknown tool: ${toolName}` },
          };
      }
    } catch (error) {
      context.error(`Tool ${toolName} failed:`, error);
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message: `Tool execution failed: ${(error as Error).message}` },
      };
    }
  }

  // Initialize
  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "cerebro", version: "1.0.0" },
      },
    };
  }

  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  };
}

async function mcpServer(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  // Validate access key
  if (!validateAccessKey(req)) {
    return { status: 401, body: "Unauthorized — provide x-brain-key header or ?key= parameter." };
  }

  // Health check for GET
  if (req.method === "GET") {
    return {
      status: 200,
      jsonBody: {
        name: "cerebro-mcp",
        version: "1.0.0",
        status: "ok",
        tools: ["search_thoughts", "browse_recent", "cerebro_stats", "capture_thought", "complete_task", "reopen_task"],
      },
    };
  }

  // Handle MCP JSON-RPC POST
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const response = await handleMcpRequest(body, context);
    return { status: 200, jsonBody: response };
  } catch (error) {
    context.error("MCP request failed:", error);
    return {
      status: 500,
      jsonBody: {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      },
    };
  }
}

app.http("cerebro-mcp", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  handler: mcpServer,
});

export default mcpServer;
