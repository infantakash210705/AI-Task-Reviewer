/**
 * Meetings are request-and-approve by default: an intern asks for a clarification
 * meeting and the admin approves it. Set AUTO_SCHEDULE_MEETINGS=true to restore the
 * legacy behaviour of auto-creating an explanation meeting and review meetings.
 */
export function autoScheduleMeetings(): boolean {
  return process.env.AUTO_SCHEDULE_MEETINGS?.trim().toLowerCase() === "true";
}
