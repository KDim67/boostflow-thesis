import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { isRateLimited } from "@/lib/rateLimit";

// Interface defining project performance metrics for AI analysis
interface ProjectMetrics {
  totalTasks: number; // Total number of tasks in the project
  completedTasks: number; // Number of completed tasks
  overdueTasks: number; // Number of tasks past their due date
  teamMembers: number; // Total team members assigned to project
  avgCompletionTime: number; // Average time to complete tasks (in hours)
  productivityScore: number; // Overall productivity score (0-100)
  weeklyProgress: number[]; // Daily task completion count for the week
}

// Interface for individual task data used in analytics
interface TaskAnalytics {
  id: string; // Unique task identifier
  title: string; // Task title/description
  status: string; // Current task status (e.g., 'pending', 'completed')
  priority: string; // Task priority level (e.g., 'high', 'medium', 'low')
  assignee: string; // Team member assigned to the task
  createdAt: string; // Task creation timestamp
  completedAt?: string; // Task completion timestamp (optional)
  dueDate?: string; // Task due date (optional)
  timeSpent?: number; // Time spent on task in hours (optional)
}

// Interface for AI-generated insights about project performance
interface AIInsight {
  type: "suggestion" | "warning" | "optimization"; // Type of insight provided
  title: string; // Brief insight title
  description: string; // Detailed explanation and recommendations
  impact: "high" | "medium" | "low"; // Expected impact level of the insight
  actionable: boolean; // Whether the insight can be acted upon
}

// POST endpoint to generate AI insights for project analytics
export async function POST(request: NextRequest) {
  try {
    // Basic rate limiting by IP (or a generic fallback string if IP is unavailable)
    const ip = request.headers.get("x-forwarded-for") || "unknown-ip";
    const rateLimitResult = isRateLimited(`insights-gen-${ip}`, 5, 60000); // 5 req per minute

    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Please try again later." },
        { status: 429 }
      );
    }

    const { projectName, metrics, tasks, timeframe } = await request.json();

    // Fix for teamMembers count if it's showing 0 despite having assigned team members
    if (
      metrics.teamMembers === 0 &&
      tasks.some(
        (task: TaskAnalytics) => task.assignee && task.assignee !== "Unassigned"
      )
    ) {
      // Count unique assignees from tasks as team members
      const uniqueAssignees = new Set();
      tasks.forEach((task: TaskAnalytics) => {
        if (task.assignee && task.assignee !== "Unassigned") {
          uniqueAssignees.add(task.assignee);
        }
      });
      metrics.teamMembers = uniqueAssignees.size;
    }

    // Validate Gemini API key configuration
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Gemini API key not configured" },
        { status: 500 }
      );
    }

    // Initialize Google Generative AI with the latest model
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    // Prepare project context for AI analysis (limit to 10 recent tasks for efficiency)
    const projectContext = {
      projectName,
      timeframe,
      metrics: metrics as ProjectMetrics,
      recentTasks: (tasks as TaskAnalytics[]).slice(0, 10), // Limit to recent tasks to avoid token limits
      analysisDate: new Date().toISOString(),
    };

    const prompt = `
You are an expert project management analyst. Analyze the following project data and provide actionable insights.

Project: ${projectContext.projectName}
Timeframe: ${projectContext.timeframe}
Analysis Date: ${projectContext.analysisDate}

Project Metrics:
- Total Tasks: ${projectContext.metrics.totalTasks}
- Completed Tasks: ${projectContext.metrics.completedTasks}
- Overdue Tasks: ${projectContext.metrics.overdueTasks}
- Team Members: ${projectContext.metrics.teamMembers}
- Average Completion Time: ${projectContext.metrics.avgCompletionTime} hours
- Productivity Score: ${projectContext.metrics.productivityScore}%
- Weekly Progress: [${projectContext.metrics.weeklyProgress.join(", ")}] tasks completed per day

Recent Tasks Sample:
${projectContext.recentTasks
  .map(
    (task) =>
      `- ${task.title} (${task.status}, ${task.priority} priority, assigned to ${task.assignee})`
  )
  .join("\n")}

Please provide exactly 3-5 insights in the following JSON format. Each insight should be actionable and specific to this project's data:

[
  {
    "type": "suggestion|warning|optimization",
    "title": "Brief insight title",
    "description": "Detailed explanation with specific recommendations",
    "impact": "high|medium|low",
    "actionable": true|false
  }
]

Focus on:
1. Task completion patterns and bottlenecks
2. Team productivity optimization
3. Risk identification (overdue tasks, resource allocation)
4. Performance trends and predictions

Provide only the JSON array, no additional text.`;

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    let insights: AIInsight[];
    try {
      // Extract JSON array from AI response
      const startIndex = text.indexOf("[");
      const endIndex = text.lastIndexOf("]");
      const jsonMatch =
        startIndex !== -1 && endIndex > startIndex
          ? [text.substring(startIndex, endIndex + 1)]
          : null;
      if (!jsonMatch) {
        throw new Error("No JSON array found in response");
      }

      insights = JSON.parse(jsonMatch[0]);

      // Validate that we received a proper array of insights
      if (!Array.isArray(insights) || insights.length === 0) {
        throw new Error("Invalid insights format");
      }

      // Sanitize and provide defaults for any missing fields
      insights = insights.map((insight) => ({
        type: insight.type || "suggestion",
        title: insight.title || "AI Insight",
        description: insight.description || "No description available",
        impact: insight.impact || "medium",
        actionable: insight.actionable !== false,
      }));
    } catch (parseError) {
      // Log parsing errors and fall back to rule-based insights
      console.error("Error parsing AI response:", parseError);
      console.error("Raw AI response:", text);
      return NextResponse.json(
        { error: "Failed to parse AI insights response." },
        { status: 500 }
      );
    }

    return NextResponse.json(insights);
  } catch (error) {
    console.error("Error generating AI insights:", error);
    return NextResponse.json(
      {
        error:
          "Unable to generate AI insights at this time. Please check your API configuration and try again.",
      },
      { status: 500 }
    );
  }
}
