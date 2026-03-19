import { NextRequest, NextResponse } from "next/server";
import {
  uploadFile,
  BUCKETS,
  generateFileName,
  initializeBuckets,
} from "@/lib/minio/client";
import { updateUserProfile } from "@/lib/firebase/userProfileService";
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

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const validationError = validateImageFile(file);
    if (validationError) return validationError;

    const buffer = await fileToBuffer(file);

    // Generate consistent filename for profile pictures
    const fileName = generateFileName(file.name, userId, "profile");

    // Upload to MinIO
    const fileUrl = await uploadFile(
      BUCKETS.PROFILE_PICTURES,
      fileName,
      buffer,
      file.type
    );

    // Add cache-busting parameter to prevent browser caching issues
    const cacheBustedUrl = `${fileUrl}?t=${Date.now()}`;

    // Update user profile with new picture URL
    await updateUserProfile(userId, {
      profilePicture: cacheBustedUrl,
      updatedAt: new Date(),
    });

    return NextResponse.json({
      success: true,
      url: cacheBustedUrl,
      message: "Profile picture uploaded successfully",
    });
  } catch (error) {
    console.error("Error uploading profile picture:", error);
    return NextResponse.json(
      { error: "Failed to upload profile picture" },
      { status: 500 }
    );
  }
}
