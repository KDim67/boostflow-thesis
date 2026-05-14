import { adminFirestore, admin } from "@/lib/firebase/adminConfig";

export type AuditEventType =
  | "auth.login.success"
  | "auth.login.failure"
  | "auth.logout"
  | "auth.register"
  | "auth.password_reset_requested"
  | "auth.password_changed"
  | "auth.email_changed"
  | "permission.role_changed"
  | "permission.member_added"
  | "permission.member_removed"
  | "data.export"
  | "admin.action"
  | "api.access";

export type AuditSeverity = "info" | "warning" | "critical";

export interface AuditEvent {
  type: AuditEventType;
  severity: AuditSeverity;
  userId?: string | null;
  userEmail?: string | null;
  organizationId?: string | null;
  targetUserId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  resource?: string | null;
  action?: string | null;
  outcome: "success" | "failure";
  metadata?: Record<string, unknown>;
  reason?: string | null;
}

const COLLECTION = "audit_logs";

export async function recordAuditEvent(event: AuditEvent): Promise<void> {
  const doc = {
    ...event,
    userId: event.userId ?? null,
    userEmail: event.userEmail ?? null,
    organizationId: event.organizationId ?? null,
    targetUserId: event.targetUserId ?? null,
    ip: event.ip ?? null,
    userAgent: event.userAgent ?? null,
    resource: event.resource ?? null,
    action: event.action ?? null,
    metadata: event.metadata ?? {},
    reason: event.reason ?? null,
    createdAt: admin.firestore.Timestamp.now(),
  };

  await adminFirestore.collection(COLLECTION).add(doc);
}

export function extractRequestContext(request: Request): {
  ip: string | null;
  userAgent: string | null;
} {
  const headers = request.headers;
  const forwardedFor = headers.get("x-forwarded-for");
  const ip =
    (forwardedFor ? forwardedFor.split(",")[0]?.trim() : null) ||
    headers.get("x-real-ip") ||
    null;
  const userAgent = headers.get("user-agent");
  return { ip, userAgent };
}
