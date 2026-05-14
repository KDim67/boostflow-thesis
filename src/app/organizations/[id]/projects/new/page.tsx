"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/firebase/useAuth";
import {
  getOrganization,
  getOrganizationMembers,
  hasOrganizationPermission,
} from "@/lib/firebase/organizationService";
import { createDocument } from "@/lib/firebase/firestoreService";
import { Organization } from "@/lib/types/organization";
import { serverTimestamp } from "firebase/firestore";

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

const getTaskPriorityClass = (priority: SuggestedTask["priority"]) => {
  if (priority === "high") return "bg-red-100 text-red-800";
  if (priority === "medium") return "bg-yellow-100 text-yellow-800";
  return "bg-green-100 text-green-800";
};

export default function NewProjectPage() {
  const { id } = useParams();
  const organizationId = Array.isArray(id) ? id[0] : id;

  const [organization, setOrganization] = useState<Organization | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AI-related state
  const [aiPrompt, setAiPrompt] = useState("");
  const [industry, setIndustry] = useState("");
  const [autoAssign, setAutoAssign] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showAiSection, setShowAiSection] = useState(false);
  const [suggestedTasks, setSuggestedTasks] = useState<SuggestedTask[]>([]);
  const [suggestedMilestones, setSuggestedMilestones] = useState<
    SuggestedMilestone[]
  >([]);
  const [suggestedTeam, setSuggestedTeam] = useState<SuggestedTeamMember[]>([]);

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    status: "planning",
    startDate: "",
    dueDate: "",
    client: "",
    budget: "",
  });

  const { user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    const fetchOrganizationData = async () => {
      if (!user || !organizationId) return;
      try {
        setIsLoading(true);
        setError(null);
        const permission = await hasOrganizationPermission(
          user.uid,
          organizationId,
          "member"
        );
        if (!permission) {
          setError(
            "You do not have permission to create projects in this organization."
          );
          setIsLoading(false);
          return;
        }
        const orgData = await getOrganization(organizationId);
        setOrganization(orgData);
      } catch (error) {
        console.error("Error fetching organization data:", error);
        setError("Failed to load organization data. Please try again.");
      } finally {
        setIsLoading(false);
      }
    };
    fetchOrganizationData();
  }, [user, organizationId]);

  const handleInputChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const generateProjectWithAI = async () => {
    if (!aiPrompt.trim()) return;

    try {
      setIsGenerating(true);
      setError(null);

      let teamMembersPayload: any[] = [];
      if (autoAssign && organizationId) {
        try {
          const members = await getOrganizationMembers(organizationId);
          teamMembersPayload = members.map((m) => ({
            id: m.userId,
            name:
              m.userProfile?.displayName || m.userProfile?.email || "Unknown",
            role: m.role,
          }));
        } catch (err) {
          console.warn("Could not fetch team members for AI assignment", err);
        }
      }

      const response = await fetch("/api/ai/project-generator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: aiPrompt,
          organizationName: organization?.name,
          industry: industry.trim() || undefined,
          teamMembers:
            teamMembersPayload.length > 0 ? teamMembersPayload : undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to generate project");
      }

      setFormData((prev) => ({
        ...prev,
        name: data.name || "",
        description: data.description || "",
        status: data.status || "planning",
        startDate: data.startDate || "",
        dueDate: data.dueDate || "",
        client: data.client || "",
        budget: data.budget || "",
      }));

      if (data.suggestedTasks && Array.isArray(data.suggestedTasks)) {
        setSuggestedTasks(data.suggestedTasks);
      }
      if (data.suggestedMilestones && Array.isArray(data.suggestedMilestones)) {
        setSuggestedMilestones(data.suggestedMilestones);
      }
      if (data.suggestedTeam && Array.isArray(data.suggestedTeam)) {
        setSuggestedTeam(data.suggestedTeam);
      }

      setShowAiSection(false);
    } catch (error: any) {
      console.error("Error generating project:", error);
      setError(
        error.message || "Failed to generate project with AI. Please try again."
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const addOwnerToProject = async (
    projectId: string,
    owner: Awaited<ReturnType<typeof getOrganizationMembers>>[number],
    createdBy: string
  ) => {
    await createDocument("team", {
      name:
        owner.userProfile?.displayName ||
        owner.userProfile?.email ||
        "Organization Owner",
      email: owner.userProfile?.email || "",
      photoURL: owner.userProfile?.photoURL,
      role: "Project Manager",
      organizationId,
      projectId,
      userId: owner.userId,
      createdBy,
      createdAt: serverTimestamp(),
    });
  };

  const addCreatorToProject = async (projectId: string) => {
    if (!user) return;

    await createDocument("team", {
      name: user.displayName || user.email || "Project Creator",
      email: user.email || "",
      photoURL: user.photoURL,
      role: "Project Lead",
      organizationId,
      projectId,
      userId: user.uid,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
    });
  };

  const createSuggestedTasks = async (projectId: string) => {
    if (!user) return;

    for (const task of suggestedTasks) {
      await createDocument("tasks", {
        title: task.title,
        description: task.description,
        priority: task.priority || "medium",
        status: "pending",
        organizationId,
        projectId,
        assignee: task.assigneeName || "Unassigned",
        assignedTo: task.assigneeId || undefined,
        startDate: task.startDate || formData.startDate || "",
        dueDate: task.dueDate || formData.dueDate || "",
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        timeSpent: 0,
      });
    }
  };

  const createSuggestedMilestones = async (projectId: string) => {
    if (!user) return;

    for (const milestone of suggestedMilestones) {
      await createDocument("milestones", {
        title: milestone.title,
        description: milestone.description,
        dueDate: milestone.dueDate || formData.dueDate || "",
        status: "Pending",
        projectId,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  };

  const addSuggestedTeamMembers = async (
    projectId: string,
    ownerId?: string
  ) => {
    if (!user) return;

    for (const teamMember of suggestedTeam) {
      if (teamMember.userId === user.uid || teamMember.userId === ownerId) {
        continue;
      }

      await createDocument("team", {
        name: teamMember.userName,
        role: teamMember.projectRole,
        organizationId,
        projectId,
        userId: teamMember.userId,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });
    }
  };

  const createProjectScaffold = async (projectId: string) => {
    if (!organizationId || !user) return;

    try {
      const orgMembers = await getOrganizationMembers(organizationId);
      const owner = orgMembers.find((member) => member.role === "owner");

      if (owner && owner.userId !== user.uid) {
        await addOwnerToProject(projectId, owner, user.uid);
      }

      await addCreatorToProject(projectId);
      await createSuggestedTasks(projectId);
      await createSuggestedMilestones(projectId);
      await addSuggestedTeamMembers(projectId, owner?.userId);
    } catch (teamError) {
      console.error("Error adding automatic team members or tasks:", teamError);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !organization) return;

    try {
      setIsSubmitting(true);
      setError(null);

      const projectData = {
        ...formData,
        organizationId,
        createdBy: user.uid,
        createdAt: new Date(),
        updatedAt: new Date(),
        progress: 0,
      };

      const projectId = await createDocument("projects", projectData);

      await createProjectScaffold(projectId);

      router.push(`/organizations/${organizationId}/projects/${projectId}`);
    } catch (error) {
      console.error("Error creating project:", error);
      setError("Failed to create project. Please try again.");
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (error && !organization) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-8 max-w-2xl mx-auto">
        <h2 className="text-xl font-semibold mb-4 text-red-600 dark:text-red-400">
          Organization not found
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mb-6">{error}</p>
        <Link
          href={`/organizations/${organizationId}`}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          Back to Organization
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {error && (
        <div className="bg-red-50 border-l-4 border-red-400 p-4 mb-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg
                className="h-5 w-5 text-red-400"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          </div>
        </div>
      )}

      <div className="bg-gradient-to-br from-blue-50 to-purple-50 dark:from-gray-800 dark:to-gray-700 rounded-xl p-6 shadow-md">
        <h1 className="text-2xl font-bold mb-2 text-gray-900 dark:text-white">
          Create New Project
        </h1>
        <p className="text-gray-600 dark:text-gray-300">
          Add a new project to {organization?.name}
        </p>
      </div>

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
                <h2 className="text-xl font-bold text-white mb-1">
                  AI Project Generator
                </h2>
                <p className="text-purple-100 text-sm">
                  Let AI help you create the perfect project structure and tasks
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowAiSection(!showAiSection)}
              className={`bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg transition-all duration-200 flex items-center space-x-2 shadow-md hover:shadow-lg ${showAiSection ? "ring-2 ring-white/30" : ""}`}
            >
              <span className="font-medium">
                {showAiSection ? "Hide Generator" : "Use AI Generator"}
              </span>
            </button>
          </div>
        </div>

        {showAiSection && (
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label
                  htmlFor="aiPrompt"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                >
                  Describe your project idea
                </label>
                <textarea
                  id="aiPrompt"
                  value={aiPrompt}
                  onChange={(e) => {
                    if (e.target.value.length <= 500)
                      setAiPrompt(e.target.value);
                  }}
                  rows={4}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 dark:bg-gray-700 dark:text-white resize-none"
                  placeholder="e.g., 'A mobile app for tracking fitness goals'"
                />
                <div className="mt-1 text-right">
                  <span className="text-xs text-gray-500">
                    {aiPrompt.length}/500
                  </span>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="industry"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                  >
                    Project Type / Industry (Optional)
                  </label>
                  <input
                    type="text"
                    id="industry"
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 dark:bg-gray-700 dark:text-white"
                    placeholder="e.g., E-commerce, Healthcare, Marketing"
                  />
                </div>

                <div className="flex items-center p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                  <input
                    id="autoAssign"
                    type="checkbox"
                    checked={autoAssign}
                    onChange={(e) => setAutoAssign(e.target.checked)}
                    className="h-4 w-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                  />
                  <label
                    htmlFor="autoAssign"
                    className="ml-2 block text-sm text-blue-900 dark:text-blue-100"
                  >
                    Auto-assign tasks to available team members
                  </label>
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={generateProjectWithAI}
                disabled={isGenerating || !aiPrompt.trim()}
                className="bg-gradient-to-r from-purple-600 to-blue-600 text-white px-6 py-3 rounded-lg flex items-center space-x-2 shadow-md hover:shadow-lg disabled:opacity-50"
              >
                {isGenerating ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-white"></div>
                    <span>Generating...</span>
                  </>
                ) : (
                  <span>Generate Project Structure</span>
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {suggestedTasks.length > 0 && (
        <div className="bg-purple-50 dark:bg-purple-900/10 border border-purple-200 dark:border-purple-800 rounded-xl p-6 shadow-sm space-y-6">
          <h3 className="text-lg font-semibold text-purple-900 dark:text-purple-100 flex items-center">
            <svg
              className="w-5 h-5 mr-2"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
              <path
                fillRule="evenodd"
                d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z"
                clipRule="evenodd"
              />
            </svg>
            AI Scaffolding Preview
          </h3>
          <p className="text-sm text-purple-700 dark:text-purple-300">
            These assets will be automatically created when you submit the
            project form.
          </p>

          {/* Milestones Preview */}
          {suggestedMilestones.length > 0 && (
            <div>
              <h4 className="font-semibold text-purple-800 dark:text-purple-200 mb-3 border-b border-purple-200 dark:border-purple-800 pb-2">
                Milestones
              </h4>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {suggestedMilestones.map((milestone) => (
                  <div
                    key={`${milestone.title}-${milestone.dueDate}`}
                    className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-purple-100 dark:border-gray-700 shadow-sm relative overflow-hidden"
                  >
                    <div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
                    <h5 className="font-medium text-gray-900 dark:text-white text-sm mb-1">
                      {milestone.title}
                    </h5>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 line-clamp-2">
                      {milestone.description}
                    </p>
                    <span className="text-xs text-purple-600 dark:text-purple-400 font-medium bg-purple-100 dark:bg-purple-900/30 px-2 py-1 rounded">
                      Target: {milestone.dueDate}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tasks Preview */}
          <div>
            <h4 className="font-semibold text-purple-800 dark:text-purple-200 mb-3 border-b border-purple-200 dark:border-purple-800 pb-2">
              Tasks
            </h4>
            <div className="grid gap-3 md:grid-cols-2">
              {suggestedTasks.map((task) => (
                <div
                  key={`${task.title}-${task.startDate}-${task.dueDate}`}
                  className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm"
                >
                  <div className="flex justify-between items-start mb-2">
                    <h4 className="font-medium text-gray-900 dark:text-white text-sm">
                      {task.title}
                    </h4>
                    <span
                      className={`text-xs px-2 py-1 rounded-full ${getTaskPriorityClass(task.priority)}`}
                    >
                      {task.priority}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 line-clamp-2">
                    {task.description}
                  </p>
                  <div className="flex justify-between items-center text-xs text-gray-500">
                    <span className="bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">
                      {task.startDate} → {task.dueDate}
                    </span>
                    {task.assigneeName && (
                      <span className="flex items-center text-blue-600 dark:text-blue-400">
                        <svg
                          className="w-3 h-3 mr-1"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"
                            clipRule="evenodd"
                          />
                        </svg>
                        {task.assigneeName}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Team Preview */}
          {suggestedTeam.length > 0 && (
            <div>
              <h4 className="font-semibold text-purple-800 dark:text-purple-200 mb-3 border-b border-purple-200 dark:border-purple-800 pb-2">
                Project Team Formation
              </h4>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {suggestedTeam.map((team) => (
                  <div
                    key={`${team.userId}-${team.projectRole}`}
                    className="bg-white dark:bg-gray-800 p-3 flex items-center rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm"
                  >
                    <div className="bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 w-10 h-10 rounded-full flex items-center justify-center font-bold mr-3">
                      {team.userName.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h5 className="font-medium text-gray-900 dark:text-white text-sm">
                        {team.userName}
                      </h5>
                      <p className="text-xs text-purple-600 dark:text-purple-400">
                        {team.projectRole}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              Project Name *
            </label>
            <input
              type="text"
              id="name"
              name="name"
              required
              value={formData.name}
              onChange={handleInputChange}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700 dark:text-white"
            />
          </div>

          <div>
            <label
              htmlFor="description"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              Description
            </label>
            <textarea
              id="description"
              name="description"
              rows={4}
              value={formData.description}
              onChange={handleInputChange}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700 dark:text-white"
            />
          </div>

          <div>
            <label
              htmlFor="status"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              Status
            </label>
            <select
              id="status"
              name="status"
              value={formData.status}
              onChange={handleInputChange}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700 dark:text-white"
            >
              <option value="planning">Planning</option>
              <option value="active">Active</option>
              <option value="on-hold">On Hold</option>
              <option value="completed">Completed</option>
            </select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label
                htmlFor="startDate"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
              >
                Start Date
              </label>
              <input
                type="date"
                id="startDate"
                name="startDate"
                value={formData.startDate}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700 dark:text-white"
              />
            </div>
            <div>
              <label
                htmlFor="dueDate"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
              >
                Due Date
              </label>
              <input
                type="date"
                id="dueDate"
                name="dueDate"
                value={formData.dueDate}
                min={formData.startDate || undefined}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700 dark:text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label
                htmlFor="client"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
              >
                Client
              </label>
              <input
                type="text"
                id="client"
                name="client"
                value={formData.client}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700 dark:text-white"
              />
            </div>
            <div>
              <label
                htmlFor="budget"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
              >
                Budget
              </label>
              <input
                type="text"
                id="budget"
                name="budget"
                value={formData.budget}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700 dark:text-white"
              />
            </div>
          </div>

          <div className="flex justify-end space-x-4 pt-4">
            <Link
              href={`/organizations/${organizationId}/projects`}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {isSubmitting ? "Creating..." : "Create Project"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
