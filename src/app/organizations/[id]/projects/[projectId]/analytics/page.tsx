"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";

import { useAuth } from "@/lib/firebase/useAuth";
import { getDocument, queryDocuments } from "@/lib/firebase/firestoreService";
import { hasOrganizationPermission } from "@/lib/firebase/organizationService";
import { Project, OrganizationRole } from "@/lib/types/organization";
import { where, orderBy, limit, Timestamp } from "firebase/firestore";

// UI component for displaying status and priority badges
import Badge from "@/components/Badge";

// Interface defining the key performance metrics for a project
interface ProjectMetrics {
  totalTasks: number; // Total number of tasks in the project
  completedTasks: number; // Number of completed tasks
  overdueTasks: number; // Number of tasks past their due date
  teamMembers: number; // Number of team members assigned to the project
  avgCompletionTime: number; // Average time to complete tasks (in hours)
  productivityScore: number; // Calculated productivity percentage (0-100)
  weeklyProgress: number[]; // Array of daily task completions for the past week
}

// Interface for individual task data used in analytics
interface TaskAnalytics {
  id: string; // Unique task identifier
  title: string; // Task title/name
  status: string; // Current status (pending, in-progress, completed, etc.)
  priority: string; // Task priority level (low, medium, high)
  assignee: string; // Name of the person assigned to the task
  createdAt: Date; // When the task was created
  completedAt?: Date; // When the task was completed (optional)
  dueDate?: Date; // Task deadline (optional)
  timeSpent?: number; // Time spent on the task in minutes (optional)
}

// Interface for AI-generated insights and recommendations
interface AIInsight {
  id: string; // Unique insight identifier
  type: "suggestion" | "warning" | "optimization"; // Type of insight provided
  title: string; // Brief insight title
  description: string; // Detailed insight description
  impact: "high" | "medium" | "low"; // Expected impact level
  actionable: boolean; // Whether the insight can be acted upon
  timestamp: Date; // When the insight was generated
}

// Interface for time period filter options
interface TimeframeFilter {
  label: string; // Display name for the time period
  value: string; // Unique identifier for the filter
  days: number; // Number of days the filter represents
}

// Predefined time period options for filtering analytics data
const timeframeOptions: TimeframeFilter[] = [
  { label: "Last 7 days", value: "7d", days: 7 },
  { label: "Last 30 days", value: "30d", days: 30 },
  { label: "Last 90 days", value: "90d", days: 90 },
  { label: "Last 6 months", value: "6m", days: 180 },
  { label: "Last year", value: "1y", days: 365 },
];

/**
 * Utility function to convert various date formats to Date objects
 */
const safeToDate = (dateField: unknown): Date | undefined => {
  if (!dateField) return undefined;

  // Handle Firestore Timestamp objects
  const df = dateField as { toDate?: () => Date };
  if (typeof df.toDate === "function") {
    return df.toDate();
  }
  // Handle native Date objects
  if (dateField instanceof Date) {
    return dateField;
  }
  // Handle string dates with validation
  if (typeof dateField === "string") {
    const parsed = new Date(dateField);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  return undefined;
};

/**
 * Calculates the number of team members associated with a project, using
 * task assignees or project members as fallbacks if direct team membership fails.
 */
const calculateTeamMembersCount = async (
  projectId: string,
  organizationId: string,
  taskAnalytics: TaskAnalytics[],
  project: Project | null
): Promise<number> => {
  let teamMembersCount = 0;
  try {
    // First attempt: query team collection (where team members are actually stored)
    const teamMembers = await queryDocuments("team", [
      where("projectId", "==", projectId),
      where("organizationId", "==", organizationId),
    ]);
    teamMembersCount = teamMembers.length;

    // Second attempt: if no team members found, check for task assignees
    if (teamMembersCount === 0) {
      const uniqueAssignees = new Set();
      taskAnalytics.forEach((task) => {
        if (task.assignee && task.assignee !== "Unassigned") {
          uniqueAssignees.add(task.assignee);
        }
      });
      teamMembersCount = uniqueAssignees.size;
    }

    // Final fallback: use project.members array if no team members found
    if (teamMembersCount === 0 && project?.members) {
      teamMembersCount = Array.isArray(project.members)
        ? project.members.length
        : 0;
    }
  } catch (error) {
    console.error("Error fetching team members:", error);
    // Fallback: count unique assignees from tasks
    const uniqueAssignees = new Set();
    taskAnalytics.forEach((task) => {
      if (task.assignee && task.assignee !== "Unassigned") {
        uniqueAssignees.add(task.assignee);
      }
    });
    teamMembersCount = uniqueAssignees.size;

    // If still no team members, use project.members array
    if (teamMembersCount === 0 && project?.members) {
      teamMembersCount = Array.isArray(project.members)
        ? project.members.length
        : 0;
    }
  }
  return teamMembersCount;
};

/**
 * Calculates core metrics such as completion times, productivity scores,
 * and weekly progress based on task analytics.
 */
const calculateCoreMetrics = (
  taskAnalytics: TaskAnalytics[],
  teamMembersCount: number
): ProjectMetrics => {
  // Calculate core task metrics from the analytics data
  const totalTasks = taskAnalytics.length;
  const completedTasks = taskAnalytics.filter(
    (t) => t.status === "completed"
  ).length;
  const overdueTasks = taskAnalytics.filter(
    (t) => t.dueDate && t.dueDate < new Date() && t.status !== "completed" // Tasks past due date and not completed
  ).length;

  // Calculate average completion time for tasks with time tracking data
  const completedTasksWithTime = taskAnalytics.filter(
    (t) => t.status === "completed" && t.timeSpent && t.timeSpent > 0
  );
  const avgCompletionTime =
    completedTasksWithTime.length > 0
      ? completedTasksWithTime.reduce((sum, t) => sum + (t.timeSpent || 0), 0) /
        completedTasksWithTime.length /
        60 // Convert minutes to hours
      : 0;

  // Calculate productivity score as percentage of completed vs total tasks
  const productivityScore =
    totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  // Generate weekly progress data - tasks completed each day for the past 7 days
  const weeklyProgress = Array.from({ length: 7 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - i)); // Calculate date for each day (6 days ago to today)
    const dayTasks = taskAnalytics.filter(
      (t) => t.completedAt?.toDateString() === date.toDateString() // Match tasks completed on this specific day
    ).length;
    return dayTasks;
  });

  return {
    totalTasks,
    completedTasks,
    overdueTasks,
    teamMembers: teamMembersCount,
    avgCompletionTime,
    productivityScore,
    weeklyProgress,
  };
};

/**
 * Main analytics page component for displaying project performance metrics
 * Provides comprehensive analytics including task completion rates, team performance,
 * AI-generated insights, and interactive data visualizations
 */
export default function ProjectAnalyticsPage() {
  // Next.js hooks for accessing URL parameters and authentication context
  const params = useParams();
  const { user } = useAuth();

  // Core data state - project information and calculated metrics
  const [project, setProject] = useState<Project | null>(null);
  const [metrics, setMetrics] = useState<ProjectMetrics | null>(null);
  const [tasks, setTasks] = useState<TaskAnalytics[]>([]);
  const [aiInsights, setAiInsights] = useState<AIInsight[]>([]);

  // UI state management
  const [isLoading, setIsLoading] = useState(true); // Loading state for initial data fetch
  const [selectedTimeframe, setSelectedTimeframe] = useState("30d"); // Currently selected time period filter
  const [showAIPanel, setShowAIPanel] = useState(false); // Toggle for AI insights panel visibility
  const [isGeneratingInsights, setIsGeneratingInsights] = useState(false); // Loading state for AI insight generation
  const [hasAdminAccess, setHasAdminAccess] = useState(false); // User permission level for admin features
  const [error, setError] = useState<string | null>(null); // Error message display

  // Task interaction state
  const [isUpdatingTask, setIsUpdatingTask] = useState<string | null>(null); // Track which task is being updated

  // Modal state management for task operations
  const [assignModal, setAssignModal] = useState<{
    isOpen: boolean;
    taskId: string;
    taskTitle: string;
  }>({ isOpen: false, taskId: "", taskTitle: "" });
  const [editModal, setEditModal] = useState<{
    isOpen: boolean;
    taskId: string;
    currentTitle: string;
  }>({ isOpen: false, taskId: "", currentTitle: "" });

  // Notification system state
  const [notification, setNotification] = useState<{
    isOpen: boolean;
    message: string;
    type: "success" | "error";
  }>({ isOpen: false, message: "", type: "success" });

  // Extract URL parameters for project and organization identification
  const projectId = params.projectId as string;
  const organizationId = params.id as string;

  // Check user permissions to determine access level for admin features
  useEffect(() => {
    const checkPermissions = async () => {
      if (!user || !organizationId) return;

      try {
        // Check if user has permission to access analytics (member or higher)
        const canAccessAnalytics = await hasOrganizationPermission(
          user.uid,
          organizationId,
          "member" as OrganizationRole
        );

        if (!canAccessAnalytics) {
          setError("You do not have permission to access analytics features.");
          setIsLoading(false);
          return;
        }

        // Verify if user has admin privileges for AI insights and advanced features
        const isOwnerOrAdmin = await hasOrganizationPermission(
          user.uid,
          organizationId,
          "admin" as OrganizationRole
        );
        setHasAdminAccess(isOwnerOrAdmin);
      } catch (error) {
        console.error("Error checking permissions:", error);
        setError("Failed to verify permissions.");
        setIsLoading(false);
      }
    };

    checkPermissions();
  }, [user, organizationId]);

  // Fetch project details when component mounts or projectId changes
  useEffect(() => {
    const fetchProject = async () => {
      if (!projectId) return;

      try {
        // Retrieve project information from Firestore
        const projectData = await getDocument("projects", projectId);
        if (projectData) {
          setProject(projectData as Project);
        }
      } catch (error) {
        console.error("Error fetching project:", error);
        setError("Failed to load project data");
      }
    };

    fetchProject();
  }, [projectId]);

  // Main analytics data fetching effect - runs when project, timeframe, or projectId changes
  useEffect(() => {
    const fetchAnalyticsData = async () => {
      if (!projectId || !project) return;

      setIsLoading(true);
      try {
        // Calculate date range based on selected timeframe filter
        const timeframe = timeframeOptions.find(
          (t) => t.value === selectedTimeframe
        );
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - (timeframe?.days || 30));

        // Query tasks from Firestore with filters for project and date range
        const tasksData = await queryDocuments("tasks", [
          where("projectId", "==", projectId),
          where("createdAt", ">=", Timestamp.fromDate(startDate)),
          orderBy("createdAt", "desc"),
          limit(100), // Limit to 100 most recent tasks for performance
        ]);

        // Transform raw task data into analytics format with date handling
        const taskAnalytics: TaskAnalytics[] = tasksData.map((task) => {
          // Return normalized task object with fallback values for missing data
          return {
            id: task.id,
            title: task.title || "Untitled Task", // Default title if missing
            status: task.status || "pending", // Default status
            priority: task.priority || "medium", // Default priority level
            assignee:
              task.assignee && task.assignee.trim() !== ""
                ? task.assignee.trim()
                : "Unassigned", // Handle empty assignee
            createdAt: safeToDate(task.createdAt) || new Date(), // Ensure valid creation date
            completedAt: safeToDate(task.completedAt), // Optional completion date
            dueDate: safeToDate(task.dueDate), // Optional due date
            timeSpent: task.timeSpent || 0, // Default to 0 if no time tracked
          };
        });

        setTasks(taskAnalytics);

        // Calculate team member count with fallback strategies
        const teamMembersCount = await calculateTeamMembersCount(
          projectId,
          organizationId,
          taskAnalytics,
          project
        );

        // Compile current period metrics into a structured object
        const projectMetrics = calculateCoreMetrics(
          taskAnalytics,
          teamMembersCount
        );

        setMetrics(projectMetrics);

        // Determine if previous metrics should be updated (if missing or project is older than 24 hours)
        const shouldUpdatePreviousMetrics =
          !project.previousMetrics ||
          Date.now() - (safeToDate(project.createdAt)?.getTime() || 0) >
            24 * 60 * 60 * 1000;

        // Update previous metrics in Firestore for comparison purposes
        if (shouldUpdatePreviousMetrics) {
          try {
            const { updateDocument } =
              await import("@/lib/firebase/firestoreService");
            await updateDocument("projects", projectId, {
              previousMetrics: {
                totalTasks: projectMetrics.totalTasks,
                completedTasks: projectMetrics.completedTasks,
                overdueTasks: projectMetrics.overdueTasks,
                productivityScore: projectMetrics.productivityScore,
              },
              updatedAt: new Date(),
            });
          } catch (updateError) {
            console.error("Error updating previous metrics:", updateError);
          }
        }
      } catch (error) {
        console.error("Error fetching analytics data:", error);
        setError("Failed to load analytics data");
      } finally {
        setIsLoading(false);
      }
    };

    fetchAnalyticsData();
  }, [projectId, project, selectedTimeframe]);

  // Generate AI-powered insights based on project data (admin-only feature)
  const generateAIInsights = async () => {
    if (!hasAdminAccess || !metrics || !project) return;

    setIsGeneratingInsights(true);
    try {
      // Serialize task data for API transmission (limit to 20 most recent tasks)
      const serializedTasks = tasks.slice(0, 20).map((task) => ({
        ...task,
        createdAt: task.createdAt.toISOString(), // Convert Date objects to ISO strings
        completedAt: task.completedAt?.toISOString(), // Handle optional completion date
        dueDate: task.dueDate?.toISOString(), // Handle optional due date
      }));

      // Call AI insights API with project data and metrics
      const response = await fetch("/api/ai/insights", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId,
          projectName: project.name,
          metrics,
          tasks: serializedTasks,
          timeframe: selectedTimeframe,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to generate insights");
      }

      // Process and store AI-generated insights with unique IDs and timestamps
      const insights = await response.json();
      setAiInsights(
        insights.map((insight: Record<string, unknown>, index: number) => ({
          id: `insight-${Date.now()}-${index}`, // Generate unique ID for each insight
          ...insight,
          timestamp: new Date(), // Add timestamp for tracking
        }))
      );
    } catch (error) {
      console.error("Error generating AI insights:", error);
    } finally {
      setIsGeneratingInsights(false);
    }
  };

  // Handle task completion with optimistic UI updates
  const handleCompleteTask = async (taskId: string) => {
    if (!taskId) return;

    setIsUpdatingTask(taskId);
    try {
      // Update task status in Firestore
      const { updateDocument } =
        await import("@/lib/firebase/firestoreService");
      await updateDocument("tasks", taskId, {
        status: "completed",
        completedAt: new Date(),
        updatedAt: new Date(),
      });

      // pdate local task state for immediate UI feedback
      setTasks((prevTasks) =>
        prevTasks.map((task) =>
          task.id === taskId
            ? { ...task, status: "completed", completedAt: new Date() }
            : task
        )
      );

      // Recalculate metrics based on updated task data
      const timeframe = timeframeOptions.find(
        (t) => t.value === selectedTimeframe
      );
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - (timeframe?.days || 30));

      const updatedTasks = tasks.map((task) =>
        task.id === taskId
          ? { ...task, status: "completed", completedAt: new Date() }
          : task
      );

      // Recalculate key metrics after task completion
      const totalTasks = updatedTasks.length;
      const completedTasks = updatedTasks.filter(
        (t) => t.status === "completed"
      ).length;
      const overdueTasks = updatedTasks.filter(
        (t) => t.dueDate && t.dueDate < new Date() && t.status !== "completed"
      ).length;

      const productivityScore =
        totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

      // Update metrics state with new calculations
      if (metrics) {
        setMetrics({
          ...metrics,
          completedTasks,
          overdueTasks,
          productivityScore,
        });
      }
    } catch (error) {
      console.error("Error completing task:", error);
      setNotification({
        isOpen: true,
        message: "Failed to complete task. Please try again.",
        type: "error",
      });
    } finally {
      setIsUpdatingTask(null);
    }
  };

  // Open task assignment modal with task details
  const handleAssignTask = (taskId: string, taskTitle: string) => {
    setAssignModal({ isOpen: true, taskId, taskTitle });
  };

  // Submit task assignment to a new team member
  const submitAssignTask = async (taskId: string, newAssignee: string) => {
    try {
      // Update assignee in Firestore
      const { updateDocument } =
        await import("@/lib/firebase/firestoreService");
      await updateDocument("tasks", taskId, {
        assignee: newAssignee.trim(),
        updatedAt: new Date(),
      });

      // Update local task state for immediate UI feedback
      setTasks((prevTasks) =>
        prevTasks.map((task) =>
          task.id === taskId ? { ...task, assignee: newAssignee.trim() } : task
        )
      );

      // Show success notification and close modal
      setNotification({
        isOpen: true,
        message: `Task successfully assigned to ${newAssignee.trim()}`,
        type: "success",
      });
      setAssignModal({ isOpen: false, taskId: "", taskTitle: "" });
    } catch (error) {
      console.error("Error assigning task:", error);
      setNotification({
        isOpen: true,
        message: "Failed to assign task. Please try again.",
        type: "error",
      });
    }
  };

  // Open task editing modal with current title
  const handleEditTask = (taskId: string, currentTitle: string) => {
    setEditModal({ isOpen: true, taskId, currentTitle });
  };

  // Submit task title update
  const submitEditTask = async (taskId: string, newTitle: string) => {
    try {
      // Update task title in Firestore
      const { updateDocument } =
        await import("@/lib/firebase/firestoreService");
      await updateDocument("tasks", taskId, {
        title: newTitle.trim(),
        updatedAt: new Date(),
      });

      // Update local task state for immediate UI feedback
      setTasks((prevTasks) =>
        prevTasks.map((task) =>
          task.id === taskId ? { ...task, title: newTitle.trim() } : task
        )
      );

      // Show success notification and close modal
      setNotification({
        isOpen: true,
        message: "Task title updated successfully",
        type: "success",
      });
      setEditModal({ isOpen: false, taskId: "", currentTitle: "" });
    } catch (error) {
      console.error("Error editing task:", error);
      setNotification({
        isOpen: true,
        message: "Failed to edit task. Please try again.",
        type: "error",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="w-16 h-16 bg-red-100 dark:bg-red-900 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-red-600 dark:text-red-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
            Error Loading Analytics
          </h3>
          <p className="text-gray-600 dark:text-gray-400">{error}</p>
        </div>
      </div>
    );
  }

  if (!project || !metrics) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
            Project Not Found
          </h3>
          <p className="text-gray-600 dark:text-gray-400">
            The requested project could not be found.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 rounded-3xl">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between py-6 space-y-4 lg:space-y-0">
            <div className="flex-1">
              <div className="flex items-center space-x-3 mb-2">
                <div className="w-8 h-8 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
                  <svg
                    className="w-5 h-5 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                    />
                  </svg>
                </div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {project.name} Analytics
                </h1>
              </div>
              <p className="text-gray-600 dark:text-gray-400 text-sm">
                Real-time insights and performance metrics for your project
              </p>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center space-x-2">
                <label
                  htmlFor="timeframe-select"
                  className="text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  Period:
                </label>
                <select
                  id="timeframe-select"
                  value={selectedTimeframe}
                  onChange={(e) => setSelectedTimeframe(e.target.value)}
                  className="bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 dark:text-gray-100 min-w-[140px]"
                >
                  {timeframeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {hasAdminAccess && (
                <button
                  onClick={() => setShowAIPanel(!showAIPanel)}
                  className={`bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white px-4 py-2 rounded-lg transition-all duration-200 flex items-center space-x-2 focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 shadow-md hover:shadow-lg ${showAIPanel ? "ring-2 ring-purple-300" : ""}`}
                  aria-label={
                    showAIPanel ? "Hide AI Insights" : "Show AI Insights"
                  }
                >
                  <svg
                    className="w-4 h-4"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
                  </svg>
                  <span className="font-medium">AI Insights</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-8">
          {/* AI Insights Panel - Enhanced Layout */}
          {showAIPanel && hasAdminAccess && (
            <div className="bg-gradient-to-br from-white to-gray-50 dark:from-gray-800 dark:to-gray-900 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="bg-gradient-to-r from-purple-600 to-blue-600 p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
                      <svg
                        className="w-6 h-6 text-white"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
                      </svg>
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-white">
                        AI Insights
                      </h2>
                      <p className="text-purple-100 text-sm">
                        Intelligent recommendations for your project
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={generateAIInsights}
                    disabled={isGeneratingInsights}
                    className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2 focus:ring-2 focus:ring-white/50 backdrop-blur-sm"
                    aria-label="Generate AI insights"
                  >
                    {isGeneratingInsights ? (
                      <>
                        <div
                          className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"
                          aria-hidden="true"
                        ></div>
                        <span className="font-medium">Generating...</span>
                      </>
                    ) : (
                      <>
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                          />
                        </svg>
                        <span className="font-medium">Refresh Insights</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="p-6">
                {aiInsights.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="w-16 h-16 bg-gradient-to-br from-purple-100 to-blue-100 dark:from-purple-900 dark:to-blue-900 rounded-full flex items-center justify-center mx-auto mb-4">
                      <svg
                        className="w-8 h-8 text-purple-600 dark:text-purple-400"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
                      </svg>
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                      No Insights Yet
                    </h3>
                    <p className="text-gray-600 dark:text-gray-400 mb-4">
                      Click "Refresh Insights" to generate AI-powered
                      recommendations for your project
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {aiInsights.map((insight) => (
                      <div
                        key={insight.id}
                        className="group bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl p-5 hover:shadow-lg hover:border-purple-300 dark:hover:border-purple-600 transition-all duration-300 transform hover:-translate-y-1"
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div
                            className={`w-4 h-4 rounded-full mt-0.5 shadow-sm ${(() => {
                              if (insight.impact === "high")
                                return "bg-red-500";
                              if (insight.impact === "medium")
                                return "bg-yellow-500";
                              return "bg-green-500";
                            })()}`}
                            aria-label={`${insight.impact} impact`}
                          ></div>
                          <span
                            className={`text-xs px-3 py-1 rounded-full font-semibold uppercase tracking-wide ${(() => {
                              if (insight.type === "suggestion")
                                return "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300";
                              if (insight.type === "warning")
                                return "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300";
                              return "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300";
                            })()}`}
                          >
                            {insight.type}
                          </span>
                        </div>
                        <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-3 group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">
                          {insight.title}
                        </h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4 leading-relaxed">
                          {insight.description}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Main Analytics */}
          <div className="space-y-8">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              <KPICard
                title="Total Tasks"
                value={metrics.totalTasks}
                icon={
                  <svg
                    className="w-7 h-7 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                    />
                  </svg>
                }
                color="blue"
                previousValue={project.previousMetrics?.totalTasks}
                currentValue={metrics.totalTasks}
                subtext="from last period"
              />
              <KPICard
                title="Completed"
                value={metrics.completedTasks}
                icon={
                  <svg
                    className="w-7 h-7 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                }
                color="green"
                previousValue={project.previousMetrics?.completedTasks}
                currentValue={metrics.completedTasks}
                subtext="completion rate"
              />
              <KPICard
                title="Overdue"
                value={metrics.overdueTasks}
                icon={
                  <svg
                    className="w-7 h-7 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                }
                color="red"
                previousValue={project.previousMetrics?.overdueTasks}
                currentValue={metrics.overdueTasks}
                isDecreasePositive={true}
                changeType="percentage_abs"
                subtext="from last period"
              />
              <KPICard
                title="Productivity"
                value={`${metrics.productivityScore}%`}
                icon={
                  <svg
                    className="w-7 h-7 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                    />
                  </svg>
                }
                color="purple"
                previousValue={project.previousMetrics?.productivityScore}
                currentValue={metrics.productivityScore}
                changeType="difference"
                subtext="efficiency gain"
              />
            </div>

            {/* Charts and Additional Metrics */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Weekly Progress Chart */}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 border border-gray-200 dark:border-gray-700 hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                      Weekly Progress
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                      Tasks completed per day
                    </p>
                  </div>
                  <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center">
                    <svg
                      className="w-5 h-5 text-white"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                      />
                    </svg>
                  </div>
                </div>
                <div className="h-64 flex items-end justify-between space-x-3 bg-gray-50 dark:bg-gray-700/30 rounded-lg p-4">
                  {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
                    (day, index) => {
                      const value = metrics.weeklyProgress.at(index) ?? 0;
                      const maxValue = Math.max(...metrics.weeklyProgress);
                      const minHeight = value > 0 ? 15 : 0;
                      const height =
                        maxValue > 0
                          ? Math.max((value / maxValue) * 90, minHeight)
                          : 0;

                      return (
                        <div
                          key={day}
                          className="flex-1 flex flex-col items-center group"
                        >
                          <div
                            className="w-full bg-gradient-to-t from-blue-500 to-blue-400 rounded-t-lg transition-all duration-300 hover:from-blue-600 hover:to-blue-500 cursor-pointer shadow-sm"
                            style={{
                              height: `${height}%`,
                              minHeight: value > 0 ? "20px" : "4px",
                            }}
                            title={`${day}: ${value} tasks completed`}
                          ></div>
                          <span className="text-xs text-gray-600 dark:text-gray-400 mt-3 font-medium">
                            {day}
                          </span>
                          <span className="text-xs font-semibold text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800 px-2 py-1 rounded-full mt-1 shadow-sm">
                            {value}
                          </span>
                        </div>
                      );
                    }
                  )}
                </div>
              </div>

              {/* Team Performance */}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 border border-gray-200 dark:border-gray-700 hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                      Team Performance
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                      Key metrics overview
                    </p>
                  </div>
                  <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-green-600 rounded-lg flex items-center justify-center">
                    <svg
                      className="w-5 h-5 text-white"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                      />
                    </svg>
                  </div>
                </div>
                <div className="space-y-6">
                  <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700/30 rounded-lg">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
                        <svg
                          className="w-4 h-4 text-blue-600 dark:text-blue-400"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth="1.5"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"
                          />
                        </svg>
                      </div>
                      <div>
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          Team Members
                        </div>
                        <div className="text-xs text-gray-600 dark:text-gray-400">
                          Active contributors
                        </div>
                      </div>
                    </div>
                    <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                      {metrics.teamMembers}
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700/30 rounded-lg">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-orange-100 dark:bg-orange-900 rounded-full flex items-center justify-center">
                        <svg
                          className="w-4 h-4 text-orange-600 dark:text-orange-400"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                          />
                        </svg>
                      </div>
                      <div>
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          Avg. Completion
                        </div>
                        <div className="text-xs text-gray-600 dark:text-gray-400">
                          Hours per task
                        </div>
                      </div>
                    </div>
                    <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                      {Math.round(metrics.avgCompletionTime)}h
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Recent Tasks */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
              <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  Recent Tasks
                </h2>
                <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">
                  Latest project tasks with quick actions
                </p>
              </div>
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0 z-10">
                    <tr>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                        Task
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                        Priority
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                        Assignee
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                        Due Date
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {tasks.slice(0, 10).map((task) => {
                      const isOverdue =
                        task.dueDate &&
                        task.dueDate < new Date() &&
                        task.status !== "completed";
                      const isCompleted = task.status === "completed";

                      return (
                        <tr
                          key={task.id}
                          className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors group"
                        >
                          <td className="px-6 py-4">
                            <div className="flex items-center space-x-3">
                              {/* Visual Status Indicator */}
                              <div
                                className={`w-3 h-3 rounded-full flex-shrink-0 ${(() => {
                                  if (isCompleted) return "bg-green-500";
                                  if (isOverdue) return "bg-red-500";
                                  if (task.status === "in-progress")
                                    return "bg-blue-500";
                                  return "bg-gray-400";
                                })()}`}
                                aria-label={`Task status: ${task.status}`}
                              ></div>
                              <div className="min-w-0 flex-1">
                                <div
                                  className={`text-sm font-medium truncate ${
                                    isCompleted
                                      ? "text-gray-500 dark:text-gray-400 line-through"
                                      : "text-gray-900 dark:text-gray-100"
                                  }`}
                                >
                                  {task.title}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <Badge
                              type="status"
                              value={
                                isOverdue && task.status !== "completed"
                                  ? "overdue"
                                  : task.status
                              }
                              variant="with-icon"
                              size="sm"
                              className="inline-flex px-3 py-1 font-semibold"
                            />
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <Badge
                              type="priority"
                              value={task.priority as "low" | "medium" | "high"}
                              variant="with-icon"
                              size="md"
                              className="inline-flex px-3 py-1 font-semibold"
                            />
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900 dark:text-gray-100 font-medium">
                              {task.assignee}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div
                              className={`text-sm ${
                                isOverdue
                                  ? "text-red-600 dark:text-red-400 font-semibold"
                                  : "text-gray-900 dark:text-gray-100"
                              }`}
                            >
                              {task.dueDate
                                ? task.dueDate.toLocaleDateString()
                                : "No due date"}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center space-x-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              {!isCompleted && (
                                <button
                                  className="bg-green-100 hover:bg-green-200 dark:bg-green-900 dark:hover:bg-green-800 text-green-800 dark:text-green-200 px-2 py-1 rounded text-xs font-medium transition-colors focus:ring-2 focus:ring-green-500 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed"
                                  onClick={() => handleCompleteTask(task.id)}
                                  disabled={isUpdatingTask === task.id}
                                  aria-label={`Mark ${task.title} as complete`}
                                >
                                  {isUpdatingTask === task.id
                                    ? "Completing..."
                                    : "Complete"}
                                </button>
                              )}
                              <button
                                className="bg-blue-100 hover:bg-blue-200 dark:bg-blue-900 dark:hover:bg-blue-800 text-blue-800 dark:text-blue-200 px-2 py-1 rounded text-xs font-medium transition-colors focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                                onClick={() =>
                                  handleAssignTask(task.id, task.title)
                                }
                                aria-label={`Reassign ${task.title}`}
                              >
                                Assign
                              </button>
                              <button
                                className="bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 px-2 py-1 rounded text-xs font-medium transition-colors focus:ring-2 focus:ring-gray-500 focus:ring-offset-1"
                                onClick={() =>
                                  handleEditTask(task.id, task.title)
                                }
                                aria-label={`Edit ${task.title}`}
                              >
                                Edit
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {tasks.length > 10 && (
                <div className="p-4 border-t border-gray-200 dark:border-gray-700 text-center">
                  <button className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 text-sm font-medium focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded px-2 py-1">
                    View All Tasks ({tasks.length})
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Assign Task Modal */}
      {assignModal.isOpen && (
        <AssignTaskModal
          isOpen={assignModal.isOpen}
          taskTitle={assignModal.taskTitle}
          onClose={() =>
            setAssignModal({ isOpen: false, taskId: "", taskTitle: "" })
          }
          onSubmit={(assignee) =>
            submitAssignTask(assignModal.taskId, assignee)
          }
          organizationId={organizationId}
          projectId={projectId}
        />
      )}

      {/* Edit Task Modal */}
      {editModal.isOpen && (
        <EditTaskModal
          isOpen={editModal.isOpen}
          currentTitle={editModal.currentTitle}
          onClose={() =>
            setEditModal({ isOpen: false, taskId: "", currentTitle: "" })
          }
          onSubmit={(newTitle) => submitEditTask(editModal.taskId, newTitle)}
        />
      )}

      {/* Notification */}
      {notification.isOpen && (
        <Notification
          message={notification.message}
          type={notification.type}
          onClose={() =>
            setNotification({ isOpen: false, message: "", type: "success" })
          }
        />
      )}
    </div>
  );
}

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface AssignTaskModalProps {
  isOpen: boolean;
  taskTitle: string;
  onClose: () => void;
  onSubmit: (assignee: string) => Promise<void>;
  organizationId: string;
  projectId: string;
}

function AssignTaskModal({
  isOpen,
  taskTitle,
  onClose,
  onSubmit,
  organizationId,
  projectId,
}: Readonly<AssignTaskModalProps>) {
  const [assignee, setAssignee] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);

  useEffect(() => {
    const fetchTeamMembers = async () => {
      if (!isOpen || !projectId || !organizationId) return;
      try {
        const membersData = await queryDocuments("team", [
          where("organizationId", "==", organizationId),
          where("projectId", "==", projectId),
        ]);
        setTeamMembers(membersData as TeamMember[]);
      } catch (error) {
        console.error("Error fetching team members:", error);
      }
    };
    fetchTeamMembers();
  }, [isOpen, projectId, organizationId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignee.trim()) return;

    setIsSubmitting(true);
    await onSubmit(assignee);
    setIsSubmitting(false);
    setAssignee("");
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white">
            Assign Task
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Assign "{taskTitle}" to a team member
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          <div className="mb-4">
            <label
              htmlFor="assignee"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              Assign To
            </label>
            <select
              id="assignee"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
            >
              <option value="">Select team member</option>
              {teamMembers.map((member) => (
                <option key={member.id} value={member.name}>
                  {member.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !assignee.trim()}
              className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? "Assigning..." : "Assign"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface EditTaskModalProps {
  isOpen: boolean;
  currentTitle: string;
  onClose: () => void;
  onSubmit: (newTitle: string) => Promise<void>;
}

function EditTaskModal({
  isOpen,
  currentTitle,
  onClose,
  onSubmit,
}: Readonly<EditTaskModalProps>) {
  const [title, setTitle] = useState(currentTitle);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || title.trim() === currentTitle) return;

    setIsSubmitting(true);
    await onSubmit(title);
    setIsSubmitting(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white">
            Edit Task
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Update the task title
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          <div className="mb-4">
            <label
              htmlFor="title"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              Task Title
            </label>
            <input
              type="text"
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
            />
          </div>

          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                isSubmitting || !title.trim() || title.trim() === currentTitle
              }
              className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? "Updating..." : "Update"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface NotificationProps {
  message: string;
  type: "success" | "error";
  onClose: () => void;
}

function Notification({ message, type, onClose }: Readonly<NotificationProps>) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, 4000);

    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="fixed top-4 right-4 z-50">
      <div
        className={`rounded-lg shadow-lg p-4 max-w-sm w-full ${
          type === "success"
            ? "bg-green-50 border border-green-200 dark:bg-green-900 dark:border-green-700"
            : "bg-red-50 border border-red-200 dark:bg-red-900 dark:border-red-700"
        }`}
      >
        <div className="flex items-start">
          <div className="flex-shrink-0">
            {type === "success" ? (
              <svg
                className="h-5 w-5 text-green-400"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
            ) : (
              <svg
                className="h-5 w-5 text-red-400"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
            )}
          </div>
          <div className="ml-3 flex-1">
            <p
              className={`text-sm font-medium ${
                type === "success"
                  ? "text-green-800 dark:text-green-200"
                  : "text-red-800 dark:text-red-200"
              }`}
            >
              {message}
            </p>
          </div>
          <div className="ml-4 flex-shrink-0">
            <button
              onClick={onClose}
              className={`inline-flex rounded-md p-1.5 focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                type === "success"
                  ? "text-green-500 hover:bg-green-100 focus:ring-green-600 dark:text-green-400 dark:hover:bg-green-800"
                  : "text-red-500 hover:bg-red-100 focus:ring-red-600 dark:text-red-400 dark:hover:bg-red-800"
              }`}
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface KPICardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  color: "blue" | "green" | "red" | "purple";
  previousValue?: number;
  currentValue?: number;
  isDecreasePositive?: boolean;
  changeType?: "percentage" | "difference" | "percentage_abs";
  subtext: string;
}

function KPICard({
  title,
  value,
  icon,
  color,
  previousValue = 0,
  currentValue = 0,
  isDecreasePositive = false,
  changeType = "percentage",
  subtext,
}: Readonly<KPICardProps>) {
  const colorStyles = {
    blue: {
      groupHoverText:
        "group-hover:text-blue-600 dark:group-hover:text-blue-400",
      groupHoverBorder: "hover:border-blue-300 dark:hover:border-blue-600",
      bgGradient: "bg-gradient-to-br from-blue-500 to-blue-600",
      shadow: "group-hover:shadow-blue-200 dark:group-hover:shadow-blue-900",
    },
    green: {
      groupHoverText:
        "group-hover:text-green-600 dark:group-hover:text-green-400",
      groupHoverBorder: "hover:border-green-300 dark:hover:border-green-600",
      bgGradient: "bg-gradient-to-br from-green-500 to-green-600",
      shadow: "group-hover:shadow-green-200 dark:group-hover:shadow-green-900",
    },
    red: {
      groupHoverText: "group-hover:text-red-600 dark:group-hover:text-red-400",
      groupHoverBorder: "hover:border-red-300 dark:hover:border-red-600",
      bgGradient: "bg-gradient-to-br from-red-500 to-red-600",
      shadow: "group-hover:shadow-red-200 dark:group-hover:shadow-red-900",
    },
    purple: {
      groupHoverText:
        "group-hover:text-purple-600 dark:group-hover:text-purple-400",
      groupHoverBorder: "hover:border-purple-300 dark:hover:border-purple-600",
      bgGradient: "bg-gradient-to-br from-purple-500 to-purple-600",
      shadow:
        "group-hover:shadow-purple-200 dark:group-hover:shadow-purple-900",
    },
  };

  const style = colorStyles[color];

  const { change, isIncrease, isDecrease } = computeChange(
    changeType,
    previousValue,
    currentValue
  );

  const isPositive = isDecreasePositive ? isDecrease : isIncrease;
  const isNegative = isDecreasePositive ? isIncrease : isDecrease;

  const trendColorClass = getTrendColorClass(
    previousValue,
    isPositive,
    isNegative
  );
  const trendTextClass = getTrendTextClass(
    previousValue,
    isPositive,
    isNegative
  );
  const displayChange = formatDisplayChange(previousValue, changeType, change);
  const trendIconPath = getTrendIconPath(previousValue, isIncrease, isDecrease);

  return (
    <div
      className={`group bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 border border-gray-200 dark:border-gray-700 hover:shadow-lg transition-all duration-300 transform hover:-translate-y-1 ${style.groupHoverBorder}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">
            {title}
          </p>
          <p
            className={`text-3xl font-bold text-gray-900 dark:text-gray-100 transition-colors ${style.groupHoverText}`}
            aria-label={`${value} ${title.toLowerCase()}`}
          >
            {value}
          </p>
        </div>
        <div
          className={`w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0 shadow-lg transition-shadow ${style.bgGradient} ${style.shadow}`}
        >
          {icon}
        </div>
      </div>
      <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
        <div className="flex items-center text-sm">
          <div className="flex items-center">
            <svg
              className={`w-4 h-4 mr-1 ${trendColorClass}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d={trendIconPath}
              />
            </svg>
            <span className={`font-semibold ${trendTextClass}`}>
              {displayChange}
            </span>
          </div>
          <span className="text-gray-500 dark:text-gray-400 ml-2">
            {subtext}
          </span>
        </div>
      </div>
    </div>
  );
}

function computeChange(
  changeType: string,
  previousValue: number,
  currentValue: number
) {
  let change = 0;
  if (changeType === "percentage" || changeType === "percentage_abs") {
    change =
      previousValue > 0
        ? ((currentValue - previousValue) / previousValue) * 100
        : 0;
  } else {
    change = previousValue > 0 ? currentValue - previousValue : 0;
  }
  return {
    change,
    isIncrease: change > 0,
    isDecrease: change < 0,
  };
}

function getTrendColorClass(
  previousValue: number,
  isPositive: boolean,
  isNegative: boolean
) {
  if (previousValue <= 0) return "text-gray-500";
  if (isPositive) return "text-green-500";
  if (isNegative) return "text-red-500";
  return "text-gray-500";
}

function getTrendTextClass(
  previousValue: number,
  isPositive: boolean,
  isNegative: boolean
) {
  if (previousValue <= 0) return "text-gray-600 dark:text-gray-400";
  if (isPositive) return "text-green-600 dark:text-green-400";
  if (isNegative) return "text-red-600 dark:text-red-400";
  return "text-gray-600 dark:text-gray-400";
}

function formatDisplayChange(
  previousValue: number,
  changeType: string,
  change: number
) {
  if (previousValue <= 0) return "N/A";
  if (changeType === "percentage_abs") {
    return change > 0
      ? `+${Math.round(change)}%`
      : `${Math.round(Math.abs(change))}%`;
  }
  const sign = change > 0 ? "+" : "";
  return `${sign}${Math.round(change)}%`;
}

function getTrendIconPath(
  previousValue: number,
  isIncrease: boolean,
  isDecrease: boolean
) {
  if (previousValue <= 0) return "M5 12h14";
  if (isIncrease) return "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6";
  if (isDecrease) return "M13 17h8m0 0V9m0 8l-8-8-4 4-6-6";
  return "M5 12h14";
}
