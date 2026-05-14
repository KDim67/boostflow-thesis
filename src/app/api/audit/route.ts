import { NextRequest, NextResponse } from "next/server";
import {
  recordAuditEvent,
  extractRequestContext,
  AuditEvent,
  AuditEventType,
  AuditSeverity,
} from "@/lib/services/auditService";
import { admin } from "@/lib/firebase/adminConfig";

const ALLOWED_TYPES = new Set<AuditEventType>([
  "auth.login.success",
  "auth.login.failure",
  "auth.logout",
  "auth.register",
  "auth.password_reset_requested",
  "auth.password_changed",
  "auth.email_changed",
]);

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

    if (!type || !ALLOWED_TYPES.has(type)) {
      return NextResponse.json(
        { error: "Invalid event type" },
        { status: 400 }
      );
    }
    if (outcome !== "success" && outcome !== "failure") {
      return NextResponse.json({ error: "Invalid outcome" }, { status: 400 });
    }

    let userId: string | null = null;
    let verifiedEmail: string | null = null;
    if (idToken) {
      try {
        const decoded = await admin.auth().verifyIdToken(idToken);
        userId = decoded.uid;
        verifiedEmail = decoded.email ?? null;
      } catch {
        // Token invalid; still log the event but without verified identity.
      }
    }

    const severity: AuditSeverity =
      outcome === "failure" && type.startsWith("auth.") ? "warning" : "info";

    const { ip, userAgent } = extractRequestContext(request);

    const event: AuditEvent = {
      type,
      severity,
      outcome,
      userId,
      userEmail: verifiedEmail ?? userEmail ?? null,
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
