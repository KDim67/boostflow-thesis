import { NextRequest, NextResponse } from "next/server";
import { deleteFileByUrl, BUCKETS } from "@/lib/minio/client";
import { getDocument, deleteDocument } from "@/lib/firebase/firestoreService";
import { hasOrganizationPermission } from "@/lib/firebase/organizationService";
import { requireBearerToken } from "@/lib/api/authHelper";

export async function DELETE(request: NextRequest) {
  try {
    const authResult = await requireBearerToken(request);
    if (authResult instanceof NextResponse) return authResult;
    const { uid: userId } = authResult;

    // Get document ID from request body
    const { documentId } = await request.json();

    if (!documentId) {
      return NextResponse.json(
        { error: "Document ID is required" },
        { status: 400 }
      );
    }

    // Get the document from Firestore to check permissions and get file info
    const document = await getDocument("project-documents", documentId);

    if (!document) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 }
      );
    }

    // Check if user has permission to delete files in this organization
    const hasPermission = await hasOrganizationPermission(
      userId,
      document.organizationId,
      "member"
    );

    if (!hasPermission) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    // Delete document from Firestore
    await deleteDocument("project-documents", documentId);

    // Delete file from MinIO if URL exists
    if (document.url) {
      try {
        await deleteFileByUrl(document.url, BUCKETS.PROJECT_DOCUMENTS);
      } catch (minioError) {
        console.error("Error deleting file from MinIO:", minioError);
        // Don't throw here as the document is already deleted from database
        // Log the error but continue with successful response
      }
    }

    return NextResponse.json({
      success: true,
      message: "Document deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting document:", error);
    return NextResponse.json(
      { error: "Failed to delete document" },
      { status: 500 }
    );
  }
}
