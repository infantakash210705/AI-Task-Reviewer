import { afterEach, describe, expect, it, vi } from "vitest";
import { generateMentorAnswer, MentorAiError } from "@/lib/automation/mentor-ai";

const previousProvider = process.env.MENTOR_AI_PROVIDER;
const previousBaseUrl = process.env.OLLAMA_BASE_URL;
const previousModel = process.env.OLLAMA_MODEL;
const previousTimeout = process.env.OLLAMA_TIMEOUT_MS;

afterEach(() => {
  vi.unstubAllGlobals();
  if (previousProvider === undefined) delete process.env.MENTOR_AI_PROVIDER;
  else process.env.MENTOR_AI_PROVIDER = previousProvider;
  if (previousBaseUrl === undefined) delete process.env.OLLAMA_BASE_URL;
  else process.env.OLLAMA_BASE_URL = previousBaseUrl;
  if (previousModel === undefined) delete process.env.OLLAMA_MODEL;
  else process.env.OLLAMA_MODEL = previousModel;
  if (previousTimeout === undefined) delete process.env.OLLAMA_TIMEOUT_MS;
  else process.env.OLLAMA_TIMEOUT_MS = previousTimeout;
});

const input = {
  task: {
    title: "Build a task page",
    shortDescription: "Show assigned work.",
    fullDescription: "Build the assigned task page.",
    difficulty: "BEGINNER",
    requiredSkills: [],
    requirements: ["Show the task title"],
    acceptanceCriteria: ["Title is visible"],
    expectedDeliverables: ["Task page"],
  },
  explanation: null,
  priorMessages: [{ role: "USER" as const, content: "Where do I start?" }],
  question: "How do I show the title?",
};

describe("local Ollama mentor provider", () => {
  it("sends task-scoped conversation to the configured local model", async () => {
    process.env.MENTOR_AI_PROVIDER = "ollama";
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434";
    process.env.OLLAMA_MODEL = "qwen2.5:3b";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      message: { content: "Use the saved task title in your page." },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateMentorAnswer(input)).resolves.toBe("Use the saved task title in your page.");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe("http://127.0.0.1:11434/api/chat");
    const body = JSON.parse(String(options.body));
    expect(body.model).toBe("qwen2.5:3b");
    expect(body.stream).toBe(false);
    expect(body.keep_alive).toBe("10m");
    expect(body.options).toEqual({ num_ctx: 4096, num_predict: 256, temperature: 0.7 });
    expect(body.messages.at(-1)).toEqual({ role: "user", content: input.question });
    expect(body.messages[0].content).toContain("never claim to be a human".replace("never","Never"));
    expect(body.messages[0].content).toContain("Never use headings, bullet points");
  });

  it("answers a sincere identity question honestly without calling the model", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const answer = await generateMentorAnswer({ ...input, question: "Wait, are you an AI or a real person?" });
    expect(answer).toMatch(/AI/);
    expect(answer).not.toMatch(/I'm a human|I am a human|real person, yes/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("strips markdown and returns spoken-friendly text in spoken mode", async () => {
    process.env.MENTOR_AI_PROVIDER = "ollama";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      message: { content: "### Steps\n- **Create** the route\n- Add `title`\nSee https://example.com" },
    }), { status: 200 })));
    const answer = await generateMentorAnswer({ ...input, mode: "spoken" });
    expect(answer).not.toMatch(/[#*`]/);
    expect(answer).not.toContain("https://");
  });

  it("rejects an invalid Ollama timeout before making a request", async () => {
    process.env.MENTOR_AI_PROVIDER = "ollama";
    process.env.OLLAMA_TIMEOUT_MS = "5000";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(generateMentorAnswer(input)).rejects.toMatchObject({
      message: "OLLAMA_TIMEOUT_MS must be between 15000 and 180000 milliseconds.",
      statusCode: 503,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports missing Ollama model without exposing raw provider details", async () => {
    process.env.MENTOR_AI_PROVIDER = "ollama";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private provider details", { status: 404 })));
    await expect(generateMentorAnswer(input)).rejects.toMatchObject({
      name: "MentorAiError",
      message: "The configured Ollama model is not installed. Pull the configured model and try again.",
      statusCode: 503,
    } satisfies Partial<MentorAiError>);
  });

  it("rejects credentials embedded in the Ollama URL", async () => {
    process.env.MENTOR_AI_PROVIDER = "ollama";
    process.env.OLLAMA_BASE_URL = "http://user:password@127.0.0.1:11434";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(generateMentorAnswer(input)).rejects.toThrow("OLLAMA_BASE_URL must use HTTP or HTTPS and must not include credentials.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
