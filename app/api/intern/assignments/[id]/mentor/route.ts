import mongoose from "mongoose";
import { z } from "zod";
import { apiUser } from "@/lib/authz";
import { connectDB } from "@/lib/db";
import { Assignment, Intern, MentorConversation, MentorSession, TaskExplanation } from "@/lib/models";
import { handleApiError, jsonError } from "@/lib/http";
import { taskFingerprint, type TaskContext } from "@/lib/automation/explanation";
import { generateMentorAnswer, MentorAiError } from "@/lib/automation/mentor-ai";

const questionInput = z.object({
  message: z.string().trim().min(1).max(2000),
  sessionId: z.string().min(1).max(64).optional(),
});

function geminiFailureResponse(error: unknown) {
  const status = typeof error === "object" && error !== null && "status" in error
    ? Number(error.status)
    : 0;
  if (status === 429) return jsonError("Your mentor is getting a lot of requests. Wait a moment and try again.", 429);
  if (status === 404) return jsonError("Your mentor is unavailable right now. Please contact your administrator.", 503);
  if (status === 504 || status >= 500) return jsonError("Your mentor is a bit slow right now. Please try again shortly.", 503);
  return handleApiError(error, "mentor.ask");
}

function taskContext(assignment: { taskSnapshot: Record<string, unknown> }): TaskContext {
  const snapshot = assignment.taskSnapshot;
  return {
    title: String(snapshot.title || ""),
    shortDescription: String(snapshot.shortDescription || ""),
    fullDescription: String(snapshot.fullDescription || ""),
    difficulty: String(snapshot.difficulty || ""),
    requiredSkills: Array.isArray(snapshot.requiredSkills) ? snapshot.requiredSkills.map(String) : [],
    requirements: Array.isArray(snapshot.requirements) ? snapshot.requirements.map(String) : [],
    acceptanceCriteria: Array.isArray(snapshot.acceptanceCriteria) ? snapshot.acceptanceCriteria.map(String) : [],
    expectedDeliverables: Array.isArray(snapshot.expectedDeliverables) ? snapshot.expectedDeliverables.map(String) : [],
  };
}

async function ownedAssignment(assignmentId: string, userId: string) {
  const intern = await Intern.findOne({ userId, status: { $ne: "INACTIVE" } }).select("_id").lean();
  if (!intern) return null;
  return Assignment.findOne({ _id: assignmentId, internId: intern._id }).lean();
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiUser();
  if (!auth.user) return jsonError("Authentication required.", auth.status);
  if (auth.user.role !== "INTERN") return jsonError("Intern access required.", 403);
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return jsonError("Assignment not found.", 404);
  try {
    await connectDB();
    const assignment = await ownedAssignment(id, String(auth.user._id));
    if (!assignment) return jsonError("Assignment not found.", 404);
    const fingerprint = taskFingerprint(taskContext(assignment as { taskSnapshot: Record<string, unknown> }));
    const [explanation, conversation] = await Promise.all([
      TaskExplanation.findOne({ assignmentId: id, taskFingerprint: fingerprint, generationStatus: "COMPLETED" }).select("content generatedAt modelIdentifier").lean(),
      MentorConversation.findOne({ assignmentId: id, userId: auth.user._id }).select("messages").lean(),
    ]);
    return Response.json({
      status: assignment.explanationStatus || "PENDING",
      task: assignment.taskSnapshot,
      explanation: explanation?.content || null,
      messages: (conversation?.messages || []).map((message: { role: string; content: string; createdAt: Date }) => ({ role: message.role, content: message.content, createdAt: message.createdAt })),
    });
  } catch (error) {
    return handleApiError(error, "mentor.get");
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiUser();
  if (!auth.user) return jsonError("Authentication required.", auth.status);
  if (auth.user.role !== "INTERN") return jsonError("Intern access required.", 403);
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return jsonError("Assignment not found.", 404);
  try {
    await connectDB();
    const input = questionInput.parse(await request.json());
    const assignment = await ownedAssignment(id, String(auth.user._id));
    if (!assignment) return jsonError("Assignment not found.", 404);
    const fingerprint = taskFingerprint(taskContext(assignment as { taskSnapshot: Record<string, unknown> }));
    const explanation = await TaskExplanation.findOne({ assignmentId: id, taskFingerprint: fingerprint, generationStatus: "COMPLETED" }).lean();
    if ((process.env.MENTOR_AI_PROVIDER?.trim().toLowerCase() || "auto") === "gemini" && !process.env.GEMINI_API_KEY?.trim()) {
      return jsonError("Your mentor is not set up yet. Please contact your administrator.", 503);
    }

    let activeSession = null;
    if (input.sessionId) {
      if (!mongoose.isValidObjectId(input.sessionId)) return jsonError("The voice session is invalid.", 400);
      activeSession = await MentorSession.findOne({
        _id: input.sessionId,
        assignmentId: assignment._id,
        userId: auth.user._id,
        status: "ACTIVE",
        recordingEnabled: false,
      }).select("_id").lean();
      if (!activeSession) return jsonError("The voice session is no longer active. Start a new session to continue.", 409);
    }

    const now = new Date();
    const windowStart = new Date(now.getTime() - 60_000);
    let conversation = await MentorConversation.findOne({ assignmentId: id, userId: auth.user._id });
    if (!conversation) {
      conversation = await MentorConversation.create({
        assignmentId: id,
        userId: auth.user._id,
        messages: [],
        rateLimitWindowStart: now,
        requestCount: 1,
      });
    } else if (!conversation.rateLimitWindowStart || conversation.rateLimitWindowStart < windowStart) {
      conversation.rateLimitWindowStart = now;
      conversation.requestCount = 1;
      await conversation.save();
    } else if (conversation.requestCount >= 8) {
      return jsonError("Please wait a minute before asking another mentor question.", 429);
    } else {
      conversation.requestCount += 1;
      await conversation.save();
    }

    const task = taskContext(assignment as { taskSnapshot: Record<string, unknown> });
    const priorMessages = conversation.messages.slice(-10).map((message: { role: "USER" | "ASSISTANT"; content: string }) => ({
      role: message.role,
      content: message.content,
    }));
    let answer: string;
    try {
      answer = await generateMentorAnswer({
        task,
        explanation: explanation?.content,
        priorMessages,
        question: input.message,
        mode: activeSession ? "spoken" : "chat",
        internName: auth.user.name,
      });
    } catch (error) {
      if (error instanceof MentorAiError) return jsonError(error.message, error.statusCode);
      return geminiFailureResponse(error);
    }
    if (!answer || answer.length > 4000) throw new Error("The mentor returned an empty response.");
    conversation.messages.push({ role: "USER", content: input.message, createdAt: now, sessionId: activeSession ? input.sessionId : "" });
    conversation.messages.push({ role: "ASSISTANT", content: answer, createdAt: new Date(), sessionId: activeSession ? input.sessionId : "" });
    conversation.messages = conversation.messages.slice(-20);
    conversation.updatedAt = new Date();
    await conversation.save();
    return Response.json({ answer });
  } catch (error) {
    return handleApiError(error, "mentor.ask");
  }
}
