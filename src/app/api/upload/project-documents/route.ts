import { NextRequest, NextResponse } from "next/server";
import {
  uploadFile,
  BUCKETS,
  generateFileName,
  initializeBuckets,
} from "@/lib/minio/client";
import { addDocument } from "@/lib/firebase/firestoreService";
import { hasOrganizationPermission } from "@/lib/firebase/organizationService";
import { requireBearerToken } from "@/lib/api/authHelper";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "5mb",
    },
  },
};

export async function POST(request: NextRequest) {
  try {
    await initializeBuckets();

    const authResult = await requireBearerToken(request);
    if (authResult instanceof NextResponse) return authResult;
    const { uid: userId } = authResult;

    // Parse the form data
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const projectId = formData.get("projectId") as string;
    const organizationId = formData.get("organizationId") as string;
    const folder = (formData.get("folder") as string) || "General";

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!projectId || !organizationId) {
      return NextResponse.json(
        { error: "Project ID and Organization ID are required" },
        { status: 400 }
      );
    }

    // Check if user has permission to upload files to this organization
    const hasPermission = await hasOrganizationPermission(
      userId,
      organizationId,
      "member"
    );
    if (!hasPermission) {
      return NextResponse.json(
        {
          error:
            "Insufficient permissions to upload files to this organization",
        },
        { status: 403 }
      );
    }

    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 5MB." },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Generate unique filename with project context
    const fileName = `${organizationId}/${projectId}/${generateFileName(file.name, userId)}`;

    // Upload to MinIO
    const fileUrl = await uploadFile(
      BUCKETS.PROJECT_DOCUMENTS,
      fileName,
      buffer,
      file.type
    );

    // Get file extension and type
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    const getFileType = (ext: string): string => {
      switch (ext) {
        case "pdf":
          return "PDF";
        case "doc":
        case "docx":
          return "Word";
        case "xls":
        case "xlsx":
          return "Excel";
        case "ppt":
        case "pptx":
          return "PowerPoint";
        case "txt":
          return "Text";
        case "jpg":
        case "jpeg":
        case "png":
        case "gif":
        case "svg":
          return "Image";
        case "zip":
        case "rar":
        case "7z":
          return "Archive";
        default:
          return "Document";
      }
    };

    // Format file size
    const formatFileSize = (bytes: number): string => {
      if (bytes === 0) return "0 Bytes";
      const k = 1024;
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      const getSizeUnit = (idx: number): string => {
        switch (idx) {
          case 0:
            return "Bytes";
          case 1:
            return "KB";
          case 2:
            return "MB";
          case 3:
            return "GB";
          default:
            return "GB";
        }
      };
      return (
        Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) +
        " " +
        getSizeUnit(i)
      );
    };

    // Save document metadata to Firestore
    const documentData = {
      name: file.name,
      type: getFileType(extension),
      size: formatFileSize(file.size),
      sizeBytes: file.size,
      url: fileUrl,
      fileName: fileName,
      folder: folder,
      projectId: projectId,
      organizationId: organizationId,
      uploadedBy: userId,
      uploadedAt: new Date().toISOString(),
      contentType: file.type,
    };

    const documentId = await addDocument("project-documents", documentData);

    return NextResponse.json({
      success: true,
      documentId,
      url: fileUrl,
      document: { id: documentId, ...documentData },
      message: "Document uploaded successfully",
    });
  } catch (error) {
    console.error("Error uploading project document:", error);
    return NextResponse.json(
      { error: "Failed to upload document" },
      { status: 500 }
    );
  }
}
