import { NextRequest, NextResponse } from "next/server";
import {
  uploadFile,
  BUCKETS,
  generateFileName,
  initializeBuckets,
} from "@/lib/minio/client";
import { requireBearerToken } from "@/lib/api/authHelper";
import { validateImageFile, fileToBuffer } from "@/lib/api/uploadHelper";
import { adminFirestore } from "@/lib/firebase/adminConfig";

// Role hierarchy for permission checks
const ROLE_LEVELS: Record<string, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  viewer: 1,
};

/**
 * Checks organization permission using the Admin SDK (server-side Firestore).
 * Includes a retry-with-backoff to handle the race condition where a newly
 * created organization's membership document hasn't yet propagated from the
 * client-side long-polling write to the server-readable state.
 */
async function checkPermissionWithRetry(
  userId: string,
  organizationId: string,
  requiredRole: string,
  maxRetries = 4,
  initialDelayMs = 300
): Promise<boolean> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const snap = await adminFirestore
      .collection("organizationMemberships")
      .where("userId", "==", userId)
      .where("organizationId", "==", organizationId)
      .where("status", "==", "active")
      .limit(1)
      .get();

    if (!snap.empty) {
      const role = snap.docs[0].data().role as string;
      return (ROLE_LEVELS[role] ?? 0) >= (ROLE_LEVELS[requiredRole] ?? 0);
    }

    // Membership not found yet — if we have retries left, wait and try again
    if (attempt < maxRetries) {
      const delay = initialDelayMs * Math.pow(2, attempt); // 300, 600, 1200, 2400 ms
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return false;
}

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

    // Check permission via Admin SDK with retry backoff for new org race condition
    const hasPermission = await checkPermissionWithRetry(
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

    // Update organization with new logo URL via Admin SDK
    await adminFirestore
      .collection("organizations")
      .doc(organizationId)
      .update({
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
