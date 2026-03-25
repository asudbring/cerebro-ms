import { ThoughtMetadata } from './types';

const getConfig = () => ({
  endpoint: process.env.AZURE_OPENAI_ENDPOINT || '',
  apiKey: process.env.AZURE_OPENAI_API_KEY || '',
  embeddingDeployment: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || '',
  chatDeployment: process.env.AZURE_OPENAI_CHAT_DEPLOYMENT || '',
  visionDeployment: process.env.AZURE_OPENAI_VISION_DEPLOYMENT || '',
});

const API_VERSION = '2024-06-01';

function buildUrl(endpoint: string, deployment: string): string {
  return `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${API_VERSION}`;
}

export async function getEmbedding(text: string): Promise<number[]> {
  const { endpoint, apiKey, embeddingDeployment } = getConfig();

  if (!endpoint) throw new Error('AZURE_OPENAI_ENDPOINT is not configured');
  if (!apiKey) throw new Error('AZURE_OPENAI_API_KEY is not configured');

  const url = `${endpoint}/openai/deployments/${embeddingDeployment}/embeddings?api-version=${API_VERSION}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: text, model: embeddingDeployment }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error('Embedding API error:', response.status, body);
    throw new Error(`Embedding API error: ${response.status} - ${body}`);
  }

  const data = await response.json();

  if (!data?.data?.[0]?.embedding) {
    throw new Error(`Unexpected embedding API response: ${JSON.stringify(data)}`);
  }

  return data.data[0].embedding;
}

export async function extractMetadata(content: string, source: 'mcp' | 'teams' = 'mcp'): Promise<ThoughtMetadata> {
  const { endpoint, apiKey, chatDeployment } = getConfig();

  if (!endpoint) throw new Error('AZURE_OPENAI_ENDPOINT is not configured');
  if (!apiKey) throw new Error('AZURE_OPENAI_API_KEY is not configured');

  const url = buildUrl(endpoint, chatDeployment);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: buildMetadataPrompt() },
        { role: 'user', content },
      ],
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error('Metadata extraction API error:', response.status, body);
    return defaultMetadata(content, source);
  }

  const data = await response.json();

  if (!data?.choices?.[0]?.message?.content) {
    console.error('Unexpected metadata API response:', JSON.stringify(data));
    return defaultMetadata(content, source);
  }

  try {
    const raw = JSON.parse(data.choices[0].message.content);
    return {
      title: raw.title || content.slice(0, 50),
      type: raw.type || 'observation',
      topics: Array.isArray(raw.topics) ? raw.topics : [],
      people: Array.isArray(raw.people) ? raw.people : [],
      action_items: Array.isArray(raw.action_items) ? raw.action_items : [],
      has_file: false,
      file_name: '',
      file_description: '',
      source,
    };
  } catch (e) {
    console.error('Failed to parse metadata response:', e);
    return defaultMetadata(content, source);
  }
}

function defaultMetadata(content: string, source: 'mcp' | 'teams' = 'mcp'): ThoughtMetadata {
  return {
    title: content.slice(0, 50),
    type: 'observation',
    topics: [],
    people: [],
    action_items: [],
    has_file: false,
    file_name: '',
    file_description: '',
    source,
  };
}

function buildMetadataPrompt(): string {
  const now = new Date();
  const centralTime = now.toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  return `You are a metadata extraction engine. Extract structured metadata from the user's thought.
Current date and time: ${centralTime} (Central Time, UTC-6)

Return a JSON object with these fields:
- title: short descriptive title (2-6 words)
- type: one of: idea, task, person_note, project_update, meeting_note, decision, reflection, reference, observation
- topics: array of 1-3 topic tags (lowercase, no hashtags)
- people: array of person names mentioned (empty if none)
- action_items: array of action items (empty if none)
- has_file: false (file metadata is added by the capture function, not here)
- file_name: ""
- file_description: ""
- source: "" (source is set by the capture function)

Return ONLY the JSON object, no markdown fencing.`;
}

export async function analyzeImage(base64Data: string, mimeType: string): Promise<string> {
  const { endpoint, apiKey, visionDeployment } = getConfig();
  const url = buildUrl(endpoint, visionDeployment);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'Describe this image in detail. Extract any text, data, or key information visible.' },
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}` } },
            ],
          },
        ],
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error('Image analysis API error:', response.status, body);
      return '(Image analysis unavailable)';
    }

    const data = await response.json();
    return data.choices[0].message.content || '(Image analysis unavailable)';
  } catch (e) {
    console.error('Image analysis failed:', e);
    return '(Image analysis unavailable)';
  }
}

export async function analyzeDocument(base64Data: string, mimeType: string, fileName: string): Promise<string> {
  const { endpoint, apiKey, visionDeployment } = getConfig();
  const url = buildUrl(endpoint, visionDeployment);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'Analyze this document and extract key information, text content, and important details.' },
          {
            role: 'user',
            content: [
              { type: 'text', text: `Document: ${fileName}` },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}` } },
            ],
          },
        ],
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error('Document analysis API error:', response.status, body);
      return '(Document analysis unavailable)';
    }

    const data = await response.json();
    return data.choices[0].message.content || '(Document analysis unavailable)';
  } catch (e) {
    console.error('Document analysis failed:', e);
    return '(Document analysis unavailable)';
  }
}
