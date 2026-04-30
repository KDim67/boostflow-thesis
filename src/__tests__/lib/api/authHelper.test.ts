import { validateOrigin, requireBearerToken } from "@/lib/api/authHelper";
import { NextRequest, NextResponse } from "next/server";

jest.mock("firebase-admin/auth", () => ({
  getAuth: jest.fn(() => ({
    verifyIdToken: jest.fn(),
  })),
}));

jest.mock("@/lib/firebase/admin", () => ({
  adminApp: {},
}));

import { getAuth } from "firebase-admin/auth";

const mockVerifyIdToken = jest.fn();
(getAuth as jest.Mock).mockReturnValue({ verifyIdToken: mockVerifyIdToken });

function makeRequest(
  authHeader?: string,
  options?: { method?: string; origin?: string; referer?: string }
): NextRequest {
  const headers: Record<string, string> = {};
  if (authHeader) headers.authorization = authHeader;
  if (options?.origin) headers.origin = options.origin;
  if (options?.referer) headers.referer = options.referer;
  return new NextRequest("http://localhost/api/test", {
    method: options?.method ?? "GET",
    headers,
  });
}

describe("requireBearerToken", () => {
  beforeEach(() => {
    mockVerifyIdToken.mockReset();
  });

  it("returns 401 when Authorization header is missing", async () => {
    const request = makeRequest();
    const result = await requireBearerToken(request);
    expect(result).toBeInstanceOf(NextResponse);
    const body = await (result as NextResponse).json();
    expect(body.error).toBe("Unauthorized");
    expect((result as NextResponse).status).toBe(401);
  });

  it("returns 401 when Authorization header does not start with Bearer", async () => {
    const request = makeRequest("Basic dXNlcjpwYXNz");
    const result = await requireBearerToken(request);
    expect(result).toBeInstanceOf(NextResponse);
    const body = await (result as NextResponse).json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when token verification throws", async () => {
    mockVerifyIdToken.mockRejectedValueOnce(new Error("invalid token"));
    const request = makeRequest("Bearer invalid-token");
    const result = await requireBearerToken(request);
    expect(result).toBeInstanceOf(NextResponse);
    const body = await (result as NextResponse).json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns uid on successful token verification", async () => {
    mockVerifyIdToken.mockResolvedValueOnce({ uid: "user-123" });
    const request = makeRequest("Bearer valid-token");
    const result = await requireBearerToken(request);
    expect(result).not.toBeInstanceOf(NextResponse);
    expect((result as { uid: string }).uid).toBe("user-123");
  });

  it("passes the correct token (without Bearer prefix) to verifyIdToken", async () => {
    mockVerifyIdToken.mockResolvedValueOnce({ uid: "user-abc" });
    const request = makeRequest("Bearer my-secret-token");
    await requireBearerToken(request);
    expect(mockVerifyIdToken).toHaveBeenCalledWith("my-secret-token");
  });

  it("returns 403 on POST without valid origin", async () => {
    const request = makeRequest("Bearer valid-token", { method: "POST" });
    const result = await requireBearerToken(request);
    expect(result).toBeInstanceOf(NextResponse);
    const body = await (result as NextResponse).json();
    expect(body.error).toBe("Forbidden: Invalid Origin or Referer");
    expect((result as NextResponse).status).toBe(403);
  });

  it("succeeds on POST with valid origin", async () => {
    mockVerifyIdToken.mockResolvedValueOnce({ uid: "user-post" });
    const request = makeRequest("Bearer valid-token", {
      method: "POST",
      origin: "http://localhost:3000",
    });
    const result = await requireBearerToken(request);
    expect(result).not.toBeInstanceOf(NextResponse);
    expect((result as { uid: string }).uid).toBe("user-post");
  });
});

describe("validateOrigin", () => {
  it("returns true for allowed origin", () => {
    const request = makeRequest(undefined, { origin: "http://localhost:3000" });
    expect(validateOrigin(request)).toBe(true);
  });

  it("returns true for production origin", () => {
    const request = makeRequest(undefined, { origin: "https://boostflow.me" });
    expect(validateOrigin(request)).toBe(true);
  });

  it("returns false for disallowed origin", () => {
    const request = makeRequest(undefined, { origin: "https://evil.com" });
    expect(validateOrigin(request)).toBe(false);
  });

  it("falls back to referer when origin is absent", () => {
    const request = makeRequest(undefined, {
      referer: "http://localhost:3000/some-page",
    });
    expect(validateOrigin(request)).toBe(true);
  });

  it("returns false for disallowed referer", () => {
    const request = makeRequest(undefined, {
      referer: "https://evil.com/phish",
    });
    expect(validateOrigin(request)).toBe(false);
  });

  it("returns false when both origin and referer are absent", () => {
    const request = makeRequest();
    expect(validateOrigin(request)).toBe(false);
  });

  it("returns false for malformed origin URL", () => {
    const request = makeRequest(undefined, { origin: "not-a-url" });
    expect(validateOrigin(request)).toBe(false);
  });
});
