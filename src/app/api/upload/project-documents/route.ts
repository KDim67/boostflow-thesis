import { NextRequest, NextResponse } from "next/server";
import {
  uploadFile,
  BUCKETS,
  generateFileName,
  initializeBuckets,
} from "@/lib/minio/client";
import { requireBearerToken } from "@/lib/api/authHelper";
import { adminFirestore } from "@/lib/firebase/adminConfig";

// Role hierarchy
const ROLE_LEVELS: Record<string, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  viewer: 1,
};

async function hasPermissionAdmin(
  userId: string,
  organizationId: string,
  requiredRole: string
): Promise<boolean> {
  const snap = await adminFirestore
    .collection("organizationMemberships")
    .where("userId", "==", userId)
    .where("organizationId", "==", organizationId)
    .where("status", "==", "active")
    .limit(1)
    .get();

  if (snap.empty) return false;
  const role = snap.docs[0].data().role as string;
  return (ROLE_LEVELS[role] ?? 0) >= (ROLE_LEVELS[requiredRole] ?? 0);
}

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

    // Check if user has permission to upload files to this organization (Admin SDK)
    const hasPermission = await hasPermissionAdmin(
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

    // Save document metadata to Firestore via Admin SDK
    const docRef = await adminFirestore.collection("project-documents").add({
      ...documentData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const documentId = docRef.id;

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
