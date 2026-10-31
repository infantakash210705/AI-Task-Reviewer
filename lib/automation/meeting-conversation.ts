import { connectDB } from "@/lib/db";
import { Assignment, Intern, Meeting, MeetingRequest, MeetingTurn, Review, Submission, TaskExplanation, User } from "@/lib/models";
import { taskFingerprint, type TaskContext } from "@/lib/automation/explanation";
import { generateMentorAnswer } from "@/lib/automation/mentor-ai";
import { botDisplayName, mentorLanguage, mentorName, toSpokenText } from "@/lib/automation/mentor-persona";
import { sendBotAudio } from "@/lib/automation/meeting-agent-provider";
import { estimateMp3Seconds, isBackchannel, isBotSpeaker, type TranscriptChunk } from "@/lib/automation/meeting-transcript";
import { synthesizeSpeech } from "@/lib/automation/tts";

const DEBOUNCE_MS = 1_200;
const MAX_MENTOR_TURNS = 120;
/** Statuses where the bot is live and can speak. IN_MEETING is the primary active state. */
const LIVE_STATUSES = ["SCHEDULED", "CONNECTING", "IN_MEETING"];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

function taskContext(snapshot: Record<string, unknown>): TaskContext {
  return {
    title: String(snapshot.title || ""),
    shortDescription: String(snapshot.shortDescription || ""),
    fullDescription: String(snapshot.fullDescription || ""),
    difficulty: String(snapshot.difficulty || ""),
    requiredSkills: strings(snapshot.requiredSkills),
    requirements: strings(snapshot.requirements),
    acceptanceCriteria: strings(snapshot.acceptanceCriteria),
    expectedDeliverables: strings(snapshot.expectedDeliverables),
  };
}

type LiveContext = {
  meetingId: string;
  assignmentId: string;
  botId: string;
  task: TaskContext;
  explanation: unknown;
  internName: string;
  extraContext: string;
  topic: string;
};

async function loadLiveContext(meetingId: string, botId?: string): Promise<LiveContext | null> {
  await connectDB();
  const meeting = await Meeting.findOne({
    _id: meetingId,
    agentConsentStatus: "GRANTED",
    agentStatus: { $in: LIVE_STATUSES },
    // Note: meeting.status stays "SCHEDULED" throughout, agentStatus tracks bot lifecycle
    ...(botId ? { agentProviderSessionId: botId } : {}),
  }).lean();
  if (!meeting || !meeting.agentProviderSessionId) return null;
  const endsAt = new Date(meeting.scheduledAt).getTime() + (meeting.durationMinutes + 45) * 60_000;
  if (Date.now() > endsAt) return null;

  const assignment = await Assignment.findById(meeting.assignmentId).lean();
  if (!assignment?.taskSnapshot) return null;
  const intern = await Intern.findById(assignment.internId).select("userId").lean();
  const user = intern ? await User.findById(intern.userId).select("name").lean() : null;
  const task = taskContext(assignment.taskSnapshot as Record<string, unknown>);
  const [explanation, request, latestReview, latestSubmission] = await Promise.all([
    TaskExplanation.findOne({ assignmentId: assignment._id, taskFingerprint: taskFingerprint(task), generationStatus: "COMPLETED" }).select("content").lean(),
    meeting.requestId ? MeetingRequest.findById(meeting.requestId).select("topic").lean() : null,
    Review.findOne({ assignmentId: assignment._id, outcome: { $in: ["PASS", "REVISION_REQUIRED"] } }).sort({ reviewedAt: -1 }).lean(),
    Submission.findOne({ assignmentId: assignment._id }).sort({ submittedAt: -1 }).lean(),
  ]);

  const lines = [
    "This is a live Google Meet call with the intern, not a text chat. Speak, don't write.",
    "Your microphone is active and unmuted. Answer the intern aloud in clear spoken words.",
    request?.topic ? `The intern asked for this meeting to address this specific intent / query: ${request.topic}` : "",
    "Directly address that intent with a clear answer in 1 to 3 spoken sentences, and always finish your turn by asking one focused follow-up question to guide them.",
  ];
  if (latestSubmission?.repositoryUrl) {
    lines.push(`The intern submitted repository: ${latestSubmission.repositoryUrl}${latestSubmission.repositoryMetadata?.defaultBranch ? ` (${latestSubmission.repositoryMetadata.defaultBranch} branch)` : ""}${latestSubmission.repositoryMetadata?.latestCommitMessage ? ` - latest commit: "${latestSubmission.repositoryMetadata.latestCommitMessage}"` : ""}.`);
  }
  if (["FIRST_REVIEW", "REVIEW"].includes(meeting.meetingType)) {
    lines.push("This meeting is specifically to review the intern's submitted project and clarify their implementation queries.");
  }
  if (latestReview) {
    const failing = (latestReview.requirementsAssessed || []).filter((item: { status: string }) => item.status !== "PASS").slice(0, 5).map((item: { criterion: string; explanation: string }) => `${item.criterion} (${item.explanation})`);
    const findings = (latestReview.structuredFindings || []).slice(0, 5).map((item: { title: string; recommendedFix?: string }) => `${item.title}${item.recommendedFix ? ` - fix: ${item.recommendedFix}` : ""}`);
    lines.push(
      `Latest review of the intern's submission: ${latestReview.outcome}. Summary: ${latestReview.summary}`,
      failing.length ? `Criteria still not met: ${failing.join("; ")}` : "",
      findings.length ? `Main issues found: ${findings.join("; ")}` : "",
      "When it helps, explain what the intern needs to change in their work, one point at a time.",
    );
  } else {
    lines.push("No submission has been reviewed yet, so focus on explaining the task and what a good result looks like.");
  }
  return {
    meetingId,
    assignmentId: String(assignment._id),
    botId: meeting.agentProviderSessionId,
    task,
    explanation: explanation?.content,
    internName: user?.name || "",
    extraContext: lines.filter(Boolean).join("\n"),
    topic: request?.topic || "",
  };
}

async function speak(context: LiveContext, text: string): Promise<void> {
  const spoken = toSpokenText(text);
  if (!spoken) return;
  console.info("[meeting-conversation] synthesizing speech", { meetingId: context.meetingId, textLen: spoken.length, text: spoken.slice(0, 80) });
  const audio = await synthesizeSpeech(spoken, mentorLanguage());
  console.info("[meeting-conversation] sending audio to bot", { meetingId: context.meetingId, botId: context.botId, audioBytes: audio.length });
  await sendBotAudio(context.botId, audio);
  const seq = await nextSeq(context.meetingId);
  await MeetingTurn.create({ meetingId: context.meetingId, seq, speaker: "MENTOR", speakerName: mentorName(), text: spoken });
  await Meeting.updateOne({ _id: context.meetingId }, { $set: { agentSpeakingUntil: new Date(Date.now() + (estimateMp3Seconds(audio.length) + 1.5) * 1000) } });
  console.info("[meeting-conversation] spoke successfully", { meetingId: context.meetingId, seq });
}

async function nextSeq(meetingId: string): Promise<number> {
  const updated = await Meeting.findOneAndUpdate({ _id: meetingId }, { $inc: { agentLastUtteranceSeq: 1 } }, { new: true }).select("agentLastUtteranceSeq").lean();
  return updated?.agentLastUtteranceSeq || 1;
}

/** Stores one transcript chunk. Returns the chunk's sequence number when the mentor should consider replying. */
export async function recordTranscriptChunk(chunk: TranscriptChunk): Promise<number | null> {
  await connectDB();
  if (isBotSpeaker(chunk.speakerName, botDisplayName())) return null;
  // Only transcribe while the call is actively ongoing; once call ends, drop further transcript chunks.
  const meeting = await Meeting.findOne({
    _id: chunk.meetingId,
    agentProviderSessionId: chunk.botId,
    agentConsentStatus: "GRANTED",
    agentStatus: { $in: LIVE_STATUSES },
    agentEndedAt: null,
  }).select("_id").lean();
  if (!meeting) return null;
  const seq = await nextSeq(chunk.meetingId);
  await MeetingTurn.create({ meetingId: chunk.meetingId, seq, speaker: "INTERN", speakerName: chunk.speakerName, text: chunk.text });
  return seq;
}

async function claimTurn(meetingId: string, waitMs: number): Promise<boolean> {
  const deadline = Date.now() + waitMs;
  do {
    const now = new Date();
    const claimed = await Meeting.findOneAndUpdate(
      { _id: meetingId, $or: [{ agentSpeakingUntil: null }, { agentSpeakingUntil: { $lte: now } }] },
      { $set: { agentSpeakingUntil: new Date(now.getTime() + 60_000) } },
      { new: true },
    ).select("_id").lean();
    if (claimed) return true;
    await sleep(700);
  } while (Date.now() < deadline);
  return false;
}

/** Waits for a short pause, then answers everything the intern said since the mentor last spoke. */
export async function respondAfterPause(meetingId: string, seq: number): Promise<"REPLIED" | "SKIPPED"> {
  await sleep(DEBOUNCE_MS);
  await connectDB();
  const latest = await Meeting.findById(meetingId).select("agentLastUtteranceSeq agentStatus").lean();
  if (!latest || latest.agentLastUtteranceSeq !== seq) {
    console.info("[meeting-conversation] skipping: seq superseded", { meetingId, seq, currentSeq: latest?.agentLastUtteranceSeq });
    return "SKIPPED"; // a newer chunk will answer
  }
  if (!(await claimTurn(meetingId, 25_000))) {
    console.info("[meeting-conversation] skipping: could not claim turn", { meetingId });
    return "SKIPPED";
  }

  const release = () => Meeting.updateOne({ _id: meetingId }, { $set: { agentSpeakingUntil: null } });
  try {
    const context = await loadLiveContext(meetingId);
    if (!context) {
      console.warn("[meeting-conversation] skipping: loadLiveContext returned null", { meetingId, agentStatus: latest?.agentStatus });
      await release();
      return "SKIPPED";
    }
    const turns = await MeetingTurn.find({ meetingId }).sort({ seq: -1 }).limit(30).lean();
    turns.reverse();
    const lastMentor = [...turns].reverse().find((turn) => turn.speaker === "MENTOR")?.seq || 0;
    const pending = turns.filter((turn) => turn.speaker === "INTERN" && turn.seq > lastMentor);
    if (pending.length === 0) { await release(); return "SKIPPED"; }
    const question = pending.map((turn) => turn.text).join(" ").slice(0, 1500);
    if (isBackchannel(question)) {
      console.info("[meeting-conversation] skipping: backchannel filler", { meetingId, question });
      await release();
      return "SKIPPED";
    }
    if (turns.filter((turn) => turn.speaker === "MENTOR").length >= MAX_MENTOR_TURNS) { await release(); return "SKIPPED"; }

    console.info("[meeting-conversation] generating answer", { meetingId, question: question.slice(0, 80) });
    const history = turns.filter((turn) => turn.seq <= lastMentor).slice(-10).map((turn) => ({
      role: turn.speaker === "MENTOR" ? ("ASSISTANT" as const) : ("USER" as const),
      content: turn.text,
    }));
    const answer = await generateMentorAnswer({
      task: context.task,
      explanation: context.explanation,
      priorMessages: history,
      question,
      mode: "spoken",
      internName: context.internName,
      extraContext: context.extraContext,
    });
    await speak(context, answer);
    return "REPLIED";
  } catch (error) {
    console.error("[meeting-conversation] reply failed", { meetingId, reason: error instanceof Error ? error.message : String(error) });
    await release();
    return "SKIPPED";
  }
}

/** Says hello once, right after the bot joins the call. */
export async function openMeeting(meetingId: string): Promise<boolean> {
  await connectDB();
  await sleep(3_000);
  const claimed = await Meeting.findOneAndUpdate(
    { _id: meetingId, agentGreetedAt: null },
    { $set: { agentGreetedAt: new Date() } },
    { new: true },
  ).select("_id").lean();
  if (!claimed) return false;
  const context = await loadLiveContext(meetingId);
  if (!context) return false;
  const first = context.internName.split(/\s+/)[0] || "there";
  const fallback = `Hi ${first}, this is ${mentorName()} from Shortfundly. My microphone is on and I can hear you clearly. I've reviewed your task "${context.task.title}". ${context.topic ? `Regarding ${context.topic}, ` : ""}where would you like to start?`;
  let greeting = fallback;
  try {
    greeting = await generateMentorAnswer({
      task: context.task,
      explanation: context.explanation,
      priorMessages: [],
      question: `(The call has just connected. Greet ${first} warmly, confirm your microphone is on, mention you've reviewed their task "${context.task.title}"${context.topic ? ` and their query: "${context.topic}"` : ""}, and ask one proactive question to begin. Keep it to two or three short conversational sentences, no lists.)`,
      mode: "spoken",
      internName: context.internName,
      extraContext: context.extraContext,
    });
  } catch {
    greeting = fallback;
  }
  try {
    await speak(context, greeting);
    return true;
  } catch {
    console.error("[meeting-conversation] greeting failed", { meetingId });
    return false;
  }
}
