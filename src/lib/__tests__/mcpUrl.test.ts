import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveMcpUrl } from '../mcpUrl';

/**
 * sk-303.42 — the MCP address shown in the `.mcp.json` snippet.
 *
 * Before: the SPA rewrote a page host of `skein.<domain>` into
 * `skein-mcp.<domain>`. That is one deployment's ingress naming scheme, so an
 * install that merely happened to serve the UI from a host named `skein.` was
 * handed a hostname that does not resolve — and the agent it was pasted into
 * could not connect. These tests pin that the host name no longer decides
 * anything: the address is the deployment's configured one, or same-origin.
 */
describe('resolveMcpUrl', () => {
  // `protocol` and `host` are stubbed alongside `origin` on purpose: the
  // removed derivation read exactly those two, so a stub that omits them
  // would let the old code pass these tests by accident.
  const setHost = (origin: string) => {
    const { protocol, host } = new URL(origin);
    vi.stubGlobal('window', { location: { origin, protocol, host } });
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the configured URL when the deployment declares one', () => {
    setHost('https://skein.example.com');
    expect(resolveMcpUrl('https://mcp.example.net/mcp')).toBe('https://mcp.example.net/mcp');
  });

  it('falls back to same-origin /mcp on a host named `skein.`', () => {
    // The regression case. No configuration → no invented sibling host.
    setHost('https://skein.example.com');
    expect(resolveMcpUrl(null)).toBe('https://skein.example.com/mcp');
  });

  it('falls back to same-origin /mcp on any other host', () => {
    setHost('https://tasks.example.org');
    expect(resolveMcpUrl(null)).toBe('https://tasks.example.org/mcp');
    setHost('http://localhost:8080');
    expect(resolveMcpUrl(undefined)).toBe('http://localhost:8080/mcp');
  });

  it('treats a blank configured value as unset', () => {
    setHost('https://skein.example.com');
    expect(resolveMcpUrl('')).toBe('https://skein.example.com/mcp');
    expect(resolveMcpUrl('   ')).toBe('https://skein.example.com/mcp');
  });

  it('returns the relative path when there is no window (SSR)', () => {
    vi.stubGlobal('window', undefined);
    expect(resolveMcpUrl(null)).toBe('/mcp');
  });

  it('returns the configured URL even without a window', () => {
    vi.stubGlobal('window', undefined);
    expect(resolveMcpUrl('https://mcp.example.net/mcp')).toBe('https://mcp.example.net/mcp');
  });
});
