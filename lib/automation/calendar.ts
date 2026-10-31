import { google, type calendar_v3 } from "googleapis";
import { Meeting } from "@/lib/models";

export type MeetingDetails = {
  assignmentId: string;
  internEmail: string;
  taskTitle: string;
  meetingType: "TASK_EXPLANATION" | "FIRST_REVIEW" | "DOUBT_CLARIFICATION";
  requestId?: string;
  scheduledAt: Date;
  durationMinutes: number;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function calendarClient() {
  const oauth = new google.auth.OAuth2(
    requiredEnv("GOOGLE_CALENDAR_CLIENT_ID"),
    requiredEnv("GOOGLE_CALENDAR_CLIENT_SECRET"),
  );
  oauth.setCredentials({ refresh_token: requiredEnv("GOOGLE_CALENDAR_REFRESH_TOKEN") });
  return google.calendar({ version: "v3", auth: oauth });
}

function calendarId(): string {
  return process.env.GOOGLE_CALENDAR_ID?.trim() || "primary";
}

function stableEventId(meeting: MeetingDetails): string {
  if (meeting.meetingType === "DOUBT_CLARIFICATION" && meeting.requestId) return `dq${meeting.requestId.toLowerCase()}`;
  const prefix = meeting.meetingType === "TASK_EXPLANATION" ? "te" : "fr";
  return `${prefix}${meeting.assignmentId.toLowerCase()}`;
}

export function confirmedMeetUrl(value?: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed.startsWith("http://")) return undefined;
  const normalized = /^https:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(normalized);
    if (url.protocol !== "https:" || url.hostname !== "meet.google.com" || url.pathname === "/" || url.username || url.password) return undefined;
    return url.origin + url.pathname;
  } catch {
    return undefined;
  }
}

function meetUrl(event: calendar_v3.Schema$Event): string | undefined {
  const url = event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video")?.uri;
  return confirmedMeetUrl(url);
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 404;
}

export async function ensureCalendarMeeting(details: MeetingDetails): Promise<{
  eventId: string;
  calendarId: string;
  conferenceUrl: string;
}> {
  const calendar = calendarClient();
  const calendarIdValue = calendarId();
  const eventId = stableEventId(details);
  let event: calendar_v3.Schema$Event | undefined;

  try {
    const existing = await calendar.events.get({ calendarId: calendarIdValue, eventId });
    event = existing.data;
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }

  const timezone = process.env.DEFAULT_TIMEZONE?.trim() || "UTC";
  const endAt = new Date(details.scheduledAt.getTime() + details.durationMinutes * 60_000);
  const requestedEnd = endAt.toISOString();
  if (!event) {
    const inserted = await calendar.events.insert({
      calendarId: calendarIdValue,
      conferenceDataVersion: 1,
      requestBody: {
        id: eventId,
        summary: `${details.meetingType === "TASK_EXPLANATION" ? "Task explanation" : details.meetingType === "DOUBT_CLARIFICATION" ? "Task clarification" : "First review"}: ${details.taskTitle}`,
        description: "Shortfundly InternFlow mentor session.",
        start: { dateTime: details.scheduledAt.toISOString(), timeZone: timezone },
        end: { dateTime: requestedEnd, timeZone: timezone },
        attendees: [{ email: details.internEmail }],
        conferenceData: {
          createRequest: {
            requestId: eventId,
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      },
    });
    event = inserted.data;
  } else if (
    new Date(event.start?.dateTime || event.start?.date || 0).getTime() !== details.scheduledAt.getTime()
    || new Date(event.end?.dateTime || event.end?.date || 0).getTime() !== endAt.getTime()
  ) {
    const updated = await calendar.events.patch({
      calendarId: calendarIdValue,
      eventId,
      conferenceDataVersion: 1,
      requestBody: {
        start: { dateTime: details.scheduledAt.toISOString(), timeZone: timezone },
        end: { dateTime: requestedEnd, timeZone: timezone },
      },
    });
    event = updated.data;
  }

  let url = meetUrl(event);
  for (let attempt = 0; !url && attempt < 5; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const refreshed = await calendar.events.get({ calendarId: calendarIdValue, eventId });
    event = refreshed.data;
    url = meetUrl(event);
  }
  if (!url) throw new Error("Google Calendar did not confirm a Google Meet video link.");

  await Meeting.findOneAndUpdate(
    { assignmentId: details.assignmentId, meetingType: details.meetingType, requestId: details.requestId || null },
    {
      $set: {
        scheduledAt: details.scheduledAt,
        durationMinutes: details.durationMinutes,
        meetingUrl: url,
        meetingProvider: "GOOGLE_CALENDAR",
        conferenceUrl: url,
        googleCalendarEventId: eventId,
        calendarId: calendarIdValue,
        timezone: process.env.DEFAULT_TIMEZONE?.trim() || "UTC",
        status: "SCHEDULED",
        lastSyncedAt: new Date(),
      },
      $setOnInsert: { assignmentId: details.assignmentId, meetingType: details.meetingType, requestId: details.requestId || null },
    },
    { upsert: true, new: true, runValidators: true },
  );
  return { eventId, calendarId: calendarIdValue, conferenceUrl: url };
}

export async function ensureInternalMeeting(details: MeetingDetails): Promise<{ eventId: string; calendarId: string; conferenceUrl: string }> {
  const originValue = process.env.APP_BASE_URL?.trim() || process.env.NEXTAUTH_URL?.trim();
  if (!originValue) throw new Error("APP_BASE_URL is not configured for internal meeting rooms.");
  const origin = new URL(originValue);
  if (!["http:", "https:"].includes(origin.protocol)) throw new Error("APP_BASE_URL must use HTTP or HTTPS.");
  const roomUrl = new URL(`/intern/tasks/${encodeURIComponent(details.assignmentId)}/mentor`, origin).toString();
  const timezone = process.env.DEFAULT_TIMEZONE?.trim() || "UTC";
  const existing = await Meeting.findOne({
    assignmentId: details.assignmentId,
    meetingType: details.meetingType,
  }).select("_id meetingProvider googleCalendarEventId").lean();
  if (existing?.meetingProvider === "GOOGLE_CALENDAR" && existing.googleCalendarEventId) {
    await cancelCalendarMeeting(String(existing._id));
  }
  const meeting = await Meeting.findOneAndUpdate(
    { assignmentId: details.assignmentId, meetingType: details.meetingType },
    {
      $set: {
        scheduledAt: details.scheduledAt,
        durationMinutes: details.durationMinutes,
        meetingUrl: roomUrl,
        meetingProvider: "INTERNAL",
        conferenceUrl: "",
        calendarId: "",
        timezone,
        status: "SCHEDULED",
        lastSyncedAt: new Date(),
      },
      $unset: { googleCalendarEventId: "" },
      $setOnInsert: { assignmentId: details.assignmentId, meetingType: details.meetingType },
    },
    { upsert: true, new: true, runValidators: true },
  );
  return { eventId: String(meeting._id), calendarId: "", conferenceUrl: roomUrl };
}

export async function rescheduleCalendarMeeting(meetingId: string, scheduledAt: Date, durationMinutes: number): Promise<void> {
  const meeting = await Meeting.findById(meetingId).lean();
  if (meeting?.meetingProvider === "INTERNAL") {
    const originValue = process.env.APP_BASE_URL?.trim() || process.env.NEXTAUTH_URL?.trim();
    if (!originValue) throw new Error("APP_BASE_URL is not configured for internal meeting rooms.");
    const origin = new URL(originValue);
    const roomUrl = new URL(`/intern/tasks/${encodeURIComponent(String(meeting.assignmentId))}/mentor`, origin).toString();
    await Meeting.updateOne(
      { _id: meeting._id, meetingProvider: "INTERNAL" },
      { $set: { scheduledAt, durationMinutes, meetingUrl: roomUrl, lastSyncedAt: new Date() } },
    );
    return;
  }
  if (!meeting?.googleCalendarEventId || !meeting.calendarId || !meeting.conferenceUrl) {
    throw new Error("Cannot reschedule a meeting before its Google Calendar event and Meet link are confirmed.");
  }
  const timezone = meeting.timezone || process.env.DEFAULT_TIMEZONE?.trim() || "UTC";
  const updated = await calendarClient().events.patch({
    calendarId: meeting.calendarId,
    eventId: meeting.googleCalendarEventId,
    conferenceDataVersion: 1,
    requestBody: {
      start: { dateTime: scheduledAt.toISOString(), timeZone: timezone },
      end: { dateTime: new Date(scheduledAt.getTime() + durationMinutes * 60_000).toISOString(), timeZone: timezone },
    },
  });
  if (!meetUrl(updated.data)) throw new Error("Google Calendar did not return the confirmed Meet URL for the rescheduled event.");
}

export async function cancelCalendarMeeting(meetingId: string): Promise<void> {
  const meeting = await Meeting.findById(meetingId).lean();
  if (!meeting) throw new Error("Meeting record was not found.");
  if (meeting.googleCalendarEventId && meeting.calendarId) {
    try {
      await calendarClient().events.delete({ calendarId: meeting.calendarId, eventId: meeting.googleCalendarEventId });
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }
}
