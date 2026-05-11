import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

describe("proxy", () => {
  it("sets Content-Security-Policy response header", () => {
    const request = new NextRequest("http://localhost:3000/");
    const response = proxy(request);
    const csp = response.headers.get("Content-Security-Policy");
    expect(csp).toBeTruthy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("sets x-nonce request header", () => {
    const request = new NextRequest("http://localhost:3000/");
    const response = proxy(request);
    expect(response).toBeTruthy();
  });

  it("includes nonce in production script-src", () => {
    const originalEnv = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = "production";

    const request = new NextRequest("http://localhost:3000/");
    const response = proxy(request);
    const csp = response.headers.get("Content-Security-Policy")!;
    const scriptSrc = csp
      .split(";")
      .find((d) => d.trim().startsWith("script-src"))!;
    expect(scriptSrc).toContain("'strict-dynamic'");
    expect(scriptSrc).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");

    (process.env as Record<string, string>).NODE_ENV = originalEnv!;
  });

  it("includes unsafe-inline and unsafe-eval in development script-src", () => {
    const originalEnv = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = "development";

    const request = new NextRequest("http://localhost:3000/");
    const response = proxy(request);
    const csp = response.headers.get("Content-Security-Policy")!;
    const scriptSrc = csp
      .split(";")
      .find((d) => d.trim().startsWith("script-src"))!;
    expect(scriptSrc).toContain("'unsafe-inline'");
    expect(scriptSrc).toContain("'unsafe-eval'");

    (process.env as Record<string, string>).NODE_ENV = originalEnv!;
  });

  it("generates unique nonce per request", () => {
    const req1 = new NextRequest("http://localhost:3000/");
    const req2 = new NextRequest("http://localhost:3000/");
    const csp1 = proxy(req1).headers.get("Content-Security-Policy")!;
    const csp2 = proxy(req2).headers.get("Content-Security-Policy")!;
    expect(csp1).not.toBe(csp2);
  });

  describe("COOP/COEP headers", () => {
    it.each(["/", "/contact", "/features"])(
      "sets same-origin COOP and unsafe-none COEP for %s",
      (path) => {
        const request = new NextRequest(`http://localhost:3000${path}`);
        const response = proxy(request);
        expect(response.headers.get("Cross-Origin-Opener-Policy")).toBe(
          "same-origin"
        );
        expect(response.headers.get("Cross-Origin-Embedder-Policy")).toBe(
          "unsafe-none"
        );
      }
    );

    it.each(["/login", "/signup"])(
      "sets same-origin-allow-popups COOP and unsafe-none COEP for %s",
      (path) => {
        const request = new NextRequest(`http://localhost:3000${path}`);
        const response = proxy(request);
        expect(response.headers.get("Cross-Origin-Opener-Policy")).toBe(
          "same-origin-allow-popups"
        );
        expect(response.headers.get("Cross-Origin-Embedder-Policy")).toBe(
          "unsafe-none"
        );
      }
    );
  });

  describe("CSRF cookie", () => {
    it("sets csrf_token cookie when not present", () => {
      const request = new NextRequest("http://localhost:3000/");
      const response = proxy(request);
      const setCookieHeader = response.headers.get("set-cookie");
      expect(setCookieHeader).toContain("csrf_token=");
      expect(setCookieHeader).toContain("Path=/");
      expect(setCookieHeader?.toLowerCase()).toContain("samesite=strict");
    });

    it("does not overwrite existing csrf_token cookie", () => {
      const request = new NextRequest("http://localhost:3000/", {
        headers: { cookie: "csrf_token=existing-token-value" },
      });
      const response = proxy(request);
      const setCookieHeader = response.headers.get("set-cookie");
      const hasCsrfSet =
        setCookieHeader !== null && setCookieHeader.includes("csrf_token=");
      expect(hasCsrfSet).toBe(false);
    });
  });
});
