import { NextRequest, NextResponse } from "next/server";
import { inviteTeamMember } from "@/lib/firebase/organizationService";
import { OrganizationRole } from "@/lib/types/organization";
import { requireBearerToken } from "@/lib/api/authHelper";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: organizationId } = await params;
    const body = await request.json();
    const { email, role = "member" } = body;

    const authResult = await requireBearerToken(request);
    if (authResult instanceof NextResponse) return authResult;
    const inviterUserId = authResult.uid;

    // Validate input
    if (!email || !organizationId) {
      return NextResponse.json(
        { success: false, error: "Email and organization ID are required" },
        { status: 400 }
      );
    }

    if (!["admin", "member", "viewer"].includes(role)) {
      return NextResponse.json(
        { success: false, error: "Invalid role specified" },
        { status: 400 }
      );
    }

    // Invite the team member
    const membershipId = await inviteTeamMember(
      organizationId,
      inviterUserId,
      email,
      role as OrganizationRole
    );

    return NextResponse.json({
      success: true,
      membershipId,
      message: "Invitation sent successfully",
    });
  } catch (error) {
    console.error("Error inviting team member:", error);

    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";

    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}
