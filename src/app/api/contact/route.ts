import { NextRequest, NextResponse } from "next/server";
import { verifyCsrf } from "@/lib/csrf";
import { emailService } from "@/lib/services/emailService";
import { createLogger } from "@/lib/utils/logger";

const logger = createLogger("ContactAPI");

const CONTACT_RECIPIENT =
  process.env.CONTACT_EMAIL || "support@boostflow-thesis.me";

const VALID_SUBJECTS = new Set([
  "general",
  "sales",
  "support",
  "demo",
  "other",
]);

const SUBJECT_LABELS: Record<string, string> = {
  general: "General Inquiry",
  sales: "Sales Question",
  support: "Technical Support",
  demo: "Request a Demo",
  other: "Other",
};

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  const { name, email, subject, message, csrf_token } = body as {
    name?: string;
    email?: string;
    subject?: string;
    message?: string;
    csrf_token?: string;
  };

  if (!verifyCsrf(request, csrf_token)) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  if (
    !name ||
    !email ||
    !subject ||
    !message ||
    typeof name !== "string" ||
    typeof email !== "string" ||
    typeof subject !== "string" ||
    typeof message !== "string"
  ) {
    return NextResponse.json(
      { error: "All fields are required" },
      { status: 400 }
    );
  }

  if (name.length > 200 || email.length > 254 || message.length > 5000) {
    return NextResponse.json(
      { error: "Field length exceeded" },
      { status: 400 }
    );
  }

  const emailRegex = /^[^\s@]+@(?:[^\s@.]+\.)+[^\s@.]+$/;
  if (!emailRegex.test(email)) {
    return NextResponse.json(
      { error: "Invalid email address" },
      { status: 400 }
    );
  }

  if (!VALID_SUBJECTS.has(subject)) {
    return NextResponse.json({ error: "Invalid subject" }, { status: 400 });
  }

  const subjectLabel = SUBJECT_LABELS[subject];

  const result = await emailService.sendEmail({
    to: CONTACT_RECIPIENT,
    subject: `[BoostFlow Contact] ${subjectLabel} from ${name}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">New Contact Form Submission</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #eee;">Name</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${name}</td>
          </tr>
          <tr>
            <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #eee;">Email</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><a href="mailto:${email}">${email}</a></td>
          </tr>
          <tr>
            <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #eee;">Subject</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${subjectLabel}</td>
          </tr>
          <tr>
            <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #eee;">Message</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; white-space: pre-wrap;">${message}</td>
          </tr>
        </table>
        <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
        <p style="color: #666; font-size: 12px;">This message was sent via the BoostFlow contact form.</p>
      </div>
    `,
    text: `New Contact Form Submission\n\nName: ${name}\nEmail: ${email}\nSubject: ${subjectLabel}\nMessage:\n${message}`,
    from: process.env.DEFAULT_FROM_EMAIL || "noreply@boostflow-thesis.me",
  });

  if (!result.success) {
    logger.error("Failed to send contact email", undefined, {
      error: result.error,
      from: email,
    });
    return NextResponse.json(
      { error: "Failed to send message. Please try again later." },
      { status: 500 }
    );
  }

  logger.info("Contact form email sent", {
    from: email,
    subject: subjectLabel,
    messageId: result.messageId,
  });

  return NextResponse.json({ success: true }, { status: 200 });
}
