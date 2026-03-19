import { NextRequest, NextResponse } from "next/server";
import { getDocument } from "@/lib/firebase/firestoreService";
import { hasOrganizationPermission } from "@/lib/firebase/organizationService";
import { requireBearerToken } from "@/lib/api/authHelper";
import { streamDocumentToResponse } from "@/lib/api/fileStreamHelper";

async function handleDownload(
  request: NextRequest,
  documentId: string
): Promise<NextResponse> {
  const authResult = await requireBearerToken(request);
  if (authResult instanceof NextResponse) return authResult;
  const { uid: userId } = authResult;

  if (!documentId) {
    return NextResponse.json(
      { error: "Document ID is required" },
      { status: 400 }
    );
  }

  const document = await getDocument("project-documents", documentId);
  if (!document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const hasPermission = await hasOrganizationPermission(
    userId,
    document.organizationId as string,
    "viewer"
  );
  if (!hasPermission) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  return streamDocumentToResponse(document);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const resolvedParams = await params;
  try {
    const [organizationId, projectId, documentId] = resolvedParams.path;
    if (!organizationId || !projectId || !documentId) {
      return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
    }
    return await handleDownload(request, documentId);
  } catch (error) {
    console.error("Error accessing file:", error);
    return NextResponse.json(
      { error: "Failed to access file" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { documentId } = await request.json();
    return await handleDownload(request, documentId);
  } catch (error) {
    console.error("Error generating download URL:", error);
    return NextResponse.json(
      { error: "Failed to generate download URL" },
      { status: 500 }
    );
  }
}
