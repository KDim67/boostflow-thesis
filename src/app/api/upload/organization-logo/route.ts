import { NextRequest, NextResponse } from "next/server";
import {
  uploadFile,
  BUCKETS,
  generateFileName,
  initializeBuckets,
} from "@/lib/minio/client";
import {
  updateOrganization,
  hasOrganizationPermission,
} from "@/lib/firebase/organizationService";
import { requireBearerToken } from "@/lib/api/authHelper";
import { validateImageFile, fileToBuffer } from "@/lib/api/uploadHelper";

export async function POST(request: NextRequest) {
  try {
    await initializeBuckets();

    const authResult = await requireBearerToken(request);
    if (authResult instanceof NextResponse) return authResult;
    const { uid: userId } = authResult;

    // Parse the form data
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const organizationId = formData.get("organizationId") as string;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!organizationId) {
      return NextResponse.json(
        { error: "Organization ID is required" },
        { status: 400 }
      );
    }

    // Check if user has permission to update the organization
    const hasPermission = await hasOrganizationPermission(
      userId,
      organizationId,
      "admin"
    );
    if (!hasPermission) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    const validationError = validateImageFile(file);
    if (validationError) return validationError;

    const buffer = await fileToBuffer(file);

    // Generate consistent filename for organization logos
    const fileName = generateFileName(
      file.name,
      `org-${organizationId}`,
      "logo"
    );

    // Upload to MinIO
    const fileUrl = await uploadFile(
      BUCKETS.ORGANIZATION_LOGOS,
      fileName,
      buffer,
      file.type
    );

    // Add cache-busting parameter to prevent browser caching issues
    const cacheBustedUrl = `${fileUrl}?t=${Date.now()}`;

    // Update organization with new logo URL
    await updateOrganization(organizationId, {
      logoUrl: cacheBustedUrl,
      updatedAt: new Date(),
    });

    return NextResponse.json({
      success: true,
      url: cacheBustedUrl,
      message: "Organization logo uploaded successfully",
    });
  } catch (error) {
    console.error("Error uploading organization logo:", error);
    return NextResponse.json(
      { error: "Failed to upload organization logo" },
      { status: 500 }
    );
  }
}
