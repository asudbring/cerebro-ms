// GitHub OAuth helper functions

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_API = 'https://api.github.com/user';

export interface GitHubUser {
  login: string;
  id: number;
  name: string | null;
  email: string | null;
}

export function getOAuthConfig() {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET must be set');
  }
  return { clientId, clientSecret };
}

export function isOAuthConfigured(): boolean {
  return !!(process.env.GITHUB_OAUTH_CLIENT_ID && process.env.GITHUB_OAUTH_CLIENT_SECRET);
}

/**
 * Get the base URL for OAuth endpoints.
 * In production, uses the function app URL. Locally, uses localhost.
 */
export function getBaseUrl(): string {
  // Azure Functions provides WEBSITE_HOSTNAME
  const hostname = process.env.WEBSITE_HOSTNAME;
  if (hostname && !hostname.includes('localhost')) {
    return `https://${hostname}`;
  }
  return 'http://localhost:7071';
}

/**
 * Exchange an authorization code for a GitHub access token.
 */
export async function exchangeCodeForToken(code: string): Promise<{ access_token: string; token_type: string; scope: string }> {
  const { clientId, clientSecret } = getOAuthConfig();

  const response = await fetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub token exchange failed: ${response.status}`);
  }

  const data = await response.json() as any;
  if (data.error) {
    throw new Error(`GitHub OAuth error: ${data.error_description || data.error}`);
  }

  return {
    access_token: data.access_token,
    token_type: data.token_type || 'bearer',
    scope: data.scope || '',
  };
}

/**
 * Validate a GitHub access token by calling the GitHub User API.
 * Returns the user info if valid, throws if invalid.
 */
export async function validateGitHubToken(token: string): Promise<GitHubUser> {
  const response = await fetch(GITHUB_USER_API, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'Cerebro-MCP/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub token validation failed: ${response.status}`);
  }

  const user = await response.json() as GitHubUser;
  return user;
}

/**
 * Extract Bearer token from Authorization header.
 */
export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

/**
 * Get the Protected Resource Metadata (RFC 9728) for this MCP server.
 */
export function getProtectedResourceMetadata(): object {
  const baseUrl = getBaseUrl();
  return {
    resource: `${baseUrl}/cerebro-mcp`,
    authorization_servers: [baseUrl],
    scopes_supported: ['read', 'write'],
    bearer_methods_supported: ['header'],
  };
}

/**
 * Get the Authorization Server Metadata (RFC 8414) wrapping GitHub OAuth.
 */
export function getAuthorizationServerMetadata(): object {
  const baseUrl = getBaseUrl();
  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['read', 'write'],
  };
}
