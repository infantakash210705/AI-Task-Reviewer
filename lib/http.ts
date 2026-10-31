import { ZodError } from "zod";

export function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export function handleApiError(error: unknown, operation: string) {
  if (error instanceof ZodError) {
    return Response.json({ error: "Please check the submitted fields.", details: error.flatten().fieldErrors }, { status: 400 });
  }
  if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
    return jsonError("A record with one of these unique values already exists.", 409);
  }
  console.error(`[api:${operation}] request failed`);
  return jsonError("The request could not be completed. Please try again.", 500);
}
