// src/upstreamAuth.ts
//
// Forces Google "offline access" on the upstream OAuth authorization redirect
// so that the upstream token exchange returns a refresh_token.
//
// Why this exists:
//   Google only issues a refresh_token when the authorization request includes
//   `access_type=offline`. FastMCP v4's OAuthProxy.redirectToUpstream() builds
//   the Google consent URL with client_id, redirect_uri, response_type, state,
//   scope and PKCE — but never `access_type=offline`, and exposes no hook for
//   extra authorization parameters. Without a refresh_token the stored Google
//   access token (1-hour lifetime) can never be renewed: ~1 hour after a user
//   authenticates, every Google API call fails with "invalid authentication
//   credentials" until they manually re-authenticate.
//
//   With a refresh_token present, no further change is needed downstream:
//   remoteWrapper.createClients() already sets the refresh_token on the
//   per-request OAuth2Client and omits expiry_date, which is exactly the
//   condition under which google-auth-library auto-refreshes on a 401/403 and
//   retries the request (see oauth2client.requestAsync `mayRequireRefresh`).
//
//   `prompt=consent` is required so Google re-issues a refresh_token to users
//   who previously authorized the app WITHOUT offline access (i.e. everyone
//   who connected before this fix); otherwise Google suppresses the
//   refresh_token on subsequent grants.
/**
 * Rewrite a 302 authorization redirect Response so its Location requests Google
 * offline access. Returns the response unchanged if it has no Location header or
 * a non-absolute/invalid Location URL. All other headers and the status are
 * preserved; only the Location query string is augmented.
 */
export function withOfflineAccess(response) {
    const location = response.headers.get('Location');
    if (!location)
        return response;
    let url;
    try {
        url = new URL(location);
    }
    catch {
        return response;
    }
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    const headers = new Headers(response.headers);
    headers.set('Location', url.toString());
    return new Response(null, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}
/**
 * Patch an OAuthProxy instance so every upstream authorization redirect requests
 * Google offline access. Relies on OAuthProxy.redirectToUpstream being
 * synchronous (true in fastmcp 4.0.1, which the fork pins).
 */
export function enableUpstreamOfflineAccess(oauthProxy) {
    const proxy = oauthProxy;
    const original = proxy.redirectToUpstream.bind(proxy);
    proxy.redirectToUpstream = (transaction) => withOfflineAccess(original(transaction));
}
