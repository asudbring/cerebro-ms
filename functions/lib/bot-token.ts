// Shared Bot Framework token acquisition with caching

let cachedBotToken: { token: string; expiresAt: number } | null = null;

export async function getBotToken(): Promise<string> {
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
