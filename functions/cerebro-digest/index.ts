import { app, HttpRequest, HttpResponseInit, InvocationContext, Timer } from '@azure/functions';
import { getThoughtsSince, getCompletedThoughtsSince, getDigestChannels } from '../lib/database.js';
import { sendDigestEmail, isEmailConfigured } from '../lib/email.js';
import { Thought, DigestChannel } from '../lib/types.js';

// --- Timer triggers ---

// Daily digest — 6 AM Central Time
app.timer('cerebro-daily-digest', {
  schedule: '0 0 6 * * *',
  handler: async (timer: Timer, context: InvocationContext) => {
    context.log('Daily digest triggered');
    await generateAndDeliverDigest('daily', context);
  },
});

// Weekly digest — Sunday noon Central Time
app.timer('cerebro-weekly-digest', {
  schedule: '0 0 12 * * 0',
  handler: async (timer: Timer, context: InvocationContext) => {
    context.log('Weekly digest triggered');
    await generateAndDeliverDigest('weekly', context);
  },
});

// --- HTTP triggers for manual testing ---

app.http('daily-digest', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'daily-digest',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    await generateAndDeliverDigest('daily', context);
    return { status: 200, body: JSON.stringify({ status: 'Daily digest sent' }) };
  },
});

app.http('weekly-digest', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'weekly-digest',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    await generateAndDeliverDigest('weekly', context);
    return { status: 200, body: JSON.stringify({ status: 'Weekly digest sent' }) };
  },
});

// --- Core digest logic ---

async function generateAndDeliverDigest(type: 'daily' | 'weekly', context: InvocationContext): Promise<void> {
  const now = new Date();
  const lookbackHours = type === 'daily' ? 24 : 168;
  const since = new Date(now.getTime() - lookbackHours * 60 * 60 * 1000);

  const [thoughts, completed, channels] = await Promise.all([
    getThoughtsSince(since),
    getCompletedThoughtsSince(since),
    getDigestChannels(),
  ]);

  if (thoughts.length === 0 && completed.length === 0) {
    context.log(`No content for ${type} digest, skipping`);
    return;
  }

  // Build context for AI summary
  const thoughtList = thoughts.map(t => {
    const meta = t.metadata;
    return `- [${meta?.type || 'thought'}] ${meta?.title || 'Untitled'}: ${t.content.substring(0, 200)}`;
  }).join('\n');

  const completedList = completed.map(t => {
    const meta = t.metadata;
    return `- ✅ ${meta?.title || 'Untitled'}: ${t.content.substring(0, 150)}`;
  }).join('\n');

  // Generate AI summary
  const summary = await generateDigestSummary(type, thoughtList, completedList, thoughts.length, completed.length);

  // Build the full digest message
  const periodLabel = type === 'daily' ? 'Daily' : 'Weekly';
  const emoji = type === 'daily' ? '☀️' : '📊';

  let message = `${emoji} **Cerebro ${periodLabel} Digest**\n\n${summary}`;
  message += `\n\n---\n_${thoughts.length} new thoughts, ${completed.length} completed tasks_`;

  // Truncate for Teams (~24KB limit)
  if (message.length > 24000) {
    message = message.substring(0, 23900) + '\n\n_(truncated)_';
  }

  // Deliver to all registered channels
  if (channels.length > 0) {
    for (const channel of channels) {
      try {
        await sendTeamsProactiveMessage(channel, message);
        context.log(`Digest delivered to channel ${channel.teams_conversation_id}`);
      } catch (err) {
        context.error(`Failed to deliver digest to channel ${channel.teams_conversation_id}:`, err);
      }
    }
  } else {
    context.log('No digest channels registered, skipping Teams delivery');
  }

  // Deliver via email if configured
  if (isEmailConfigured()) {
    try {
      const htmlMessage = markdownToHtml(message);
      await sendDigestEmail(
        `${emoji} Cerebro ${periodLabel} Digest`,
        htmlMessage,
      );
      context.log('Digest email sent');
    } catch (err) {
      context.error('Failed to send digest email:', err);
    }
  }
}

// --- AI summary generation ---

async function generateDigestSummary(
  type: 'daily' | 'weekly',
  thoughtList: string,
  completedList: string,
  thoughtCount: number,
  completedCount: number,
): Promise<string> {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const deployment = process.env.AZURE_OPENAI_CHAT_DEPLOYMENT;

  if (!endpoint || !apiKey || !deployment) {
    return '_AI summary unavailable — Azure OpenAI not configured._';
  }

  const periodLabel = type === 'daily' ? "today's" : "this week's";
  const focusPrompt = type === 'daily'
    ? 'Provide a concise summary of themes, highlight any action items, and mention key people involved.'
    : 'Analyze patterns and themes across the week. Highlight goals, recurring topics, key relationships, and suggest areas of focus for next week.';

  const systemPrompt = `You are a personal knowledge assistant. Summarize ${periodLabel} captured thoughts into a brief, insightful digest.
${focusPrompt}
Keep the summary to 3-5 paragraphs. Use markdown formatting. Be conversational but concise.`;

  const userContent = `Here are ${periodLabel} thoughts (${thoughtCount} total):

${thoughtList || '(none)'}

Completed tasks (${completedCount}):
${completedList || '(none)'}`;

  const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=2024-06-01`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      temperature: 0.7,
      max_tokens: 1500,
    }),
  });

  if (!response.ok) {
    console.error('Digest AI summary failed:', response.status);
    return '_AI summary generation failed._';
  }

  const data = await response.json() as Record<string, unknown>;
  const choices = data.choices as Array<{ message: { content: string } }> | undefined;
  return choices?.[0]?.message?.content || '_No summary generated._';
}

// --- Bot Framework proactive messaging ---

let botToken: { token: string; expiresAt: number } | null = null;

async function getBotToken(): Promise<string> {
  if (botToken && Date.now() < botToken.expiresAt - 60000) {
    return botToken.token;
  }

  const botAppId = process.env.TEAMS_BOT_APP_ID;
  const botAppSecret = process.env.TEAMS_BOT_APP_SECRET;

  if (!botAppId || !botAppSecret) {
    throw new Error('Bot credentials not configured for digest delivery');
  }

  const response = await fetch('https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: botAppId,
      client_secret: botAppSecret,
      scope: 'https://api.botframework.com/.default',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error('Bot token request failed:', response.status, text);
    throw new Error(`Failed to get bot token: ${response.status}`);
  }

  const data = await response.json() as { access_token: string; expires_in: number };
  botToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return botToken.token;
}

async function sendTeamsProactiveMessage(channel: DigestChannel, message: string): Promise<void> {
  const token = await getBotToken();
  const serviceUrl = channel.teams_service_url;
  const conversationId = channel.teams_conversation_id;

  if (!serviceUrl || !conversationId) {
    throw new Error('Missing serviceUrl or conversationId for digest delivery');
  }

  const url = `${serviceUrl}v3/conversations/${encodeURIComponent(conversationId)}/activities`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'message',
      text: message,
      textFormat: 'markdown',
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to send proactive message: ${response.status} ${await response.text()}`);
  }
}

function markdownToHtml(markdown: string): string {
  return markdown
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/_(.*?)_/g, '<em>$1</em>')
    .replace(/\n/g, '<br>\n');
}
