import mongoose, { Schema, models } from "mongoose";

const options = { timestamps: true, versionKey: false as const };

const userSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  email: { type: String, required: true, lowercase: true, trim: true },
  normalizedEmail: { type: String, required: true, lowercase: true, trim: true },
  image: { type: String, default: "" },
  role: { type: String, enum: ["ADMIN", "INTERN"], default: "INTERN", required: true },
  providerAccountId: { type: String, required: true, unique: true, index: true },
  isActive: { type: Boolean, default: true },
}, options);
userSchema.index({ normalizedEmail: 1 }, { unique: true });

const internSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  internCode: { type: String, required: true, uppercase: true, trim: true, unique: true },
  department: { type: String, required: true, trim: true, maxlength: 100 },
  internshipTitle: { type: String, required: true, trim: true, maxlength: 120 },
  startDate: { type: Date, required: true },
  expectedEndDate: { type: Date, required: true },
  contact: { phone: { type: String, trim: true, maxlength: 30 } },
  status: { type: String, enum: ["ACTIVE", "COMPLETED", "INACTIVE"], default: "ACTIVE" },
}, options);
internSchema.index({ status: 1, department: 1 });

const taskSchema = new Schema({
  title: { type: String, required: true, trim: true, maxlength: 160 },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  shortDescription: { type: String, required: true, trim: true, maxlength: 300 },
  fullDescription: { type: String, required: true, trim: true, maxlength: 10000 },
  category: { type: String, required: true, trim: true, maxlength: 80 },
  difficulty: { type: String, enum: ["BEGINNER", "INTERMEDIATE", "ADVANCED"], required: true },
  requiredSkills: [{ type: String, trim: true, maxlength: 80 }],
  requirements: [{ type: String, trim: true, maxlength: 500 }],
  acceptanceCriteria: [{ type: String, trim: true, maxlength: 500 }],
  expectedDeliverables: [{ type: String, trim: true, maxlength: 500 }],
  estimatedDuration: { type: Number, min: 1, max: 365, required: true },
  revision: { type: Number, min: 1, default: 1 },
  status: { type: String, enum: ["DRAFT", "ACTIVE", "ARCHIVED"], default: "DRAFT" },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, options);
taskSchema.index({ status: 1, category: 1, createdAt: -1 });

const assignmentSchema = new Schema({
  internId: { type: Schema.Types.ObjectId, ref: "Intern", required: true, index: true },
  taskId: { type: Schema.Types.ObjectId, ref: "Task", required: true },
  taskSnapshot: {
    title: { type: String, required: true },
    shortDescription: { type: String, required: true },
    fullDescription: { type: String, required: true },
    category: { type: String, required: true },
    difficulty: { type: String, required: true },
    requiredSkills: [{ type: String }],
    requirements: [{ type: String }],
    acceptanceCriteria: [{ type: String }],
    expectedDeliverables: [{ type: String }],
    estimatedDuration: { type: Number, required: true },
    revision: { type: Number, min: 1, default: 1 },
  },
  assignedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  assignedAt: { type: Date, default: Date.now },
  dueDate: { type: Date, required: true },
  status: { type: String, enum: ["ASSIGNED", "IN_PROGRESS", "SUBMITTED", "IN_REVIEW", "REVISION_REQUIRED", "COMPLETED"], default: "ASSIGNED" },
  progress: { type: Number, min: 0, max: 100, default: 0 },
  currentSubmissionId: { type: Schema.Types.ObjectId, ref: "Submission", default: null },
  latestReviewId: { type: Schema.Types.ObjectId, ref: "Review", default: null },
  reviewCycleNumber: { type: Number, min: 0, default: 0 },
  lastReviewAt: { type: Date, default: null },
  nextReviewAt: { type: Date, default: null },
  completionStatus: { type: String, enum: ["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "NEEDS_CLARIFICATION"], default: "NOT_STARTED" },
  completionCriteriaVersion: { type: Number, min: 1, default: null },
  completionSummary: { type: String, maxlength: 2000, default: "" },
  finalReviewId: { type: Schema.Types.ObjectId, ref: "Review", default: null },
  finalSubmissionId: { type: Schema.Types.ObjectId, ref: "Submission", default: null },
  lastReviewError: { type: String, maxlength: 500, default: "" },
  completionDate: { type: Date, default: null },
  explanationStatus: { type: String, enum: ["PENDING", "PROCESSING", "COMPLETED", "FAILED"], default: "PENDING" },
  explanationGeneratedAt: { type: Date, default: null },
  explanationVersion: { type: Number, default: 1 },
  explanationSessionUrl: { type: String, trim: true, maxlength: 2048, default: "" },
  automationStatus: { type: String, enum: ["PENDING", "PROCESSING", "COMPLETED", "FAILED"], default: "PENDING" },
  automationWorkflowId: { type: String, trim: true, default: "" },
  firstReviewScheduledAt: { type: Date, default: null },
  lastAutomationError: { type: String, maxlength: 500, default: "" },
}, options);
assignmentSchema.index({ internId: 1, taskId: 1, status: 1 });
assignmentSchema.index({ dueDate: 1, status: 1 });
assignmentSchema.index({ automationStatus: 1, createdAt: -1 });

const submissionSchema = new Schema({
  assignmentId: { type: Schema.Types.ObjectId, ref: "Assignment", required: true, index: true },
  internId: { type: Schema.Types.ObjectId, ref: "Intern", required: true, index: true },
  submissionType: { type: String, enum: ["REPOSITORY_URL", "PROJECT_URL", "FILE_UPLOAD"], required: true },
  repositoryUrl: { type: String, trim: true, maxlength: 2048 },
  repositoryMetadata: {
    name: { type: String, trim: true, maxlength: 100, default: "" },
    owner: { type: String, trim: true, maxlength: 100, default: "" },
    description: { type: String, trim: true, maxlength: 1000, default: "" },
    defaultBranch: { type: String, trim: true, maxlength: 255, default: "" },
    latestCommitSha: { type: String, trim: true, maxlength: 64, default: "" },
    latestCommitMessage: { type: String, trim: true, maxlength: 500, default: "" },
    latestCommitDate: { type: String, trim: true, maxlength: 64, default: "" },
    latestCommitAuthor: { type: String, trim: true, maxlength: 200, default: "" },
  },
  projectUrl: { type: String, trim: true, maxlength: 2048 },
  uploadedFileReferences: [{ storageKey: { type: String, required: true, maxlength: 500 }, filename: { type: String, required: true, maxlength: 200 }, contentType: { type: String, required: true, maxlength: 120 }, size: { type: Number, min: 1, max: 20 * 1024 * 1024, required: true } }],
  version: { type: Number, min: 1, required: true },
  description: { type: String, trim: true, maxlength: 3000, default: "" },
  submittedAt: { type: Date, default: Date.now },
  branch: { type: String, trim: true, maxlength: 255, default: "" },
  commitSha: { type: String, trim: true, maxlength: 64, default: "" },
  processingStatus: { type: String, enum: ["QUEUED", "PROCESSING", "COMPLETED", "FAILED"], default: "QUEUED" },
  analysisStatus: { type: String, enum: ["PENDING", "PROCESSING", "COMPLETED", "FAILED", "NEEDS_CLARIFICATION"], default: "PENDING" },
  errorSummary: { type: String, maxlength: 500, default: "" },
  status: { type: String, enum: ["SUBMITTED", "IN_REVIEW", "REVISION_REQUIRED", "APPROVED"], default: "SUBMITTED" },
}, options);
submissionSchema.index({ assignmentId:  1, version: -1 }, { unique: true });

const reviewSchema = new Schema({
  assignmentId: { type: Schema.Types.ObjectId, ref: "Assignment", required: true, index: true },
  submissionId: { type: Schema.Types.ObjectId, ref: "Submission", required: true, index: true },
  reviewVersion: { type: Number, min: 1, default: 1 },
  reviewerType: { type: String, enum: ["HUMAN", "AI", "SYSTEM"], default: "HUMAN" },
  modelIdentifier: { type: String, maxlength: 120, default: "" },
  taskVersion: { type: Number, min: 1, default: 1 },
  acceptanceCriteriaSnapshot: [{ type: String, maxlength: 500 }],
  commitSha: { type: String, maxlength: 64, default: "" },
  outcome: { type: String, enum: ["PASS", "REVISION_REQUIRED", "NEEDS_CLARIFICATION", "REVIEW_FAILED"], default: undefined },
  summary: { type: String, required: true, trim: true, maxlength: 2000 },
  findings: [{ type: String, trim: true, maxlength: 1000 }],
  structuredFindings: [{
    findingId: { type: String, required: true, maxlength: 40 },
    category: { type: String, enum: ["FUNCTIONAL", "REQUIREMENT", "BUG", "SECURITY", "QUALITY", "TESTING", "DOCUMENTATION", "DELIVERABLE", "OTHER"], required: true },
    severity: { type: String, enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"], required: true },
    title: { type: String, required: true, maxlength: 200 },
    explanation: { type: String, required: true, maxlength: 2000 },
    filePath: { type: String, maxlength: 500, default: "" },
    lineStart: { type: Number, min: 1, default: null },
    lineEnd: { type: Number, min: 1, default: null },
    sourceExcerpt: { type: String, maxlength: 1000, default: "" },
    relatedCriterionId: { type: String, maxlength: 60, default: "" },
    recommendedFix: { type: String, maxlength: 1500, default: "" },
    blocksCompletion: { type: Boolean, default: false },
    verified: { type: Boolean, default: false },
  }],
  missingFeatures: [{ type: String, maxlength: 500 }],
  suggestedNextActions: [{ type: String, maxlength: 500 }],
  requirementsAssessed: [{
    criterionId: { type: String, required: true, maxlength: 60 },
    criterion: { type: String, required: true, maxlength: 500 },
    status: { type: String, enum: ["PASS", "FAIL", "UNCERTAIN"], required: true },
    explanation: { type: String, required: true, maxlength: 1000 },
    evidenceReferences: [{
      filePath: { type: String, required: true, maxlength: 500 },
      lineStart: { type: Number, min: 1, required: true },
      lineEnd: { type: Number, min: 1, required: true },
      excerpt: { type: String, maxlength: 1000, default: "" },
    }],
  }],
  recommendations: [{ type: String, trim: true, maxlength: 1000 }],
  evidenceReferences: [{
    filePath: { type: String, required: true, maxlength: 500 },
    lineStart: { type: Number, min: 1, required: true },
    lineEnd: { type: Number, min: 1, required: true },
    excerpt: { type: String, maxlength: 1000, default: "" },
  }],
  completionEligible: { type: Boolean, default: false },
  reviewedAt: { type: Date, default: Date.now },
  reviewLimitations: [{ type: String, maxlength: 500 }],
  notificationStatus: { type: String, enum: ["QUEUED", "SENT", "FAILED", "NOT_REQUIRED"], default: "QUEUED" },
  supersededBy: { type: Schema.Types.ObjectId, ref: "Review", default: null },
  result: { type: String, enum: ["APPROVED", "REVISION_REQUIRED", "IN_REVIEW"], required: true },
}, options);
reviewSchema.index({ submissionId: 1, reviewVersion: 1 }, { unique: true });

const meetingSchema = new Schema({
  assignmentId: { type: Schema.Types.ObjectId, ref: "Assignment", required: true, index: true },
  meetingType: { type: String, enum: ["EXPLANATION", "REVIEW", "TASK_EXPLANATION", "FIRST_REVIEW", "DOUBT_CLARIFICATION"], required: true },
  requestId: { type: Schema.Types.ObjectId, ref: "MeetingRequest", default: null },
  scheduledAt: { type: Date, required: true },
  durationMinutes: { type: Number, min: 5, max: 480, required: true },
  meetingUrl: { type: String, trim: true, maxlength: 2048, default: "" },
  meetingProvider: { type: String, enum: ["GOOGLE_CALENDAR", "INTERNAL"], default: "GOOGLE_CALENDAR" },
  googleCalendarEventId: { type: String, trim: true, default: undefined },
  calendarId: { type: String, trim: true, default: "" },
  conferenceUrl: { type: String, trim: true, maxlength: 2048, default: "" },
  timezone: { type: String, trim: true, default: "UTC" },
  lastSyncedAt: { type: Date, default: null },
  status: { type: String, enum: ["PENDING", "SCHEDULED", "COMPLETED", "CANCELLED", "FAILED"], default: "PENDING" },
  agentConsentStatus: { type: String, enum: ["REQUIRED", "GRANTED", "REVOKED"], default: "REQUIRED" },
  agentConsentAt: { type: Date, default: null },
  agentConsentPolicyVersion: { type: String, trim: true, maxlength: 40, default: "" },
  agentProvider: { type: String, enum: ["DISABLED", "RECALL"], default: "DISABLED" },
  agentStatus: {
    type: String,
    enum: ["NOT_REQUESTED", "CONSENT_REQUIRED", "REQUESTED", "SCHEDULED", "CONNECTING", "IN_MEETING", "COMPLETED", "NO_SHOW", "FAILED", "PROVIDER_PENDING", "CANCELLED"],
    default: "NOT_REQUESTED",
  },
  agentProviderSessionId: { type: String, trim: true, maxlength: 160, default: "" },
  agentRequestedAt: { type: Date, default: null },
  agentStartedAt: { type: Date, default: null },
  agentEndedAt: { type: Date, default: null },
  agentSummary: { type: String, trim: true, maxlength: 4000, default: "" },
  agentLastError: { type: String, trim: true, maxlength: 500, default: "" },
  agentRecordingEnabled: { type: Boolean, default: false },
  agentEventIds: { type: [String], default: [] },
  agentLastUtteranceSeq: { type: Number, min: 0, default: 0 },
  agentSpeakingUntil: { type: Date, default: null },
  agentGreetedAt: { type: Date, default: null },
  feedbackStatus: { type: String, enum: ["NONE", "PENDING", "SENT", "FAILED"], default: "NONE" },
  feedbackSentAt: { type: Date, default: null },
  feedbackError: { type: String, trim: true, maxlength: 500, default: "" },
}, options);
meetingSchema.index({ assignmentId: 1, meetingType: 1, requestId: 1 }, { unique: true });
meetingSchema.index({ googleCalendarEventId: 1 }, { sparse: true });

const meetingRequestSchema = new Schema({
  assignmentId: { type: Schema.Types.ObjectId, ref: "Assignment", required: true, index: true },
  internId: { type: Schema.Types.ObjectId, ref: "Intern", required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  topic: { type: String, required: true, trim: true, maxlength: 1500 },
  proposedTimes: [{ type: Date }],
  consentAt: { type: Date, required: true },
  consentPolicyVersion: { type: String, required: true, maxlength: 60 },
  status: { type: String, enum: ["PENDING", "APPROVED", "DECLINED", "CANCELLED"], default: "PENDING" },
  adminNote: { type: String, trim: true, maxlength: 1000, default: "" },
  decidedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  decidedAt: { type: Date, default: null },
  meetingId: { type: Schema.Types.ObjectId, ref: "Meeting", default: null },
}, options);
meetingRequestSchema.index({ status: 1, createdAt: -1 });
meetingRequestSchema.index({ assignmentId: 1, status: 1 });

const meetingTurnSchema = new Schema({
  meetingId: { type: Schema.Types.ObjectId, ref: "Meeting", required: true, index: true },
  seq: { type: Number, required: true },
  speaker: { type: String, enum: ["INTERN", "MENTOR", "OTHER"], required: true },
  speakerName: { type: String, trim: true, maxlength: 120, default: "" },
  text: { type: String, required: true, trim: true, maxlength: 4000 },
  at: { type: Date, default: Date.now },
}, { versionKey: false });
meetingTurnSchema.index({ meetingId: 1, seq: 1 }, { unique: true });

const emailLogSchema = new Schema({
  recipient: { type: String, required: true, lowercase: true, trim: true },
  templateType: { type: String, required: true, trim: true },
  relatedAssignmentId: { type: Schema.Types.ObjectId, ref: "Assignment", default: null },
  status: { type: String, enum: ["PENDING", "ACCEPTED", "DELIVERED", "BOUNCED", "SENT", "FAILED"], default: "PENDING" },
  sentAt: { type: Date, default: null },
  providerMessageId: { type: String, trim: true, default: "" },
  idempotencyKey: { type: String, trim: true, default: undefined },
  attemptCount: { type: Number, min: 0, default: 0 },
  lastAttemptAt: { type: Date, default: null },
  deliveredAt: { type: Date, default: null },
  lastError: { type: String, maxlength: 500, default: "" },
  errorMessage: { type: String, maxlength: 500, default: "" },
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false });
emailLogSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

const explanationSchema = new Schema({
  overview: { type: String, required: true, maxlength: 3000 },
  problemStatement: { type: String, required: true, maxlength: 3000 },
  whyItMatters: { type: String, required: true, maxlength: 2000 },
  functionalRequirements: [{ type: String, maxlength: 1000 }],
  technicalRequirements: [{ type: String, maxlength: 1000 }],
  expectedDeliverables: [{ type: String, maxlength: 1000 }],
  implementationGuidance: [{ type: String, maxlength: 1500 }],
  suggestedApproach: [{ type: String, maxlength: 1500 }],
  toolsAndTechnologies: [{ type: String, maxlength: 300 }],
  acceptanceCriteria: [{ type: String, maxlength: 1000 }],
  commonMistakes: [{ type: String, maxlength: 1000 }],
  clarificationQuestions: [{ type: String, maxlength: 500 }],
}, { _id: false });

const taskExplanationSchema = new Schema({
  assignmentId: { type: Schema.Types.ObjectId, ref: "Assignment", required: true, index: true },
  taskId: { type: Schema.Types.ObjectId, ref: "Task", required: true, index: true },
  taskFingerprint: { type: String, required: true, index: true },
  version: { type: Number, required: true, min: 1 },
  content: { type: explanationSchema, required: true },
  modelIdentifier: { type: String, required: true, maxlength: 120 },
  generationStatus: { type: String, enum: ["COMPLETED", "FAILED"], required: true },
  generatedAt: { type: Date, default: Date.now },
}, options);
taskExplanationSchema.index({ assignmentId: 1, taskFingerprint: 1 }, { unique: true });

const mentorConversationSchema = new Schema({
  assignmentId: { type: Schema.Types.ObjectId, ref: "Assignment", required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  messages: [{
    role: { type: String, enum: ["USER", "ASSISTANT"], required: true },
    content: { type: String, required: true, maxlength: 4000 },
    createdAt: { type: Date, default: Date.now },
    sessionId: { type: String, trim: true, maxlength: 64, default: "" },
    eventId: { type: String, trim: true, maxlength: 100, default: "" },
  }],
  updatedAt: { type: Date, default: Date.now },
  rateLimitWindowStart: { type: Date, default: null },
  requestCount: { type: Number, min: 0, default: 0 },
}, { versionKey: false });
mentorConversationSchema.index({ assignmentId: 1, userId: 1 }, { unique: true });

const mentorSessionSchema = new Schema({
  assignmentId: { type: Schema.Types.ObjectId, ref: "Assignment", required: true, index: true },
  internId: { type: Schema.Types.ObjectId, ref: "Intern", required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  status: { type: String, enum: ["ACTIVE", "COMPLETED"], default: "ACTIVE" },
  consentAt: { type: Date, required: true },
  consentPolicyVersion: { type: String, required: true, maxlength: 40 },
  startedAt: { type: Date, required: true },
  endedAt: { type: Date, default: null },
  summary: { type: String, trim: true, maxlength: 4000, default: "" },
  recordingEnabled: { type: Boolean, default: false },
  feedbackEmailStatus: { type: String, enum: ["PENDING", "SENT", "FAILED"], default: "PENDING" },
  feedbackEmailSentAt: { type: Date, default: null },
  nextMeetingId: { type: Schema.Types.ObjectId, ref: "Meeting", default: null },
}, options);
mentorSessionSchema.index(
  { assignmentId: 1, userId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "ACTIVE" } },
);
mentorSessionSchema.index({ assignmentId: 1, userId: 1, startedAt: -1 });
mentorSessionSchema.index({ status: 1, startedAt: -1 });

const automationRunSchema = new Schema({
  assignmentId: { type: Schema.Types.ObjectId, ref: "Assignment", required: true, unique: true },
  workflowId: { type: String, required: true, unique: true },
  eventId: { type: String, required: true, unique: true },
  status: { type: String, enum: ["PENDING", "PROCESSING", "COMPLETED", "FAILED"], default: "PENDING" },
  attemptCount: { type: Number, min: 0, default: 0 },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  lastError: { type: String, maxlength: 500, default: "" },
  steps: [{
    name: { type: String, required: true },
    status: { type: String, enum: ["PENDING", "PROCESSING", "COMPLETED", "FAILED"], default: "PENDING" },
    attemptCount: { type: Number, min: 0, default: 0 },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    lastError: { type: String, maxlength: 500, default: "" },
  }],
}, options);
automationRunSchema.index({ status: 1, updatedAt: -1 });

export const User = models.User || mongoose.model("User", userSchema);
export const Intern = models.Intern || mongoose.model("Intern", internSchema);
export const Task = models.Task || mongoose.model("Task", taskSchema);
export const Assignment = models.Assignment || mongoose.model("Assignment", assignmentSchema);
export const Submission = models.Submission || mongoose.model("Submission", submissionSchema);
export const Review = models.Review || mongoose.model("Review", reviewSchema);
export const Meeting = models.Meeting || mongoose.model("Meeting", meetingSchema);
export const MeetingRequest = models.MeetingRequest || mongoose.model("MeetingRequest", meetingRequestSchema);
export const MeetingTurn = models.MeetingTurn || mongoose.model("MeetingTurn", meetingTurnSchema);
export const EmailLog = models.EmailLog || mongoose.model("EmailLog", emailLogSchema);
export const TaskExplanation = models.TaskExplanation || mongoose.model("TaskExplanation", taskExplanationSchema);
export const MentorConversation = models.MentorConversation || mongoose.model("MentorConversation", mentorConversationSchema);
export const MentorSession = models.MentorSession || mongoose.model("MentorSession", mentorSessionSchema);
export const AutomationRun = models.AutomationRun || mongoose.model("AutomationRun", automationRunSchema);
