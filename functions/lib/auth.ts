import * as jose from 'jose';

const BOT_FRAMEWORK_JWKS_URL = 'https://login.botframework.com/v1/.well-known/keys';

// createRemoteJWKSet handles JWKS caching and key rotation automatically
const jwks = jose.createRemoteJWKSet(new URL(BOT_FRAMEWORK_JWKS_URL));

export interface BotTokenPayload {
  serviceUrl: string;
  iss: string;
  aud: string;
  [key: string]: unknown;
}

export async function validateBotToken(authHeader: string): Promise<BotTokenPayload> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Missing or invalid Authorization header: expected "Bearer <token>"');
  }

  const token = authHeader.slice(7);
  if (!token) {
    throw new Error('Missing or invalid Authorization header: token is empty');
  }

  const botAppId = process.env.TEAMS_BOT_APP_ID;
  if (!botAppId) {
    throw new Error('TEAMS_BOT_APP_ID not configured');
  }

  const tenantId = process.env.TEAMS_BOT_TENANT_ID || '';

  const acceptedIssuers = [
    'https://api.botframework.com',
    `https://sts.windows.net/${tenantId}/`,
    `https://login.microsoftonline.com/${tenantId}/v2.0`,
  ];

  try {
    const { payload } = await jose.jwtVerify(token, jwks, {
      audience: botAppId,
      issuer: acceptedIssuers,
      clockTolerance: 300,
    });

    return payload as unknown as BotTokenPayload;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes('exp')) {
      console.error('Bot token expired:', message);
      throw new Error('Bot token has expired');
    }
    if (message.includes('iss')) {
      console.error('Bot token issuer rejected:', message);
      throw new Error(`Bot token issuer not accepted. Expected one of: ${acceptedIssuers.join(', ')}`);
    }
    if (message.includes('aud')) {
      console.error('Bot token audience mismatch:', message);
      throw new Error(`Bot token audience does not match TEAMS_BOT_APP_ID`);
    }

    console.error('Bot token validation failed:', message);
    throw new Error(`Bot token validation failed: ${message}`);
  }
}

export function isAllowedSender(aadObjectId: string): boolean {
  const allowList = process.env.TEAMS_ALLOWED_SENDERS;
  if (!allowList) return true;

  const allowed = allowList.split(',').map((id) => id.trim());
  return allowed.includes(aadObjectId);
}
