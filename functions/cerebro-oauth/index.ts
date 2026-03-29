import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { createHash, createHmac, randomBytes } from 'crypto';
import {
  getOAuthConfig,
  getBaseUrl,
  exchangeCodeForToken,
  getProtectedResourceMetadata,
  getAuthorizationServerMetadata,
  isOAuthConfigured,
} from '../lib/github-oauth.js';

// --- HMAC-signed state helpers ---

function getSigningKey(): string {
  return process.env.OAUTH_STATE_SECRET || process.env.GITHUB_OAUTH_CLIENT_SECRET || '';
}

function createSignedPayload(payload: object): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', getSigningKey()).update(payloadB64).digest('base64url');
  return `${payloadB64}.${signature}`;
}

function verifySignedPayload(signed: string): any {
  const dotIndex = signed.indexOf('.');
  if (dotIndex === -1) throw new Error('Invalid signed payload');
  const payloadB64 = signed.substring(0, dotIndex);
  const signature = signed.substring(dotIndex + 1);
  const expectedSignature = createHmac('sha256', getSigningKey()).update(payloadB64).digest('base64url');
  if (signature !== expectedSignature) throw new Error('Invalid signature');
  return JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
}

// --- Dynamic Client Registration (RFC 7591) ---
// In-memory registry — survives the lifetime of a warm function instance.
// Clients re-register on cold start, which is fine for this use case.

interface RegisteredClient {
  client_id: string;
  client_secret: string;
  redirect_uris: string[];
  client_name?: string;
  created_at: number;
}

const clientRegistry = new Map<string, RegisteredClient>();

// --- Protected Resource Metadata (RFC 9728) ---
// MCP clients discover auth requirements via this endpoint

app.http('oauth-protected-resource-metadata', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: '.well-known/oauth-protected-resource',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    if (!isOAuthConfigured()) {
      return { status: 503, body: 'OAuth not configured' };
    }
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(getProtectedResourceMetadata()),
    };
  },
});

// Also serve at the MCP-path-specific well-known URI
app.http('oauth-protected-resource-metadata-mcp', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: '.well-known/oauth-protected-resource/cerebro-mcp',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    if (!isOAuthConfigured()) {
      return { status: 503, body: 'OAuth not configured' };
    }
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(getProtectedResourceMetadata()),
    };
  },
});

// --- Authorization Server Metadata (RFC 8414) ---
// MCP clients discover OAuth endpoints via this

app.http('oauth-authorization-server-metadata', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: '.well-known/oauth-authorization-server',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    if (!isOAuthConfigured()) {
      return { status: 503, body: 'OAuth not configured' };
    }
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(getAuthorizationServerMetadata()),
    };
  },
});

// --- Dynamic Client Registration (RFC 7591) ---
// VS Code, opencode, and other compliant MCP clients POST here to register
// themselves before starting the OAuth flow.

app.http('oauth-register', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'oauth/register',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    if (!isOAuthConfigured()) {
      return { status: 503, body: 'OAuth not configured' };
    }

    let body: any = {};
    try {
      const text = await request.text();
      if (text) body = JSON.parse(text);
    } catch {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'invalid_client_metadata', error_description: 'Invalid JSON body' }),
      };
    }

    const clientId = randomBytes(16).toString('hex');
    const clientSecret = randomBytes(32).toString('hex');
    const redirectUris: string[] = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];

    clientRegistry.set(clientId, {
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uris: redirectUris,
      client_name: body.client_name,
      created_at: Date.now(),
    });

    context.log(`DCR: registered client ${clientId} (${body.client_name || 'unnamed'}) with ${redirectUris.length} redirect URIs`);

    return {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        client_secret_expires_at: 0, // never expires
        redirect_uris: redirectUris,
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_post',
        ...(body.client_name && { client_name: body.client_name }),
      }),
    };
  },
});

// --- OAuth Authorize Endpoint ---
// Redirects to GitHub's authorization page

app.http('oauth-authorize', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'oauth/authorize',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const { clientId } = getOAuthConfig();
      const url = new URL(request.url);

      // Pass through OAuth parameters from the MCP client
      const state = url.searchParams.get('state') || '';
      const redirectUri = url.searchParams.get('redirect_uri') || '';
      const codeChallenge = url.searchParams.get('code_challenge') || '';
      const codeChallengeMethod = url.searchParams.get('code_challenge_method') || '';
      const scope = url.searchParams.get('scope') || '';

      // Store PKCE and redirect_uri in HMAC-signed state
      // The state parameter is passed through GitHub and back to us
      const encodedState = createSignedPayload({
        original_state: state,
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        code_challenge_method: codeChallengeMethod,
      });

      // Build GitHub authorization URL
      const githubUrl = new URL('https://github.com/login/oauth/authorize');
      githubUrl.searchParams.set('client_id', clientId);
      githubUrl.searchParams.set('redirect_uri', `${getBaseUrl()}/oauth/callback`);
      githubUrl.searchParams.set('state', encodedState);
      githubUrl.searchParams.set('scope', scope || 'read:user');

      return {
        status: 302,
        headers: { 'Location': githubUrl.toString() },
      };
    } catch (err: any) {
      context.error('OAuth authorize error:', err);
      return { status: 500, body: `OAuth configuration error: ${err.message}` };
    }
  },
});

// --- OAuth Callback Endpoint ---
// GitHub redirects here after user authorization

app.http('oauth-callback', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'oauth/callback',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const url = new URL(request.url);
      const code = url.searchParams.get('code');
      const stateParam = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      if (error) {
        return { status: 400, body: `GitHub authorization error: ${error}` };
      }

      if (!code || !stateParam) {
        return { status: 400, body: 'Missing code or state parameter' };
      }

      // Verify signature and decode the state to get the original redirect_uri
      let statePayload: any;
      try {
        statePayload = verifySignedPayload(stateParam);
      } catch {
        return { status: 400, body: 'Invalid state parameter' };
      }

      const redirectUri = statePayload.redirect_uri;
      if (!redirectUri) {
        return { status: 400, body: 'No redirect_uri in state' };
      }

      // Wrap GitHub code with PKCE challenge for the token endpoint
      const wrappedCode = createSignedPayload({
        github_code: code,
        code_challenge: statePayload.code_challenge,
        code_challenge_method: statePayload.code_challenge_method,
      });

      // Redirect back to the MCP client with the wrapped authorization code
      // The client will then exchange it at our /oauth/token endpoint
      const callbackUrl = new URL(redirectUri);
      callbackUrl.searchParams.set('code', wrappedCode);
      if (statePayload.original_state) {
        callbackUrl.searchParams.set('state', statePayload.original_state);
      }

      return {
        status: 302,
        headers: { 'Location': callbackUrl.toString() },
      };
    } catch (err: any) {
      context.error('OAuth callback error:', err);
      return { status: 500, body: `Callback error: ${err.message}` };
    }
  },
});

// --- OAuth Token Endpoint ---
// Exchanges authorization code for access token

app.http('oauth-token', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'oauth/token',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      // Parse the token request (application/x-www-form-urlencoded)
      const body = await request.text();
      const params = new URLSearchParams(body);

      const grantType = params.get('grant_type');
      const code = params.get('code');
      const clientId = params.get('client_id');
      const clientSecret = params.get('client_secret');

      if (grantType !== 'authorization_code') {
        return {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'unsupported_grant_type' }),
        };
      }

      if (!code) {
        return {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'invalid_request', error_description: 'Missing code parameter' }),
        };
      }

      // Validate DCR client credentials if provided.
      // Clients registered via /oauth/register must present matching credentials.
      // Clients that didn't register (e.g. manual setups) are allowed through
      // since the GitHub token itself is the real security boundary.
      if (clientId) {
        const registered = clientRegistry.get(clientId);
        if (!registered) {
          return {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'invalid_client', error_description: 'Unknown client_id' }),
          };
        }
        if (clientSecret && registered.client_secret !== clientSecret) {
          return {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'invalid_client', error_description: 'Invalid client_secret' }),
          };
        }
      }

      // Decode the wrapped authorization code (contains GitHub code + PKCE challenge)
      const codeVerifier = params.get('code_verifier');
      let githubCode: string;
      let codeChallenge: string | undefined;
      let codeChallengeMethod: string | undefined;

      try {
        const decoded = verifySignedPayload(code);
        githubCode = decoded.github_code;
        codeChallenge = decoded.code_challenge || undefined;
        codeChallengeMethod = decoded.code_challenge_method || undefined;
      } catch {
        return {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid authorization code' }),
        };
      }

      // PKCE verification
      if (codeChallenge) {
        if (!codeVerifier) {
          return {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'invalid_grant', error_description: 'PKCE verification failed' }),
          };
        }
        let computedChallenge: string;
        if (codeChallengeMethod === 'S256') {
          computedChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
        } else {
          computedChallenge = codeVerifier;
        }
        if (computedChallenge !== codeChallenge) {
          return {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'invalid_grant', error_description: 'PKCE verification failed' }),
          };
        }
      }

      // Exchange the code with GitHub
      const tokenResponse = await exchangeCodeForToken(githubCode);

      // Return the token to the MCP client, forwarding any expiry/refresh
      // fields GitHub provided (GitHub Apps return expires_in + refresh_token;
      // classic OAuth Apps return neither, which is also fine).
      const responseBody: Record<string, any> = {
        access_token: tokenResponse.access_token,
        token_type: tokenResponse.token_type,
        scope: tokenResponse.scope,
      };
      if (tokenResponse.expires_in !== undefined) {
        responseBody.expires_in = tokenResponse.expires_in;
      }
      if (tokenResponse.refresh_token) {
        responseBody.refresh_token = tokenResponse.refresh_token;
      }

      return {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
        body: JSON.stringify(responseBody),
      };
    } catch (err: any) {
      context.error('OAuth token exchange error:', err);
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'invalid_grant', error_description: err.message }),
      };
    }
  },
});
