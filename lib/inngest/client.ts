import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "shortfundly-internflow",
  eventKey: process.env.INNGEST_EVENT_KEY,
});
