// Test SendGrid email functionality
// Run with: node test-sendgrid.js

require("dotenv").config({ path: ".env.local" });

const sgMail = require("@sendgrid/mail");

// Set API key
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const msg = {
  to: "it2022150@hua.gr", // Your test email
  from: "noreply@boostflow-thesis.me", // Must be verified sender in SendGrid
  subject: "BoostFlow SendGrid Test Email",
  text: "This is a test email from BoostFlow to verify SendGrid integration is working correctly.",
  html: `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333;">BoostFlow SendGrid Test</h2>
      <p>Hi there,</p>
      <p>This is a test email to verify that the SendGrid integration is working correctly with BoostFlow.</p>
      <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
        <h3 style="color: #28a745; margin-top: 0;">✅ Integration Status</h3>
        <p><strong>SendGrid API:</strong> Connected successfully</p>
        <p><strong>Email Service:</strong> Operational</p>
        <p><strong>Test Date:</strong> ${new Date().toLocaleString()}</p>
      </div>
      <p>If you received this email, the SendGrid integration is working properly!</p>
      <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
      <p style="color: #666; font-size: 12px;">This is an automated test email from BoostFlow.</p>
    </div>
  `,
};

sgMail
  .send(msg)
  .then(() => {
    console.log("✅ Test email sent successfully!");
    console.log("📧 Email sent to: it2022053@hua.gr");
    console.log("📤 From: noreply@boostflow-thesis.me");
    console.log(
      "🔑 Using SendGrid API Key:",
      process.env.SENDGRID_API_KEY ? "Configured" : "Missing"
    );
  })
  .catch((error) => {
    console.error("❌ Failed to send test email:");
    console.error(error.response ? error.response.body : error);

    if (error.code === 403) {
      console.log("\n🔍 Troubleshooting tips:");
      console.log("1. Verify your SendGrid API key is correct");
      console.log(
        "2. Make sure the sender email (noreply@boostflow-thesis.me) is verified in SendGrid"
      );
      console.log(
        "3. Check if your SendGrid account is active and not suspended"
      );
    }
  });
