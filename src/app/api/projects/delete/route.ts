import { NextRequest, NextResponse } from "next/server";
import { deleteFileByUrl, BUCKETS } from "@/lib/minio/client";
import {
  getDocument,
  deleteDocument,
  queryDocuments,
} from "@/lib/firebase/firestoreService";
import { hasOrganizationPermission } from "@/lib/firebase/organizationService";
import { where } from "firebase/firestore";
import { requireBearerToken } from "@/lib/api/authHelper";

export async function DELETE(request: NextRequest) {
  try {
    const authResult = await requireBearerToken(request);
    if (authResult instanceof NextResponse) return authResult;
    const { uid: userId } = authResult;

    // Get project ID from request body
    const { projectId } = await request.json();

    if (!projectId) {
      return NextResponse.json(
        { error: "Project ID is required" },
        { status: 400 }
      );
    }

    // Get the project from Firestore to check permissions
    const project = await getDocument("projects", projectId);

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Check if user has permission to delete projects in this organization
    const hasPermission = await hasOrganizationPermission(
      userId,
      project.organizationId,
      "admin"
    );

    if (!hasPermission) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    // Get all project documents before deleting the project
    const projectDocuments = await queryDocuments("project-documents", [
      where("projectId", "==", projectId),
    ]);

    // Delete project from Firestore
    await deleteDocument("projects", projectId);

    // Delete all project documents from Firestore and MinIO
    for (const document of projectDocuments) {
      try {
        // Delete document from Firestore
        await deleteDocument("project-documents", document.id);

        // Delete file from MinIO if URL exists
        if (document.url) {
          await deleteFileByUrl(document.url, BUCKETS.PROJECT_DOCUMENTS);
        }
      } catch (docError) {
        console.error({
          msg: "Error deleting document",
          documentId: document.id,
          error: docError,
        });
        // Continue with other documents even if one fails
      }
    }

    // Delete other related data (tasks, milestones, team members)
    try {
      // Delete tasks
      const tasks = await queryDocuments("tasks", [
        where("projectId", "==", projectId),
      ]);
      for (const task of tasks) {
        await deleteDocument("tasks", task.id);
      }

      // Delete milestones
      const milestones = await queryDocuments("milestones", [
        where("projectId", "==", projectId),
      ]);
      for (const milestone of milestones) {
        await deleteDocument("milestones", milestone.id);
      }

      // Delete team members
      const teamMembers = await queryDocuments("team", [
        where("projectId", "==", projectId),
      ]);
      for (const member of teamMembers) {
        await deleteDocument("team", member.id);
      }
    } catch (relatedDataError) {
      console.error("Error deleting related project data:", relatedDataError);
      // Don't throw here as the main project is already deleted
    }

    return NextResponse.json({
      success: true,
      message: "Project and all associated data deleted successfully",
      deletedDocuments: projectDocuments.length,
    });
  } catch (error) {
    console.error("Error deleting project:", error);
    return NextResponse.json(
      { error: "Failed to delete project" },
      { status: 500 }
    );
  }
}
