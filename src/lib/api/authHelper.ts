import { getAuth } from "firebase-admin/auth";
import { adminApp } from "@/lib/firebase/admin";
import { NextRequest, NextResponse } from "next/server";

export async function requireBearerToken(
  request: NextRequest
): Promise<{ uid: string } | NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
