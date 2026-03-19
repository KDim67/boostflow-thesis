import { requireBearerToken } from "@/lib/api/authHelper";
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

function makeRequest(authHeader?: string): NextRequest {
  return new NextRequest("http://localhost/api/test", {
    headers: authHeader ? { authorization: authHeader } : {},
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
});
