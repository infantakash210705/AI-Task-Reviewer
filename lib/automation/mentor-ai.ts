import { geminiClient, geminiModel, type TaskContext } from "@/lib/automation/explanation";
import {
  buildMentorSystemPrompt,
  identityReply,
  isIdentityQuestion,
  mentorLanguage,
  toPlainChatText,
  toSpokenText,
  type MentorLanguage,
  type MentorMode,
} from "@/lib/automation/mentor-persona";

export type MentorMessage = { role: "USER" | "ASSISTANT"; content: string };
export type MentorAnswerInput = {
  task: TaskContext;
  explanation: unknown;
  priorMessages: MentorMessage[];
  question: string;
  mode?: MentorMode;
  language?: MentorLanguage;
  internName?: string;
  extraContext?: string;
};

export class MentorAiError extends Error {
  constructor(message: string, readonly statusCode: number = 503) {
    super(message);
    this.name = "MentorAiError";
  }
}

function mentorInstructions(input: MentorAnswerInput): string {
  return buildMentorSystemPrompt({
    taskJson: JSON.stringify(input.task),
    explanationJson: JSON.stringify(input.explanation || "Not generated yet. Answer from the saved task brief only."),
    mode: input.mode || "chat",
    language: input.language || mentorLanguage(),
    internName: input.internName,
    extraContext: input.extraContext,
  });
}

function providerFailureMessage(error: unknown): string {
  const status = typeof error === "object" && error !== null && "status" in error ? Number(error.status) : 0;
  if (status === 429) return "Your mentor is getting a lot of requests right now. Wait a moment and try again.";
  if (status === 404) return "The configured AI model is unavailable. Check the server-side model setting.";
  if (status === 504 || status >= 500) return "The mentor service is a bit slow right now. Please try again shortly.";
  return "Your mentor is unavailable at the moment. Please try again shortly, or contact your admin if it keeps happening.";
}

async function askOllama(input: MentorAnswerInput): Promise<string> {
  const baseUrl = process.env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434";
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw new MentorAiError("OLLAMA_BASE_URL must be a valid server-side URL.", 503);
  }
  if (!["http:", "https:"].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
    throw new MentorAiError("OLLAMA_BASE_URL must use HTTP or HTTPS and must not include credentials.", 503);
  }

  const timeoutValue = process.env.OLLAMA_TIMEOUT_MS?.trim();
  const timeoutMs = timeoutValue ? Number(timeoutValue) : 120_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 15_000 || timeoutMs > 180_000) {
    throw new MentorAiError("OLLAMA_TIMEOUT_MS must be between 15000 and 180000 milliseconds.", 503);
  }
  // For live voice calls in Google Meet, cap timeout to 15s so the bot responds snappy
  const effectiveTimeoutMs = input.mode === "spoken" ? Math.min(timeoutMs, 15_000) : timeoutMs;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), effectiveTimeoutMs);
  try {
    const response = await fetch(new URL("/api/chat", parsedUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: process.env.OLLAMA_MODEL?.trim() || "qwen2.5:1.5b",
        keep_alive: "10m",
        stream: false,
        options: {
          num_ctx: input.mode === "spoken" ? 2048 : 4096,
          num_predict: input.mode === "spoken" ? 120 : 256,
          temperature: 0.7,
        },
        messages: [
          { role: "system", content: mentorInstructions(input) },
          ...input.priorMessages.map((message) => ({
            role: message.role === "ASSISTANT" ? "assistant" : "user",
            content: message.content,
          })),
          { role: "user", content: input.question },
        ],
      }),
    });
    if (!response.ok) {
      throw new MentorAiError(response.status === 404
        ? "The configured Ollama model is not installed. Pull the configured model and try again."
        : "The local Ollama server could not complete the mentor request.");
    }
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null || !("message" in result)
      || typeof result.message !== "object" || result.message === null
      || !("content" in result.message) || typeof result.message.content !== "string") {
      throw new MentorAiError("The local Ollama model returned an invalid response.");
    }
    const answer = result.message.content.trim();
    if (!answer || answer.length > 4000) throw new MentorAiError("The mentor returned an empty response. Please ask again.");
    return answer;
  } catch (error) {
    if (error instanceof MentorAiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new MentorAiError("The mentor took too long to respond. Try a shorter question.", 504);
    }
    throw new MentorAiError("The local Ollama server is unavailable. Start Ollama and make sure the configured model is installed.", 503);
  } finally {
    clearTimeout(timeout);
  }
}

async function askGemini(input: MentorAnswerInput): Promise<string> {
  try {
    const response = await geminiClient().models.generateContent({
      model: geminiModel(),
      contents: [
        ...input.priorMessages.map((message) => ({
          role: message.role === "ASSISTANT" ? "model" : "user",
          parts: [{ text: message.content }],
        })),
        { role: "user", parts: [{ text: input.question }] },
      ],
      config: {
        systemInstruction: mentorInstructions(input),
        temperature: 0.7,
        maxOutputTokens: input.mode === "spoken" ? 220 : 600,
        httpOptions: { timeout: 30_000 },
      },
    });
    const answer = response.text?.trim();
    if (!answer || answer.length > 4000) throw new MentorAiError("The mentor returned an empty response. Please ask again.");
    return answer;
  } catch (error) {
    if (error instanceof MentorAiError) throw error;
    throw new MentorAiError(providerFailureMessage(error), Number(
      typeof error === "object" && error !== null && "status" in error ? error.status : 503,
    ));
  }
}

export async function generateMentorAnswer(input: MentorAnswerInput): Promise<string> {
  // Sincere "are you an AI / a person?" questions always get an honest, short, deterministic answer.
  if (isIdentityQuestion(input.question)) return identityReply(input.language || mentorLanguage());

  const provider = process.env.MENTOR_AI_PROVIDER?.trim().toLowerCase() || "auto";
  if (!["ollama", "gemini", "auto"].includes(provider)) {
    throw new MentorAiError("MENTOR_AI_PROVIDER must be ollama, gemini, or auto.", 503);
  }
  let answer: string;
  if (provider === "gemini") {
    answer = await askGemini(input);
  } else if (provider === "ollama") {
    answer = await askOllama(input);
  } else {
    // auto mode: try Ollama first; if unavailable, immediately fall back to Gemini so calls never fail
    try {
      answer = await askOllama(input);
    } catch {
      answer = await askGemini(input);
    }
  }
  return input.mode === "spoken" ? toSpokenText(answer) : toPlainChatText(answer);
}
