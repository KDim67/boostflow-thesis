import { NextRequest, NextResponse } from "next/server";
import { getDocument, updateDocument } from "@/lib/firebase/firestoreService";
import { OrganizationMembership } from "@/lib/types/organization";
import { NotificationService } from "@/lib/firebase/notificationService";
import { getOrganizationMembers } from "@/lib/firebase/organizationService";
import { serverTimestamp } from "firebase/firestore";

/**
 * Response structure for invitation processing operations
 */
interface InvitationResponse {
  success: boolean;
  message: string;
  redirectUrl?: string; // Where to redirect user after processing
  organizationId?: string;
  organizationName?: string;
}

/**
 * Helper function to process invitation acceptance or decline
 */
async function handleInvitationAction(
  token: string,
  action: string,
  userId: string | null
): Promise<NextResponse> {
  if (!["accept", "decline"].includes(action)) {
    return NextResponse.json(
      {
        success: false,
        message: 'Invalid action. Must be "accept" or "decline"',
      },
      { status: 400 }
    );
  }

  if (!userId) {
    return NextResponse.json(
      { success: false, message: "User ID is required" },
      { status: 400 }
    );
  }

  // Retrieve membership record using token as document ID
  const membership = (await getDocument(
    "organizationMemberships",
    token
  )) as OrganizationMembership;

  if (!membership) {
    return NextResponse.json(
      { success: false, message: "Invitation not found or expired" },
      { status: 404 }
    );
  }

  // Verify invitation belongs to the requesting user
  if (membership.userId !== userId) {
    return NextResponse.json(
      { success: false, message: "This invitation is not for you" },
      { status: 403 }
    );
  }

  // Ensure invitation hasn't been processed already
  if (membership.status !== "invited") {
    return NextResponse.json(
      {
        success: false,
        message: "This invitation has already been processed",
      },
      { status: 400 }
    );
  }

  const organization = await getDocument(
    "organizations",
    membership.organizationId
  );
  if (!organization) {
    return NextResponse.json(
      { success: false, message: "Organization not found" },
      { status: 404 }
    );
  }

  let response: InvitationResponse;

  if (action === "accept") {
    // Update membership status to active and record join timestamp
    await updateDocument("organizationMemberships", token, {
      status: "active",
      joinedAt: serverTimestamp(),
    });

    // Clean up invitation notification
    await NotificationService.removeInvitationNotification(
      membership.userId,
      token
    );

    // Notify the inviter about acceptance
    if (membership.invitedBy) {
      await NotificationService.createNotification(
        membership.invitedBy,
        "Invitation Accepted",
        `Your invitation to join ${organization.name} has been accepted.`,
        "organization_invite_accepted",
        membership.organizationId,
        `/organizations/${membership.organizationId}`,
        {
          organizationId: membership.organizationId,
          membershipId: token,
          acceptedBy: membership.userId,
        }
      );
    }

    // Notify all existing organization members about the new joiner
    try {
      const allMembers = await getOrganizationMembers(
        membership.organizationId
      );
      const existingMembers = allMembers.filter(
        (member) => member.userId !== membership.userId
      );

      const memberJoinedPromises = existingMembers.map((member) =>
        NotificationService.createNotification(
          member.userId,
          "New Member Joined",
          `${membership.userProfile?.displayName || membership.userProfile?.email || "A new member"} has joined ${organization.name}.`,
          "member_joined",
          membership.organizationId,
          `/organizations/${membership.organizationId}/members`,
          {
            joinedMemberId: membership.userId,
            joinedMemberName:
              membership.userProfile?.displayName ||
              membership.userProfile?.email,
            organizationId: membership.organizationId,
          }
        )
      );

      await Promise.all(memberJoinedPromises);
    } catch (notificationError) {
      // Non-critical: Don't fail the invitation if notifications fail
      console.warn(
        "Failed to send member_joined notifications:",
        notificationError
      );
    }

    response = {
      success: true,
      message: `Successfully joined ${organization.name}`,
      redirectUrl: `/organizations/${membership.organizationId}`,
      organizationId: membership.organizationId,
      organizationName: organization.name,
    };
  } else {
    // Process invitation decline
    await NotificationService.removeInvitationNotification(
      membership.userId,
      token
    );

    // Notify the inviter about decline
    if (membership.invitedBy) {
      await NotificationService.createNotification(
        membership.invitedBy,
        "Invitation Declined",
        `Your invitation to join ${organization.name} has been declined.`,
        "organization_invite_declined",
        membership.organizationId,
        `/organizations/${membership.organizationId}`,
        {
          organizationId: membership.organizationId,
          membershipId: token,
          declinedBy: membership.userId,
        }
      );
    }

    // Update membership status to declined
    await updateDocument("organizationMemberships", token, {
      status: "declined",
    });

    response = {
      success: true,
      message: `Invitation to join ${organization.name} has been declined`,
      redirectUrl: "/organizations",
    };
  }

  return NextResponse.json(response);
}

/**
 * GET handler for invitation tokens
 * - Without action: Returns invitation details for display
 * - With action (accept/decline): Processes the invitation response
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action"); // 'accept', 'decline', or null for details
    const userId = searchParams.get("userId");

    if (!token) {
      return NextResponse.json(
        { success: false, message: "Invalid invitation token" },
        { status: 400 }
      );
    }

    // If action is specified, delegate to helper
    if (action) {
      return await handleInvitationAction(token, action, userId);
    }

    // Retrieve membership record for details display
    const membership = (await getDocument(
      "organizationMemberships",
      token
    )) as OrganizationMembership;

    if (!membership) {
      return NextResponse.json(
        { success: false, message: "Invitation not found or expired" },
        { status: 404 }
      );
    }

    // Ensure invitation hasn't been processed already
    if (membership.status !== "invited") {
      return NextResponse.json(
        {
          success: false,
          message: "This invitation has already been processed",
        },
        { status: 400 }
      );
    }

    const organization = await getDocument(
      "organizations",
      membership.organizationId
    );
    if (!organization) {
      return NextResponse.json(
        { success: false, message: "Organization not found" },
        { status: 404 }
      );
    }

    // Get inviter details for display purposes
    const inviterUser = membership.invitedBy
      ? await getDocument("users", membership.invitedBy)
      : null;

    return NextResponse.json({
      success: true,
      organizationName: organization.name,
      organizationId: membership.organizationId,
      role: membership.role,
      inviterName: inviterUser?.displayName || inviterUser?.email || "Unknown",
    });
  } catch (error) {
    console.error("Error processing invitation:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST handler for invitation responses
 * Method for processing invitations via request body
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const body = await request.json();
    const { action, userId } = body;

    if (!token) {
      return NextResponse.json(
        { success: false, message: "Invalid invitation token" },
        { status: 400 }
      );
    }

    return await handleInvitationAction(token, action, userId);
  } catch (error) {
    console.error("Error processing invitation:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 }
    );
  }
}
