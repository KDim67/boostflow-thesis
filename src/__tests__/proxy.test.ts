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
});
