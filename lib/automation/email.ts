import nodemailer, { type Transporter } from "nodemailer";
import { z } from "zod";
import { EmailLog } from "@/lib/models";

const emailAddressSchema = z.string().trim().email().max(320);
const messageSchema = z.object({
  to: emailAddressSchema,
  subject: z.string().trim().min(1).max(998).refine((value) => !/[\r\n]/.test(value)),
  text: z.string().min(1).max(100_000),
  html: z.string().min(1).max(200_000),
});

type SmtpConfiguration = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
};

export type EmailSendResult =
  | { success: true; messageId: string }
  | { success: false; error: string };

let transporter: Transporter | undefined;

export type AutomationEmail = {
  assignmentId: string;
  recipient: string;
  templateType: string;
  idempotencyKey: string;
  subject: string;
  text: string;
  html: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function smtpConfiguration(): SmtpConfiguration {
  const host = process.env.SMTP_HOST?.trim() || "smtp.gmail.com";
  const portValue = process.env.SMTP_PORT?.trim() || "465";
  const port = Number(portValue);
  if (!Number.isInteger(port) || ![465, 587].includes(port)) {
    throw new Error("SMTP_PORT must be 465 or 587.");
  }
  const secureValue = process.env.SMTP_SECURE?.trim().toLowerCase();
  if (secureValue && secureValue !== "true" && secureValue !== "false") {
    throw new Error("SMTP_SECURE must be true or false.");
  }
  const secure = secureValue ? secureValue === "true" : port === 465;
  if ((port === 465) !== secure) {
    throw new Error("SMTP port and TLS settings do not match. Use port 465 with TLS or port 587 with STARTTLS.");
  }

  const user = emailAddressSchema.parse(requiredEnv("SMTP_USER"));
  const from = emailAddressSchema.parse(requiredEnv("EMAIL_FROM"));
  const password = requiredEnv("SMTP_PASSWORD").replace(/\s/g, "");
  if (!password) throw new Error("SMTP_PASSWORD is not configured.");

  return { host, port, secure, user, password, from };
}

function getTransport(configuration: SmtpConfiguration): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: configuration.host,
      port: configuration.port,
      secure: configuration.secure,
      requireTLS: !configuration.secure,
      auth: { user: configuration.user, pass: configuration.password },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return transporter;
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<EmailSendResult> {
  const message = messageSchema.safeParse(input);
  if (!message.success) return { success: false, error: "The recipient or email content is invalid." };

  let configuration: SmtpConfiguration;
  try {
    configuration = smtpConfiguration();
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "SMTP is not configured correctly.",
    };
  }

  try {
    const result = await getTransport(configuration).sendMail({
      from: configuration.from,
      to: message.data.to,
      subject: message.data.subject,
      text: message.data.text,
      html: message.data.html,
    });
    return { success: true, messageId: result.messageId };
  } catch {
    return {
      success: false,
      error: "SMTP email delivery failed. Check the server-side SMTP settings and Gmail App Password.",
    };
  }
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] || character);
}

export async function sendAutomationEmail(email: AutomationEmail): Promise<void> {
  const existing = await EmailLog.findOne({ idempotencyKey: email.idempotencyKey }).lean();
  if (existing && ["ACCEPTED", "DELIVERED", "SENT", "BOUNCED"].includes(existing.status)) return;

  await EmailLog.findOneAndUpdate(
    { idempotencyKey: email.idempotencyKey },
    {
      $setOnInsert: {
        relatedAssignmentId: email.assignmentId,
        recipient: email.recipient,
        templateType: email.templateType,
        idempotencyKey: email.idempotencyKey,
      },
      $set: { status: "PENDING", lastAttemptAt: new Date(), lastError: "", errorMessage: "" },
      $inc: { attemptCount: 1 },
    },
    { upsert: true, new: true, runValidators: true },
  );

  const result = await sendEmail({
    to: email.recipient,
    subject: email.subject,
    text: email.text,
    html: email.html,
  });
  if (result.success) {
    await EmailLog.updateOne(
      { idempotencyKey: email.idempotencyKey },
      { $set: { status: "SENT", providerMessageId: result.messageId, sentAt: new Date(), lastError: "", errorMessage: "" } },
    );
    return;
  }

  const message = result.error.slice(0, 500);
  await EmailLog.updateOne(
    { idempotencyKey: email.idempotencyKey },
    { $set: { status: "FAILED", lastError: message, errorMessage: message } },
  );
  throw new Error(result.error);
}
