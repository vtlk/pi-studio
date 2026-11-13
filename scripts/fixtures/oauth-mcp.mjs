import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

/** Disposable OAuth/PKCE provider and MCP endpoint. Synthetic credentials only, loopback only. */
export async function oauthMcpFixture(secret = '!QA_SYNTHETIC_${HOME}+$KEY') {
  const codes = new Map();
  const state = {
    authorized: 0,
    refreshed: 0,
    toolCalls: 0,
    tokenRequests: 0,
    registrations: 0,
    access: '',
    refresh: '',
    refreshAllowed: true,
    requiredScope: 'qa:read',
    grantedScope: '',
    clientSecretReceived: false,
    connected: 0,
    listed: 0,
  };
  let origin;
  const json = (response, status, body, headers = {}) => {
    response.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    response.end(JSON.stringify(body));
  };
  const tokens = (scope) => {
    state.refreshAllowed = true;
    state.access = 'QA_ACCESS_' + randomUUID();
    state.refresh = 'QA_REFRESH_' + randomUUID();
    state.grantedScope = scope;
    return {
      access_token: state.access,
      refresh_token: state.refresh,
      expires_in: 3600,
      token_type: 'Bearer',
      scope,
    };
  };
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, origin);
      if (url.pathname === '/.well-known/oauth-protected-resource')
        return json(response, 200, {
          resource: origin + '/mcp',
          authorization_servers: [origin],
          scopes_supported: ['qa:read', 'qa:write'],
        });
      if (url.pathname === '/.well-known/oauth-authorization-server')
        return json(response, 200, {
          issuer: origin,
          authorization_endpoint: origin + '/authorize',
          token_endpoint: origin + '/token',
          registration_endpoint: origin + '/register',
          scopes_supported: ['qa:read', 'qa:write'],
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
        });
      if (url.pathname === '/authorize') {
        assert.equal(url.searchParams.get('response_type'), 'code');
        assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
        assert.ok(url.searchParams.get('state'));
        const code = 'QA_CODE_' + randomUUID();
        codes.set(code, Object.fromEntries(url.searchParams));
        const redirect = new URL(url.searchParams.get('redirect_uri'));
        assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname));
        redirect.searchParams.set('code', code);
        redirect.searchParams.set('state', url.searchParams.get('state'));
        state.authorized++;
        response.writeHead(303, { Location: redirect.href });
        response.end();
        return;
      }
      let body = '';
      for await (const chunk of request) body += chunk;
      if (url.pathname === '/register') {
        state.registrations++;
        const metadata = JSON.parse(body);
        return json(response, 201, { ...metadata, client_id: 'qa-dynamic-client' });
      }
      if (url.pathname === '/token') {
        state.tokenRequests++;
        const data = new URLSearchParams(body);
        if (data.get('client_id') === 'qa-private-client') {
          assert.equal(data.get('client_secret'), secret);
          state.clientSecretReceived = true;
        }
        if (data.get('grant_type') === 'authorization_code') {
          const previous = codes.get(data.get('code'));
          assert.ok(previous);
          assert.equal(data.get('redirect_uri'), previous.redirect_uri);
          assert.equal(
            createHash('sha256').update(data.get('code_verifier')).digest('base64url'),
            previous.code_challenge,
          );
          codes.delete(data.get('code'));
          return json(response, 200, tokens(previous.scope));
        }
        if (
          data.get('grant_type') === 'refresh_token' &&
          state.refreshAllowed &&
          data.get('refresh_token') === state.refresh
        ) {
          state.refreshed++;
          return json(response, 200, tokens(state.grantedScope));
        }
        return json(response, 400, { error: 'invalid_grant' });
      }
      if (url.pathname !== '/mcp') return json(response, 404, {});
      if (
        request.headers.authorization !== 'Bearer ' + state.access ||
        !state.access ||
        !state.grantedScope.split(' ').includes(state.requiredScope)
      ) {
        const insufficient =
          !!state.access && request.headers.authorization === 'Bearer ' + state.access;
        return json(
          response,
          401,
          { error: 'unauthorized' },
          {
            'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource", scope="${state.requiredScope}"${insufficient ? ', error="insufficient_scope"' : ''}`,
          },
        );
      }
      if (request.method !== 'POST') {
        response.writeHead(405);
        response.end();
        return;
      }
      const data = JSON.parse(body);
      if (data.method === 'initialize') state.connected++;
      if (data.method === 'tools/list') state.listed++;
      if (!('id' in data)) {
        response.writeHead(202);
        response.end();
        return;
      }
      const result =
        data.method === 'initialize'
          ? {
              protocolVersion: data.params.protocolVersion,
              capabilities: { tools: {} },
              serverInfo: { name: 'QA OAuth MCP', version: '1' },
            }
          : data.method === 'tools/call'
            ? (() => {
                state.toolCalls++;
                return { content: [{ type: 'text', text: 'QA_OAUTH_TOOL_OK' }] };
              })()
            : data.method === 'tools/list'
              ? {
                  tools: [
                    {
                      name: 'oauth_proof',
                      description: 'Synthetic OAuth transport proof',
                      inputSchema: { type: 'object', properties: {} },
                    },
                  ],
                }
              : {};
      return json(response, 200, { jsonrpc: '2.0', id: data.id, result });
    } catch {
      json(response, 500, { error: 'qa_fixture_failed' });
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  return {
    url: origin + '/mcp',
    state,
    secret,
    async authorize(url) {
      assert.equal(new URL(url).origin, origin);
      const response = await fetch(url);
      assert.equal(response.ok, true);
    },
    expireAccess() {
      state.access = '';
    },
    revoke() {
      state.access = '';
      state.refreshAllowed = false;
    },
    requireScope(scope) {
      state.requiredScope = scope;
    },
    close() {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
