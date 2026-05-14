import type { User } from "firebase/auth";
import type { AuditEventType } from "@/lib/services/auditService";

export interface ClientAuditEvent {
  type: AuditEventType;
  outcome: "success" | "failure";
  userEmail?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
  user?: User | null;
}

export async function logAuditEvent(event: ClientAuditEvent): Promise<void> {
  if (globalThis.window === undefined) return;
  try {
    const idToken = event.user ? await event.user.getIdToken() : undefined;
    await fetch("/api/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: event.type,
        outcome: event.outcome,
        userEmail: event.userEmail ?? undefined,
        reason: event.reason ?? undefined,
        metadata: event.metadata,
        idToken,
      }),
      keepalive: true,
    });
  } catch (err) {
    console.warn("Audit log dispatch failed:", err);
  }
}
