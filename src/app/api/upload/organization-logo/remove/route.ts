import { NextRequest, NextResponse } from "next/server";
import { deleteFileByUrl, BUCKETS } from "@/lib/minio/client";
import {
  updateOrganization,
  hasOrganizationPermission,
  getOrganization,
} from "@/lib/firebase/organizationService";
import { requireBearerToken } from "@/lib/api/authHelper";

export async function DELETE(request: NextRequest) {
  try {
    const authResult = await requireBearerToken(request);
    if (authResult instanceof NextResponse) return authResult;
    const { uid: userId } = authResult;

    // Get organization ID from request body
    const { organizationId } = await request.json();

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

    // Get current organization to check for existing logo
    const currentOrg = await getOrganization(organizationId);
    const oldLogoUrl = currentOrg?.logoUrl;

    // Update organization to remove logo URL
    await updateOrganization(organizationId, {
      logoUrl: "",
      updatedAt: new Date(),
    });

    // Delete old logo file if it exists
    if (oldLogoUrl) {
      await deleteFileByUrl(oldLogoUrl, BUCKETS.ORGANIZATION_LOGOS);
    }

    return NextResponse.json({
      success: true,
      message: "Organization logo removed successfully",
      logoUrl: "", // Return empty logoUrl for frontend updates
    });
  } catch (error) {
    console.error("Error removing organization logo:", error);
    return NextResponse.json(
      { error: "Failed to remove organization logo" },
      { status: 500 }
    );
  }
}
