import { NextRequest, NextResponse } from "next/server";
import { deleteFileByUrl, BUCKETS } from "@/lib/minio/client";
import {
  deleteOrganization,
  getOrganization,
} from "@/lib/firebase/organizationService";
import { requireBearerToken } from "@/lib/api/authHelper";

export async function DELETE(request: NextRequest) {
  try {
    const authResult = await requireBearerToken(request);
    if (authResult instanceof NextResponse) return authResult;

    // Get organization ID from request body
    const { organizationId } = await request.json();

    if (!organizationId) {
      return NextResponse.json(
        { error: "Organization ID is required" },
        { status: 400 }
      );
    }

    // Get organization data to check for logo before deletion
    const organization = await getOrganization(organizationId);

    if (!organization) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 }
      );
    }

    // Delete organization from database
    await deleteOrganization(organizationId);

    // Delete organization logo from MinIO if it exists
    if (organization.logoUrl) {
      try {
        await deleteFileByUrl(organization.logoUrl, BUCKETS.ORGANIZATION_LOGOS);
      } catch (minioError) {
        console.error(
          "Error deleting organization logo from MinIO:",
          minioError
        );
        // Don't throw here as the organization is already deleted from database
      }
    }

    return NextResponse.json({
      success: true,
      message: "Organization deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting organization:", error);
    return NextResponse.json(
      { error: "Failed to delete organization" },
      { status: 500 }
    );
  }
}
