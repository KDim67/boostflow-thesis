import { NextRequest, NextResponse } from "next/server";
import {
  recordAuditEvent,
  extractRequestContext,
  AuditEvent,
  AuditEventType,
  AuditSeverity,
} from "@/lib/services/auditService";
import { admin } from "@/lib/firebase/adminConfig";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, outcome, userEmail, reason, metadata, idToken } = body as {
      type: AuditEventType;
      outcome: "success" | "failure";
      userEmail?: string;
      reason?: string;
      metadata?: Record<string, unknown>;
      idToken?: string;
    };

    // Sanitize type by matching against allowed constants in a switch statement to satisfy static analyzers
    switch (type) {
      case "auth.login.success":
      case "auth.login.failure":
      case "auth.logout":
      case "auth.register":
      case "auth.password_reset_requested":
      case "auth.password_changed":
      case "auth.email_changed":
        break;
      default:
        return NextResponse.json(
          { error: "Invalid event type" },
          { status: 400 }
        );
    }

    if (outcome !== "success" && outcome !== "failure") {
      return NextResponse.json({ error: "Invalid outcome" }, { status: 400 });
    }

    // Determine if authentication is strictly required based on the sanitized event type
    const isAuthRequired =
      type === "auth.logout" ||
      type === "auth.password_changed" ||
      type === "auth.email_changed";

    let userId: string | null = null;
    let verifiedEmail: string | null = null;

    // Run verification unconditionally to prevent user-controlled branches from bypassing the security check
    try {
      const decoded = await admin.auth().verifyIdToken(idToken ?? "");
      userId = decoded.uid;
      verifiedEmail = decoded.email ?? null;
    } catch {
      if (isAuthRequired) {
        return NextResponse.json(
          { error: "Authentication token required or invalid for this event" },
          { status: 401 }
        );
      }
      // For unauthenticated events, we catch the verification failure (e.g. missing or invalid token) and proceed.
    }

    // Validate and sanitize user ID format if present
    if (
      userId &&
      (typeof userId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(userId))
    ) {
      return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
    }

    // Use verified email when token is present, fall back to validated user-supplied email for unauthenticated events
    const rawEmail =
      verifiedEmail ?? (isAuthRequired ? null : userEmail) ?? null;
    if (
      rawEmail &&
      (typeof rawEmail !== "string" ||
        rawEmail.length > 254 ||
        !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(rawEmail))
    ) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 }
      );
    }

    const severity: AuditSeverity =
      outcome === "failure" && type.startsWith("auth.") ? "warning" : "info";

    const { ip, userAgent } = extractRequestContext(request);

    const event: AuditEvent = {
      type,
      severity,
      outcome,
      userId,
      userEmail: rawEmail,
      ip,
      userAgent,
      reason: reason ?? null,
      metadata: metadata ?? {},
    };

    await recordAuditEvent(event);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Audit log error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
