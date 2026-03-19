/**
 * Task interface defining the structure of a project task
 * Matches the structure used across the application for consistency
 */
export interface Task {
  id: string;
  title: string;
  description: string;
  status: "pending" | "in-progress" | "completed";
  priority: "low" | "medium" | "high";
  dueDate: string;
  projectId?: string;
  organizationId: string;
  assignedTo?: string;
  assignee?: string;
  hoursTracked?: number;
  timeSpent?: number;
  createdBy: string;
  createdAt: unknown;
  completedAt?: unknown;
}
