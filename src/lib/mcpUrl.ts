/**
 * MCP endpoint URL for the `.mcp.json` snippet rendered on the Api Keys
 * settings page.
 *
 * sk-303.42 — this used to DERIVE the address from `window.location.host`,
 * rewriting a `skein.<domain>` page host into a `skein-mcp.<domain>` MCP host.
 * That naming scheme belonged to exactly one deployment: any other install
 * that happened to serve the UI from a host named `skein.` was handed a
 * hostname that does not exist, and the agent it was pasted into simply failed
 * to connect. Installs on any other host name worked — by accident, via the
 * same-origin branch below.
 *
 * Where MCP lives is a fact about the deployment's topology, so it now comes
 * from the deployment: `mcpUrl` on `GET /api/auth/config`, configured on the
 * BFF as `SKEIN_MCP_URL`. It is set only when MCP is served from a different
 * origin than the UI — typically a dedicated ingress that bypasses the
 * authenticating proxy so agents can present a static `ska_…` key. Unset (the
 * usual single-host case, including local docker-compose) the endpoint is
 * same-origin `/mcp`.
 */

const MCP_PATH = '/mcp';

// NOTE for callers: `null` here means "the BFF declared no MCP address, so it
// is same-origin". It does NOT mean "not known yet". Do not call this with the
// `?? null` of an unresolved query — decide on the query state first, or the
// user is shown a plausible, wrong address. See ApiKeysPage.

/**
 * Resolve the MCP URL to show the user.
 *
 * @param configured `mcpUrl` from the BFF runtime config; `null`/`undefined`
 *   when this deployment serves MCP from the same origin as the UI.
 *
 * SSR-safe: with no `window` and nothing configured, the relative `/mcp` is
 * returned. The snippet is server-rendered as a copy template rather than a
 * live link, so a relative value is harmless until hydration.
 */
export function resolveMcpUrl(configured?: string | null): string {
  const declared = configured?.trim();
  if (declared) return declared;
  if (typeof window === 'undefined') return MCP_PATH;
  return `${window.location.origin}${MCP_PATH}`;
}
