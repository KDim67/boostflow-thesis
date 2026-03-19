import { Timestamp, FieldValue } from "firebase/firestore";

export interface Notification {
  id: string;
  userId: string;
  organizationId?: string;
  title: string;
  message: string;
  type: NotificationType;
  read: boolean;
  hiddenFromDropdown?: boolean;
  createdAt: Timestamp | FieldValue;
  updatedAt: unknown;
  actionUrl?: string;
  metadata?: {
    organizationId?: string;
    membershipId?: string;
    [key: string]: unknown;
  };
}

export type NotificationType =
  | "organization_invite"
  | "organization_invite_accepted"
  | "organization_invite_declined"
  | "plan_upgrade"
  | "plan_downgrade"
  | "member_joined"
  | "member_left"
  | "system_announcement"
  | "direct_message"
  | "channel_added"
  | "general";

export interface NotificationPreferences {
  email: boolean;
  push: boolean;
  inApp: boolean;
  types: {
    [key in NotificationType]: boolean;
  };
}
