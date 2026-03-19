import { NextRequest, NextResponse } from "next/server";
import { getDocument } from "@/lib/firebase/firestoreService";
import { hasOrganizationPermission } from "@/lib/firebase/organizationService";
import { requireBearerToken } from "@/lib/api/authHelper";
import { streamDocumentToResponse } from "@/lib/api/fileStreamHelper";

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireBearerToken(request);
    if (authResult instanceof NextResponse) return authResult;
    const { uid: userId } = authResult;

    const { documentId } = await request.json();

    if (!documentId) {
      return NextResponse.json(
        { error: "Document ID is required" },
        { status: 400 }
      );
    }

    const document = await getDocument("project-documents", documentId);

    if (!document) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 }
      );
    }

    const hasPermission = await hasOrganizationPermission(
      userId,
      document.organizationId,
      "member"
    );

    if (!hasPermission) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return await streamDocumentToResponse(document);
  } catch (error) {
    console.error("Error downloading document:", error);
    return NextResponse.json(
      { error: "Failed to download file" },
      { status: 500 }
    );
  }
}
