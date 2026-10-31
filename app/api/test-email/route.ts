import { apiUser } from "@/lib/authz";
import { sendEmail } from "@/lib/automation/email";
import { jsonError } from "@/lib/http";

export async function POST() {
  if (process.env.NODE_ENV !== "development") {
    return jsonError("This endpoint is available only in development.", 404);
  }

  try {
    const auth = await apiUser();
    if (!auth.user) return jsonError("Authentication required.", auth.status);
    if (auth.user.role !== "ADMIN") return jsonError("Administrator access required.", 403);

    const recipient = process.env.ADMIN_EMAIL?.trim();
    if (!recipient) return jsonError("ADMIN_EMAIL is not configured.", 503);

    const result = await sendEmail({
      to: recipient,
      subject: "Shortfundly InternFlow SMTP test",
      text: "This is a test email from Shortfundly InternFlow.",
      html: "<p>This is a test email from Shortfundly InternFlow.</p>",
    });
    if (!result.success) return jsonError(result.error, 502);
    return Response.json({ success: true, message: "SMTP test email sent to the configured administrator address." });
  } catch {
    console.error("SMTP test email request failed.");
    return jsonError("The SMTP test email could not be sent. Check server-side SMTP configuration.", 500);
  }
}
