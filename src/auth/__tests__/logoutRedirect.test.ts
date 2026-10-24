import { describe, expect, it } from 'vitest';
import { checkLogoutRedirect } from '../logoutRedirect';

/**
 * sk-303.42 — the post-logout redirect allow-list.
 *
 * Before: the only absolute URL accepted was one organisation's proxy host,
 * compiled in. Any other deployment's sign-out URL was refused, so its users
 * kept an active external session after a logout that reported success. These
 * tests pin the replacement: the permitted absolute URL is whatever the BFF
 * declared for THIS deployment, and nothing else.
 */
describe('checkLogoutRedirect', () => {
  const declared = 'https://sso.example.org/oauth2/sign_out';

  it("accepts the deployment's declared absolute URL", () => {
    expect(checkLogoutRedirect(declared, declared)).toEqual({ allowed: true });
  });

  it('accepts a declared URL on a host with no special naming', () => {
    // The point of the change: no host shape is privileged.
    const other = 'https://auth.example.net/logout';
    expect(checkLogoutRedirect(other, other)).toEqual({ allowed: true });
  });

  it('rejects a foreign absolute URL', () => {
    const verdict = checkLogoutRedirect('https://evil.example.com/oauth2/sign_out', declared);
    expect(verdict).toEqual({ allowed: false, reason: 'not-allowed' });
  });

  it('rejects any absolute URL when the deployment declared none', () => {
    expect(checkLogoutRedirect(declared, null)).toEqual({
      allowed: false,
      reason: 'not-allowed',
    });
    expect(checkLogoutRedirect(declared, undefined)).toEqual({
      allowed: false,
      reason: 'not-allowed',
    });
    expect(checkLogoutRedirect(declared, '')).toEqual({
      allowed: false,
      reason: 'not-allowed',
    });
  });

  it('rejects a same-host-different-path variation of the declared URL', () => {
    // Exact match, not prefix: the two sides come from one config value.
    const verdict = checkLogoutRedirect(
      'https://sso.example.org/oauth2/sign_out/../../admin',
      declared,
    );
    expect(verdict.allowed).toBe(false);
  });

  it("accepts a same-origin proxy's sign-out path, exactly", () => {
    // Kept for the deployment shape where the proxy shares this origin.
    // Exactly this path — a query string is no longer tolerated, because the
    // BFF never adds one and `?rd=` is how an open redirect would ride in.
    expect(checkLogoutRedirect('/oauth2/sign_out', null)).toEqual({ allowed: true });
    expect(checkLogoutRedirect('/oauth2/sign_out?rd=/', declared).allowed).toBe(false);
  });

  it('rejects protocol-relative targets even under /oauth2/', () => {
    // `//host/oauth2/...` is cross-origin to a browser despite the leading
    // slashes — it must never fall through to the path branch.
    expect(checkLogoutRedirect('//evil.example.com/oauth2/sign_out', declared)).toEqual({
      allowed: false,
      reason: 'protocol-relative',
    });
    expect(checkLogoutRedirect('//evil.example.com', declared)).toEqual({
      allowed: false,
      reason: 'protocol-relative',
    });
  });

  it("allows the BFF's own RP-logout path", () => {
    // KeycloakOidc mode — the mode production runs in — hands this path back
    // from POST /api/auth/logout, and navigating to it is what ends the realm
    // session. It used to be refused, which cleared the cookie while leaving
    // the Keycloak session alive: a logout that looked like it worked.
    expect(checkLogoutRedirect('/api/auth/oidc-signout', declared)).toEqual({
      allowed: true,
    });
    // Allowed with no absolute URL declared, too: this path is a contract of
    // the app, not of the deployment.
    expect(checkLogoutRedirect('/api/auth/oidc-signout', null)).toEqual({
      allowed: true,
    });
  });

  it('rejects sign-IN and other paths under the proxy namespace', () => {
    // The namespace used to be accepted wholesale, which let the sign-IN entry
    // point through a sign-OUT guard — and it carries a redirect target of its
    // own. The BFF never returns these, so nothing legitimate is lost.
    expect(checkLogoutRedirect('/oauth2/start', declared).allowed).toBe(false);
    expect(
      checkLogoutRedirect('/oauth2/start?rd=https://evil.example.com/', declared).allowed,
    ).toBe(false);
    expect(checkLogoutRedirect('/oauth2/sign_out?rd=https://evil.example.com/', declared).allowed).toBe(
      false,
    );
    expect(checkLogoutRedirect('/oauth2/', declared).allowed).toBe(false);
  });

  it('rejects other same-origin paths', () => {
    expect(checkLogoutRedirect('/', declared).allowed).toBe(false);
    // Neighbouring /api/auth paths stay refused — the match is exact, not a
    // prefix, so allowing the signout path does not open the whole route.
    expect(checkLogoutRedirect('/api/auth/me', declared).allowed).toBe(false);
    expect(checkLogoutRedirect('/api/auth/oidc-signout/../login', declared).allowed).toBe(
      false,
    );
  });

  it('rejects an empty target', () => {
    expect(checkLogoutRedirect('', declared).allowed).toBe(false);
  });
});
