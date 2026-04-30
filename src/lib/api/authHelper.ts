import { getAuth } from "firebase-admin/auth";
import { adminApp } from "@/lib/firebase/admin";
import { NextRequest, NextResponse } from "next/server";

export function validateOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  // Determine allowed origins dynamically based on env or hardcode for strictness
  const allowedOrigins = new Set([
    "https://boostflow.me",
    "http://localhost:3000",
  ]);

  // Exact matching strategy
  const isAllowed = (url: string | null) => {
    if (!url) return false;
    try {
      const urlObj = new URL(url);
      return allowedOrigins.has(urlObj.origin);
    } catch {
      return false; // Malformed URL
    }
  };

  // If Origin is present, validate it. Fallback to Referer. Fail safely if both are missing.
  if (origin) {
    return isAllowed(origin);
  } else if (referer) {
    return isAllowed(referer);
  }

  // If neither is present on a state-changing request, fail safely (deny).
  return false;
}

export async function requireBearerToken(
  request: NextRequest
): Promise<{ uid: string } | NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // CSRF Defense-in-Depth for state-changing methods
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
    if (!validateOrigin(request)) {
      return NextResponse.json(
        { error: "Forbidden: Invalid Origin or Referer" },
        { status: 403 }
      );
    }
  }

  try {
    const auth = getAuth(adminApp);
    const token = authHeader.substring(7);
    const decodedToken = await auth.verifyIdToken(token);
    return { uid: decodedToken.uid };
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
