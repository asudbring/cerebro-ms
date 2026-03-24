import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import {
  getOAuthConfig,
  getBaseUrl,
  exchangeCodeForToken,
  getProtectedResourceMetadata,
  getAuthorizationServerMetadata,
  isOAuthConfigured,
} from '../lib/github-oauth.js';

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
  route: '.well-known/oauth-protected-resource/api/cerebro-mcp',
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

      // Store PKCE and redirect_uri in state (base64url-encoded JSON)
      // The state parameter is passed through GitHub and back to us
      const statePayload = JSON.stringify({
        original_state: state,
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        code_challenge_method: codeChallengeMethod,
      });
      const encodedState = Buffer.from(statePayload).toString('base64url');

      // Build GitHub authorization URL
      const githubUrl = new URL('https://github.com/login/oauth/authorize');
      githubUrl.searchParams.set('client_id', clientId);
      githubUrl.searchParams.set('redirect_uri', `${getBaseUrl()}/api/oauth/callback`);
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

      // Decode the state to get the original redirect_uri
      let statePayload: any;
      try {
        statePayload = JSON.parse(Buffer.from(stateParam, 'base64url').toString());
      } catch {
        return { status: 400, body: 'Invalid state parameter' };
      }

      const redirectUri = statePayload.redirect_uri;
      if (!redirectUri) {
        return { status: 400, body: 'No redirect_uri in state' };
      }

      // Redirect back to the MCP client with the authorization code
      // The client will then exchange it at our /oauth/token endpoint
      const callbackUrl = new URL(redirectUri);
      callbackUrl.searchParams.set('code', code);
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

      // Exchange the code with GitHub
      const tokenResponse = await exchangeCodeForToken(code);

      // Return the token to the MCP client
      return {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
        body: JSON.stringify({
          access_token: tokenResponse.access_token,
          token_type: tokenResponse.token_type,
          scope: tokenResponse.scope,
        }),
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
