import { isOidcProviderPath } from "./oidc-provider-paths";

describe("isOidcProviderPath", () => {
  it("matches the root discovery documents", () => {
    expect(isOidcProviderPath("/.well-known/openid-configuration")).toBe(true);
    expect(isOidcProviderPath("/.well-known/oauth-authorization-server")).toBe(
      true,
    );
  });

  it("matches the provider endpoints under /oauth", () => {
    expect(isOidcProviderPath("/oauth")).toBe(true);
    expect(isOidcProviderPath("/oauth/auth")).toBe(true);
    expect(isOidcProviderPath("/oauth/auth/some-interaction-uid")).toBe(true);
    expect(isOidcProviderPath("/oauth/token")).toBe(true);
    expect(isOidcProviderPath("/oauth/token/revocation")).toBe(true);
    expect(isOidcProviderPath("/oauth/reg")).toBe(true);
    expect(isOidcProviderPath("/oauth/jwks")).toBe(true);
  });

  it("does not match the protected-resource metadata (served by Nest)", () => {
    // RFC 9728 metadata is a Nest controller, not a provider route.
    expect(isOidcProviderPath("/.well-known/oauth-protected-resource")).toBe(
      false,
    );
  });

  it("does not match the consent interaction routes (Nest controller)", () => {
    expect(isOidcProviderPath("/api/v1/oauth-consent/abc")).toBe(false);
    expect(isOidcProviderPath("/api/v1/oauth-consent/abc/confirm")).toBe(false);
  });

  it("does not match unrelated application or frontend paths", () => {
    expect(isOidcProviderPath("/")).toBe(false);
    expect(isOidcProviderPath("/api/v1/mcp")).toBe(false);
    expect(isOidcProviderPath("/auth/callback")).toBe(false);
    expect(isOidcProviderPath("/oauthx")).toBe(false);
    expect(isOidcProviderPath("/.well-known/other")).toBe(false);
  });
});
