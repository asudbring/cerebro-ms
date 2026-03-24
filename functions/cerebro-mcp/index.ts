import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import {
  searchThoughts,
  browseThoughts,
  getStats,
  insertThought,
  findClosestThought,
  updateThoughtStatus,
} from '../lib/database.js';
import { getEmbedding, extractMetadata } from '../lib/azure-ai.js';
import { extractBearerToken, validateGitHubToken, isOAuthConfigured } from '../lib/github-oauth.js';


function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'cerebro',
    version: '1.0.0',
  });

  // Tool 1: search_thoughts
  // Schema typed explicitly to prevent TS2589 from zod v3/v4 compat inference
  const searchParams: Record<string, z.ZodTypeAny> = {
    query: z.string().describe('What to search for'),
    threshold: z.number().min(0).max(1).optional().describe('Minimum similarity score (0-1, default 0.5)'),
    limit: z.number().min(1).max(50).optional().describe('Maximum results to return (default 10)'),
  };
  (server as any).tool(
    'search_thoughts',
    'Search your knowledge base using semantic similarity. Returns the most relevant thoughts matching your query.',
    searchParams,
    async ({ query, threshold, limit }: { query: string; threshold?: number; limit?: number }) => {
      const embedding = await getEmbedding(query);
      const results = await searchThoughts(embedding, {
        threshold: threshold ?? 0.5,
        count: limit ?? 10,
      });

      if (results.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No matching thoughts found.' }] };
      }

      const formatted = results
        .map((r, i) => {
          const meta = r.metadata;
          const title = meta?.title || 'Untitled';
          const similarity = (r.similarity * 100).toFixed(1);
          const date = new Date(r.created_at).toLocaleDateString();
          const topics = meta?.topics?.length ? ` [${meta.topics.join(', ')}]` : '';
          const people = meta?.people?.length ? ` 👤 ${meta.people.join(', ')}` : '';
          const file = r.file_url ? ' 📎' : '';
          return `${i + 1}. **${title}** (${similarity}% match, ${date})${topics}${people}${file}\n   ${r.content.substring(0, 200)}${r.content.length > 200 ? '...' : ''}`;
        })
        .join('\n\n');

      return {
        content: [{ type: 'text' as const, text: `Found ${results.length} matching thoughts:\n\n${formatted}` }],
      };
    }
  );

  // Tool 2: list_thoughts
  const listParams: Record<string, z.ZodTypeAny> = {
    type: z.string().optional().describe('Filter by type: idea, task, person_note, project_update, meeting_note, decision, reflection, reference, observation'),
    topic: z.string().optional().describe('Filter by topic tag'),
    person: z.string().optional().describe('Filter by person mentioned'),
    days: z.number().optional().describe('Only thoughts from the last N days'),
    status: z.enum(['open', 'done', 'deleted']).optional().describe('Filter by status (default: open)'),
    has_file: z.boolean().optional().describe('Only thoughts with file attachments'),
    limit: z.number().min(1).max(100).optional().describe('Maximum results (default 20)'),
  };
  (server as any).tool(
    'list_thoughts',
    'Browse and filter thoughts by type, topic, person, time period, status, or file attachment.',
    listParams,
    async ({ type, topic, person, days, status, has_file, limit }: { type?: string; topic?: string; person?: string; days?: number; status?: 'open' | 'done' | 'deleted'; has_file?: boolean; limit?: number }) => {
      const thoughts = await browseThoughts({
        type,
        topic,
        person,
        days,
        status: status ?? 'open',
        hasFile: has_file,
        limit: limit ?? 20,
      });

      if (thoughts.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No thoughts found matching the filters.' }] };
      }

      const formatted = thoughts
        .map((t, i) => {
          const meta = t.metadata;
          const title = meta?.title || 'Untitled';
          const date = new Date(t.created_at).toLocaleDateString();
          const typeStr = meta?.type ? ` (${meta.type})` : '';
          const topics = meta?.topics?.length ? ` [${meta.topics.join(', ')}]` : '';
          const file = t.file_url ? ' 📎' : '';
          return `${i + 1}. **${title}**${typeStr} — ${date}${topics}${file}\n   ${t.content.substring(0, 200)}${t.content.length > 200 ? '...' : ''}`;
        })
        .join('\n\n');

      return {
        content: [{ type: 'text' as const, text: `${thoughts.length} thoughts:\n\n${formatted}` }],
      };
    }
  );

  // Tool 3: thought_stats
  (server as any).tool(
    'thought_stats',
    'Get aggregate statistics about your knowledge base: totals, types, top topics, and people.',
    {},
    async () => {
      const stats = await getStats();

      const typeList = Object.entries(stats.types)
        .sort(([, a], [, b]) => b - a)
        .map(([t, count]) => `  ${t}: ${count}`)
        .join('\n');

      const topicList = Object.entries(stats.topics)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 15)
        .map(([topic, count]) => `  ${topic}: ${count}`)
        .join('\n');

      const peopleList = Object.entries(stats.people)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 15)
        .map(([person, count]) => `  ${person}: ${count}`)
        .join('\n');

      const text = [
        '📊 Cerebro Stats',
        '',
        `Total thoughts: ${stats.total}`,
        `Last 7 days: ${stats.recentCount}`,
        '',
        `By type:\n${typeList}`,
        '',
        `Top topics:\n${topicList}`,
        '',
        `People:\n${peopleList}`,
      ].join('\n');

      return { content: [{ type: 'text' as const, text }] };
    }
  );

  // Tool 4: capture_thought
  (server as any).tool(
    'capture_thought',
    'Save a new thought to your knowledge base. Automatically generates embeddings, extracts metadata, and creates calendar reminders if dates are mentioned.',
    { content: z.string().describe('The thought to capture — a clear, standalone statement') },
    async ({ content }: { content: string }) => {
      const [embedding, metadata] = await Promise.all([
        getEmbedding(content),
        extractMetadata(content),
      ]);

      metadata.source = 'mcp';

      const thought = await insertThought(content, embedding, metadata);

      const title = metadata.title || 'Untitled';
      const topics = metadata.topics?.length ? ` [${metadata.topics.join(', ')}]` : '';
      const people = metadata.people?.length ? ` 👤 ${metadata.people.join(', ')}` : '';

      return {
        content: [{
          type: 'text' as const,
          text: `✅ Captured: **${title}** (${metadata.type || 'thought'})${topics}${people}`,
        }],
      };
    }
  );

  // Tool 5: complete_task
  (server as any).tool(
    'complete_task',
    'Mark a task as done by describing it. Uses semantic matching to find the closest open task.',
    { description: z.string().describe('Description of the task to mark as done') },
    async ({ description }: { description: string }) => {
      const embedding = await getEmbedding(description);
      const match = await findClosestThought(embedding, 'open');

      if (!match) {
        return { content: [{ type: 'text' as const, text: 'No matching open task found.' }] };
      }

      await updateThoughtStatus(match.id, 'done');
      const title = match.metadata?.title || 'Untitled';
      const similarity = (match.similarity * 100).toFixed(1);

      return {
        content: [{
          type: 'text' as const,
          text: `✅ Marked done: **${title}** (${similarity}% match)\n${match.content.substring(0, 150)}`,
        }],
      };
    }
  );

  // Tool 6: reopen_task
  (server as any).tool(
    'reopen_task',
    'Reopen a completed task by describing it. Uses semantic matching to find the closest done task.',
    { description: z.string().describe('Description of the completed task to reopen') },
    async ({ description }: { description: string }) => {
      const embedding = await getEmbedding(description);
      const match = await findClosestThought(embedding, 'done');

      if (!match) {
        return { content: [{ type: 'text' as const, text: 'No matching completed task found.' }] };
      }

      await updateThoughtStatus(match.id, 'open');
      const title = match.metadata?.title || 'Untitled';
      const similarity = (match.similarity * 100).toFixed(1);

      return {
        content: [{
          type: 'text' as const,
          text: `🔄 Reopened: **${title}** (${similarity}% match)\n${match.content.substring(0, 150)}`,
        }],
      };
    }
  );

  // Tool 7: delete_task
  (server as any).tool(
    'delete_task',
    'Soft-delete a thought by describing it. The thought is hidden but not permanently removed.',
    { description: z.string().describe('Description of the thought or task to delete') },
    async ({ description }: { description: string }) => {
      const embedding = await getEmbedding(description);
      let match = await findClosestThought(embedding, 'open');
      if (!match) {
        match = await findClosestThought(embedding, 'done');
      }

      if (!match) {
        return { content: [{ type: 'text' as const, text: 'No matching thought found.' }] };
      }

      await updateThoughtStatus(match.id, 'deleted');
      const title = match.metadata?.title || 'Untitled';
      const similarity = (match.similarity * 100).toFixed(1);

      return {
        content: [{
          type: 'text' as const,
          text: `🗑️ Deleted: **${title}** (${similarity}% match)\n${match.content.substring(0, 150)}`,
        }],
      };
    }
  );

  return server;
}

async function handler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  // OAuth validation (skip if not configured, e.g., local dev)
  if (isOAuthConfigured()) {
    const authHeader = request.headers.get('authorization');
    const token = extractBearerToken(authHeader);

    if (!token) {
      const baseUrl = process.env.WEBSITE_HOSTNAME
        ? `https://${process.env.WEBSITE_HOSTNAME}`
        : 'http://localhost:7071';
      return {
        status: 401,
        headers: {
          'WWW-Authenticate': `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`,
        },
        body: 'Unauthorized',
      };
    }

    try {
      const user = await validateGitHubToken(token);
      context.log(`MCP request authenticated as GitHub user: ${user.login}`);
    } catch (err) {
      return {
        status: 401,
        headers: { 'WWW-Authenticate': 'Bearer error="invalid_token"' },
        body: 'Invalid or expired token',
      };
    }
  }

  const server = createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);

  try {
    const init: RequestInit = {
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
    };

    if (request.method === 'POST') {
      init.body = await request.text();
    }

    const webRequest = new Request(request.url, init);
    const webResponse = await transport.handleRequest(webRequest);

    const responseHeaders: Record<string, string> = {};
    webResponse.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    const responseBody = await webResponse.text();

    return {
      status: webResponse.status,
      headers: responseHeaders,
      body: responseBody,
    };
  } catch (err) {
    context.error('MCP request handling failed:', err);
    return {
      status: 500,
      jsonBody: { error: 'Internal server error' },
    };
  } finally {
    await server.close();
  }
}

app.http('cerebro-mcp', {
  methods: ['GET', 'POST', 'DELETE'],
  authLevel: 'anonymous',
  route: 'cerebro-mcp',
  handler,
});

export default handler;
