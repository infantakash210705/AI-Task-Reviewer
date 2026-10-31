# Shortfundly InternFlow

Internship and project management: admins assign tasks, a virtual mentor guides interns (chat, voice, and Google Meet), and submissions are reviewed from their GitHub repositories.

Stack: Next.js 15 (App Router), MongoDB/Mongoose, NextAuth (Google), Inngest workflows, Gemini and/or Ollama, Gmail SMTP, Google Calendar/Meet, Recall.ai.

## Quick start

```bash
npm install
cp .env.example .env.local      # fill in your own values; never commit .env.local
npm run dev                     # app on http://localhost:3000
npx inngest-cli@latest dev      # in a second terminal, for workflows
npm test                        # unit tests
npm run build                   # production build (use NODE_OPTIONS=--max-old-space-size=4096 on small machines)
```

Requirements: Node 20+, a MongoDB Atlas database, a Google OAuth client. The first sign-in by `ADMIN_EMAIL` becomes the administrator.

## How it works

**Admin**
- **Tasks**: create one task with the form, or use **Upload tasks in bulk** (CSV, JSON or Excel, up to 500 rows / 5 MB). Click *Check file* first to see problems per row. Demo files: `public/samples/tasks-sample.csv`, `.json`, `.xlsx` (also linked in the UI). In CSV/Excel, list columns (skills, requirements, criteria, deliverables) take one item per line or items separated by `|`.
- **Assignments**: assign a task to an intern. The intern gets an email and a mentor walkthrough is generated. No meeting is created automatically.
- **Meetings**: approve or decline intern meeting requests. Approving picks the time, creates the Google Calendar event with a Meet link, emails the intern, and schedules the mentor bot. Failed feedback emails can be re-sent from here.

**Intern**
- Works on the assigned task, asks the mentor in chat or by voice, and submits a GitHub repository link for automated review. When the task is reviewed as complete, the admin can assign the next one.
- If stuck, requests a **clarification meeting** on the task page (topic, optional preferred times, one session notice to accept). Nothing is scheduled until the admin approves.

**In the meeting**
- At the scheduled time the mentor joins the Google Meet as a participant named `<MENTOR_NAME> | Shortfundly Virtual Mentor`, greets the intern, listens through Recall's live transcript, and answers with a spoken voice. It knows the task, the intern's question, and the latest review findings, so it can explain what to change.
- After the call ends, the intern receives a feedback email: a short recap, what is going well, what needs to change, and next steps, based on the intern's latest public GitHub repository. Nothing is executed; the analysis reads the code only.

**The mentor** speaks like a warm colleague, stays on the task, and declines personal or unrelated questions. If someone sincerely asks whether they are talking to an AI, it says it is Shortfundly's virtual mentor and returns to the task. This is deliberate and not configurable.

## Setup details

### Mentor voice (free)
Server voice uses Microsoft Edge neural voices through the `msedge-tts` package: no API key or billing. It is an unofficial endpoint, so keep the browser-voice fallback in mind (the intern panel falls back automatically if the server voice fails). Defaults: `en-IN-PrabhatNeural`, `ta-IN-ValluvarNeural`, `hi-IN-MadhurNeural`. Change language with `MENTOR_LANGUAGE=en|ta|hi`.

### Google Calendar and Meet
Create an OAuth client with the Calendar scope, obtain a refresh token for the organiser account, and set `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REFRESH_TOKEN`. Meet links come from the Calendar event.

> The mentor joins like any outside participant. Unless the meeting allows open entry, the organiser must **admit the bot** from the waiting room when it appears (Recall waits 10 minutes).

### Recall.ai
1. Set `MEETING_AGENT_PROVIDER=RECALL`, `RECALL_API_KEY`, `RECALL_API_BASE_URL` (your region), and `MEETING_AGENT_PUBLIC_BASE_URL` (public HTTPS URL of this app; use a tunnel such as ngrok in development).
2. Set `MEETING_AGENT_PAGE_SECRET` to 32+ random characters (`openssl rand -hex 32`). It signs the per-meeting live-transcript URL that is sent to Recall automatically when the bot is created.
3. In the Recall dashboard, add a status webhook to `https://<your-host>/api/webhooks/meeting-agent` and copy its signing secret (`whsec_...`) into `MEETING_AGENT_WEBHOOK_SECRET`.
4. In the Recall dashboard, set the shortest media retention your plan allows. InternFlow stores transcript text only and never requests audio or video recordings.
5. Bots must be scheduled at least 10 minutes ahead; the admin approval form enforces 15.

Voice replies are posted to Recall's output-audio endpoint as MP3. The serverless route that handles live replies has `maxDuration = 60`; host on a platform that honours it (or a long-running Node server).

### Email, AI, GitHub, Inngest
See `.env.example` for every variable. Gmail needs an App Password. `GEMINI_API_KEY` (free tier is fine) powers reviews and mentor answers; Ollama can serve mentor answers locally via `MENTOR_AI_PROVIDER=ollama|auto`. Inngest keys are required in production; locally use the dev server.

### Legacy automatic meetings
`AUTO_SCHEDULE_MEETINGS=true` restores the old behaviour (auto-created explanation and review meetings). Default is `false`.

## Production checklist
- Rotate every secret that has ever been in a shared zip or repository.
- Set `NEXTAUTH_URL`, `APP_BASE_URL`, `MEETING_AGENT_PUBLIC_BASE_URL` to your HTTPS domain.
- Do not set `NODE_ENV=development`; `/api/test-email` is dev-only.
- Security headers are set in `next.config.mjs`.
- Run `npm audit` before deploying. At the time of the last check it reported advisories in `nodemailer` (via `next-auth`) and in a nested `zod` of `inngest`; upgrade those packages when compatible releases are available.

## What has and has not been tested
Unit tests cover the persona and honesty rule, speech cleaning, bulk parsing of all three formats, the transcript webhook parser, Recall bot payload and signed URL, feedback section building, and the existing automation. `npm run build` and the type-check pass. **Not tested against live services** (no network access during development): Edge TTS audio, Google Calendar/Meet, Recall bot join, transcript delivery and audio playback, and email delivery. Run one real test meeting before onboarding interns.

## Project progress
See `PROGRESS.md`.
