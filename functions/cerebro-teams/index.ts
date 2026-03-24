import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateBotToken, isAllowedSender } from '../lib/auth';
import { insertThought, findClosestThought, updateThoughtStatus, upsertDigestChannel } from '../lib/database';
import { getEmbedding, extractMetadata, analyzeImage, analyzeDocument } from '../lib/azure-ai';
import { uploadFile, generateSasUrl } from '../lib/blob-storage';


// Bot reply prefixes — loop guard prevents re-processing our own replies
const BOT_REPLY_PREFIXES = ['**Captured**', '✅ **Marked done', '🔄 **Reopened', '🗑️ **Deleted'];
const STALE_MESSAGE_MS = 5 * 60 * 1000; // 5 minutes

// Cached Bot Framework token for sending replies
let cachedBotToken: { token: string; expiresAt: number } | null = null;

app.http('cerebro-teams', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cerebro-teams',
  handler: handleTeamsMessage,
});

async function handleTeamsMessage(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    // 1. Validate Bot Framework token
    const authHeader = request.headers.get('authorization') || '';
    await validateBotToken(authHeader);

    // 2. Parse activity
    const activity = await request.json() as any;

    // Only handle message activities
    if (activity.type !== 'message') {
      return { status: 200, body: '' };
    }

    // 3. Loop guard — reject bot's own replies
    const text = stripHtml(activity.text || '');
    if (BOT_REPLY_PREFIXES.some(prefix => text.startsWith(prefix))) {
      return { status: 200, body: '' };
    }

    // 4. Stale message guard
    if (activity.timestamp) {
      const messageAge = Date.now() - new Date(activity.timestamp).getTime();
      if (messageAge > STALE_MESSAGE_MS) {
        return { status: 200, body: '' };
      }
    }

    // 5. Sender allowlist check
    const senderObjectId = activity.from?.aadObjectId || '';
    if (!isAllowedSender(senderObjectId)) {
      return { status: 200, body: '' };
    }

    // 6. Register digest channel (fire-and-forget)
    if (activity.conversation?.id && activity.serviceUrl) {
      upsertDigestChannel('teams', {
        teams_service_url: activity.serviceUrl,
        teams_conversation_id: activity.conversation.id,
        teams_user_name: activity.from?.name || 'Unknown',
      }).catch(err => console.error('Failed to register digest channel:', err));
    }

    // 7. Determine intent
    const cleanText = text.trim();

    if (cleanText.toLowerCase().startsWith('done:')) {
      return await handleTaskComplete(cleanText.slice(5).trim(), activity);
    }
    if (cleanText.toLowerCase().startsWith('reopen:')) {
      return await handleTaskReopen(cleanText.slice(7).trim(), activity);
    }
    if (cleanText.toLowerCase().startsWith('delete:')) {
      return await handleTaskDelete(cleanText.slice(7).trim(), activity);
    }

    // 8. Handle as thought capture
    return await handleThoughtCapture(cleanText, activity);

  } catch (err: any) {
    console.error('Teams webhook error:', err);
    if (err.message?.includes('Authorization') || err.message?.includes('token')) {
      return { status: 401, body: 'Unauthorized' };
    }
    return { status: 500, body: 'Internal server error' };
  }
}

// --- Thought Capture ---

async function handleThoughtCapture(text: string, activity: any): Promise<HttpResponseInit> {
  let content = text;
  let fileUrl: string | undefined;
  let fileType: string | undefined;

  // Handle file attachments
  if (activity.attachments?.length) {
    for (const attachment of activity.attachments) {
      if (attachment.contentType === 'reference' || isFileAttachment(attachment)) {
        try {
          const fileResult = await processFileAttachment(attachment);
          if (fileResult) {
            content += `\n\n[File: ${fileResult.fileName}]\n${fileResult.analysis}`;
            fileUrl = fileResult.url;
            fileType = fileResult.mimeType;
          }
        } catch (err) {
          console.error('File processing error:', err);
        }
      }
    }
  }

  // Embedding + metadata in parallel
  const [embedding, metadata] = await Promise.all([
    getEmbedding(content),
    extractMetadata(content),
  ]);

  metadata.source = 'teams';
  if (fileUrl) {
    metadata.has_file = true;
    metadata.file_name = activity.attachments?.[0]?.name || '';
  }

  const thought = await insertThought(
    content, embedding, metadata,
    fileUrl, fileType,
    activity.id, // sourceMessageId for deduplication
  );

  const title = metadata.title || 'Untitled';
  const topics = metadata.topics?.length ? ` [${metadata.topics.join(', ')}]` : '';
  const reply = `**Captured:** ${title} (${metadata.type || 'thought'})${topics}`;

  await sendTeamsReply(activity, reply);

  return { status: 200, body: '' };
}

// --- Task Management ---

async function handleTaskComplete(description: string, activity: any): Promise<HttpResponseInit> {
  const embedding = await getEmbedding(description);
  const match = await findClosestThought(embedding, 'open');

  if (!match) {
    await sendTeamsReply(activity, '❌ No matching open task found.');
    return { status: 200, body: '' };
  }

  await updateThoughtStatus(match.id, 'done');
  const title = match.metadata?.title || 'Untitled';
  const similarity = (match.similarity * 100).toFixed(1);
  await sendTeamsReply(activity, `✅ **Marked done:** ${title} (${similarity}% match)`);
  return { status: 200, body: '' };
}

async function handleTaskReopen(description: string, activity: any): Promise<HttpResponseInit> {
  const embedding = await getEmbedding(description);
  const match = await findClosestThought(embedding, 'done');

  if (!match) {
    await sendTeamsReply(activity, '❌ No matching completed task found.');
    return { status: 200, body: '' };
  }

  await updateThoughtStatus(match.id, 'open');
  const title = match.metadata?.title || 'Untitled';
  const similarity = (match.similarity * 100).toFixed(1);
  await sendTeamsReply(activity, `🔄 **Reopened:** ${title} (${similarity}% match)`);
  return { status: 200, body: '' };
}

async function handleTaskDelete(description: string, activity: any): Promise<HttpResponseInit> {
  const embedding = await getEmbedding(description);
  let match = await findClosestThought(embedding, 'open');
  if (!match) match = await findClosestThought(embedding, 'done');

  if (!match) {
    await sendTeamsReply(activity, '❌ No matching thought found.');
    return { status: 200, body: '' };
  }

  await updateThoughtStatus(match.id, 'deleted');
  const title = match.metadata?.title || 'Untitled';
  const similarity = (match.similarity * 100).toFixed(1);
  await sendTeamsReply(activity, `🗑️ **Deleted:** ${title} (${similarity}% match)`);
  return { status: 200, body: '' };
}

// --- File Attachment Processing ---

async function processFileAttachment(attachment: any): Promise<{ fileName: string; url: string; mimeType: string; analysis: string } | null> {
  const fileName = attachment.name || 'unknown';
  const mimeType = getMimeType(fileName);

  // Download the file
  let fileBuffer: Buffer;

  if (attachment.contentUrl) {
    // Teams 'reference' attachments point to SharePoint — download via Graph API
    fileBuffer = await downloadTeamsFile(attachment.contentUrl);
  } else if (attachment.content) {
    fileBuffer = Buffer.from(attachment.content, 'base64');
  } else {
    return null;
  }

  // Upload to Azure Blob Storage
  const blobPath = await uploadFile(fileBuffer, fileName, mimeType);
  const sasUrl = await generateSasUrl(blobPath);

  // Analyze the file
  let analysis = '';
  const base64 = fileBuffer.toString('base64');

  if (mimeType.startsWith('image/')) {
    analysis = await analyzeImage(base64, mimeType);
  } else {
    analysis = await analyzeDocument(base64, mimeType, fileName);
  }

  return { fileName, url: sasUrl, mimeType, analysis };
}

async function downloadTeamsFile(contentUrl: string): Promise<Buffer> {
  // Reuse the Graph token from calendar.ts pattern — same credentials
  const token = await getGraphTokenForFiles();

  const response = await fetch(contentUrl, {
    headers: { 'Authorization': `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// --- Bot Framework Reply ---

async function getBotToken(): Promise<string> {
  if (cachedBotToken && Date.now() < cachedBotToken.expiresAt - 60000) {
    return cachedBotToken.token;
  }

  const botAppId = process.env.TEAMS_BOT_APP_ID;
  const botAppSecret = process.env.TEAMS_BOT_APP_SECRET;

  if (!botAppId || !botAppSecret) {
    throw new Error('TEAMS_BOT_APP_ID or TEAMS_BOT_APP_SECRET not configured');
  }

  const res = await fetch('https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: botAppId,
      client_secret: botAppSecret,
      scope: 'https://api.botframework.com/.default',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('Bot token request failed:', res.status, text);
    throw new Error(`Failed to get Bot Framework token: ${res.status}`);
  }

  const data = await res.json() as any;
  cachedBotToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedBotToken.token;
}

async function sendTeamsReply(activity: any, text: string): Promise<void> {
  const serviceUrl = activity.serviceUrl;
  const conversationId = activity.conversation?.id;
  const activityId = activity.id;

  if (!serviceUrl || !conversationId) {
    console.error('Missing serviceUrl or conversationId for reply');
    return;
  }

  try {
    const token = await getBotToken();

    const replyUrl = `${serviceUrl}v3/conversations/${encodeURIComponent(conversationId)}/activities/${encodeURIComponent(activityId)}`;

    const response = await fetch(replyUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'message',
        text,
        textFormat: 'markdown',
      }),
    });

    if (!response.ok) {
      console.error('Failed to send Teams reply:', response.status, await response.text());
    }
  } catch (err) {
    console.error('Error sending Teams reply:', err);
  }
}

// --- Graph API token for file downloads (cached separately from Bot token) ---

let cachedGraphToken: { token: string; expiresAt: number } | null = null;

async function getGraphTokenForFiles(): Promise<string> {
  if (cachedGraphToken && Date.now() < cachedGraphToken.expiresAt - 60000) {
    return cachedGraphToken.token;
  }

  const tenantId = process.env.GRAPH_TENANT_ID;
  const clientId = process.env.GRAPH_CLIENT_ID;
  const clientSecret = process.env.GRAPH_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('Graph API credentials not configured for file download');
  }

  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('Graph token request failed:', res.status, text);
    throw new Error(`Failed to get Graph token: ${res.status}`);
  }

  const data = await res.json() as any;
  cachedGraphToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedGraphToken.token;
}

// --- Utility Functions ---

function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, '').trim();
}

function isFileAttachment(attachment: any): boolean {
  return attachment.contentType === 'reference' ||
    (attachment.contentType && !attachment.contentType.startsWith('application/vnd.microsoft'));
}

function getMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const mimeMap: Record<string, string> = {
    'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
    'gif': 'image/gif', 'webp': 'image/webp', 'svg': 'image/svg+xml',
    'pdf': 'application/pdf', 'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'txt': 'text/plain', 'csv': 'text/csv', 'json': 'application/json',
    'mp4': 'video/mp4', 'mp3': 'audio/mpeg',
  };
  return mimeMap[ext] || 'application/octet-stream';
}
