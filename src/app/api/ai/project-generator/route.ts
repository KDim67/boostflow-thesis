import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { isRateLimited } from "@/lib/rateLimit";

interface TeamMemberInfo {
  id: string;
  name: string;
  role: string;
}

// Request payload structure for project generation API
interface ProjectGenerationRequest {
  prompt: string; // User's project description or requirements
  organizationName?: string; // Optional organization context
  industry?: string; // Optional industry context for better suggestions
  teamMembers?: TeamMemberInfo[]; // Optional team members for task auto-assignment
}

interface SuggestedTask {
  title: string;
  description: string;
  priority: "low" | "medium" | "high";
  startDate: string;
  dueDate: string;
  assigneeId?: string;
  assigneeName?: string;
}

interface SuggestedMilestone {
  title: string;
  description: string;
  dueDate: string;
}

interface SuggestedTeamMember {
  userId: string;
  userName: string;
  projectRole: string;
  reason?: string;
}

interface ProjectSuggestion {
  name: string;
  description: string;
  status: string;
  startDate: string;
  dueDate: string;
  client?: string;
  budget?: string;
  suggestedMilestones: SuggestedMilestone[];
  suggestedTasks: SuggestedTask[];
  suggestedTeam: SuggestedTeamMember[];
}

export async function POST(request: NextRequest) {
  try {
    // Basic rate limiting by IP (or a generic fallback string if IP is unavailable)
    const ip = request.headers.get("x-forwarded-for") || "unknown-ip";
    const rateLimitResult = isRateLimited(`project-gen-${ip}`, 5, 60000); // 5 req per minute

    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Please try again later." },
        { status: 429 }
      );
    }

    const body = (await request.json()) as ProjectGenerationRequest;
    const { prompt, organizationName, industry, teamMembers } = body;

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json(
        { error: "Prompt is required" },
        { status: 400 }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Gemini API key not configured" },
        { status: 500 }
      );
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

    const contextInfo = organizationName
      ? `Organization: ${organizationName}`
      : "";
    const industryInfo = industry ? `Industry: ${industry}` : "";

    let teamInfoXml = "";
    if (teamMembers && teamMembers.length > 0) {
      const membersStr = teamMembers
        .map((m) => `- ${m.name} (ID: ${m.id}, Role: ${m.role})`)
        .join("\n");
      teamInfoXml = `\n<team_members>\n${membersStr}\n</team_members>\n`;
    }

    const today = new Date().toISOString().split("T")[0];

    const generationPrompt = `
You are an expert project manager and business analyst. Your task is to generate a comprehensive project structure based on the provided user requirements and context.

<context>
Today's Date: ${today}
${contextInfo}
${industryInfo}
</context>${teamInfoXml}

<user_requirements>
${prompt}
</user_requirements>

<instructions>
1. Analyze the <user_requirements> and <context>.
2. Generate a clear, professional project name.
3. Write a detailed description explaining objectives and scope.
4. Set realistic start and due dates (YYYY-MM-DD format) for the OVERALL project using Today's Date as a baseline.
5. Suggest an appropriate client name (leave empty if not applicable) and a realistic budget.
6. Generate 3 to 5 realistic Milestones to break the project into major phases. Each milestone needs a title, description, and dueDate.
7. Generate 3 to 5 specific, actionable tasks. Each task MUST have its own specific startDate and dueDate that fit within the overall project timeline and align with the milestones.
8. If <team_members> are provided:
   - Select the most appropriate members to form the project team and assign them a specific projectRole (e.g., 'Frontend Lead', 'QA'). Return this in the suggestedTeam array.
   - For the generated tasks, intelligently assign each task to the most appropriate team member from your selected team. Include both their ID and Name.
9. Output strictly adhering to the requested JSON schema.
</instructions>
`;

    // Define structured schema for reliable JSON generation
    const responseSchema = {
      type: SchemaType.OBJECT,
      properties: {
        name: {
          type: SchemaType.STRING,
          description: "Clear, professional project name (max 60 characters)",
        },
        description: {
          type: SchemaType.STRING,
          description:
            "Detailed project description explaining objectives and scope",
        },
        status: {
          type: SchemaType.STRING,
          description: "Project phase: planning, active, or on-hold",
        },
        startDate: {
          type: SchemaType.STRING,
          description: "Realistic start date in YYYY-MM-DD format",
        },
        dueDate: {
          type: SchemaType.STRING,
          description: "Realistic due date in YYYY-MM-DD format",
        },
        client: {
          type: SchemaType.STRING,
          description: "Suggested client name if applicable, or empty string",
        },
        budget: {
          type: SchemaType.STRING,
          description: "Suggested budget (e.g., '$10,000' or 'TBD')",
        },
        suggestedMilestones: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              title: {
                type: SchemaType.STRING,
                description: "Milestone title",
              },
              description: {
                type: SchemaType.STRING,
                description: "Milestone description",
              },
              dueDate: {
                type: SchemaType.STRING,
                description: "Milestone due date (YYYY-MM-DD)",
              },
            },
            required: ["title", "description", "dueDate"],
          },
        },
        suggestedTasks: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              title: { type: SchemaType.STRING, description: "Task title" },
              description: {
                type: SchemaType.STRING,
                description: "Task description",
              },
              priority: {
                type: SchemaType.STRING,
                description: "low, medium, or high",
              },
              startDate: {
                type: SchemaType.STRING,
                description: "Task specific start date (YYYY-MM-DD)",
              },
              dueDate: {
                type: SchemaType.STRING,
                description: "Task specific due date (YYYY-MM-DD)",
              },
              assigneeId: {
                type: SchemaType.STRING,
                description: "ID of the assigned team member, if applicable",
              },
              assigneeName: {
                type: SchemaType.STRING,
                description: "Name of the assigned team member, if applicable",
              },
            },
            required: [
              "title",
              "description",
              "priority",
              "startDate",
              "dueDate",
            ],
          },
        },
        suggestedTeam: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              userId: {
                type: SchemaType.STRING,
                description: "ID of the selected organization member",
              },
              userName: {
                type: SchemaType.STRING,
                description: "Name of the selected organization member",
              },
              projectRole: {
                type: SchemaType.STRING,
                description:
                  "Suggested role in the project (e.g., Frontend Lead, QA, Backend Developer)",
              },
              reason: {
                type: SchemaType.STRING,
                description: "Brief reason why they were selected",
              },
            },
            required: ["userId", "userName", "projectRole"],
          },
        },
      },
      required: [
        "name",
        "description",
        "status",
        "startDate",
        "dueDate",
        "suggestedMilestones",
        "suggestedTasks",
        "suggestedTeam",
      ],
    };

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: generationPrompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: responseSchema as any,
      },
    });

    const responseText = result.response.text();
    let projectSuggestion: ProjectSuggestion;

    try {
      projectSuggestion = JSON.parse(responseText);
    } catch (parseError) {
      console.error("Error parsing AI response JSON:", parseError);
      return NextResponse.json(
        { error: "Failed to parse AI response. Please try again." },
        { status: 500 }
      );
    }

    return NextResponse.json(projectSuggestion);
  } catch (error) {
    console.error("Error generating project suggestion:", error);
    return NextResponse.json(
      {
        error:
          "AI project generation failed. Please try again or create the project manually.",
      },
      { status: 500 }
    );
  }
}
