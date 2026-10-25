import type { ErrorRequestHandler, RequestHandler } from "express";
import multer from "multer";
import type { Logger } from "pino";
import { ZodError, type z } from "zod";
import type { ApiError } from "./contracts/schemas.js";

export type ErrorCode = z.infer<typeof ApiError>["error"]["code"];

/** Any error with a status and an ApiError code; rendered as { error: { code, message, details? } }. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const notFound = (message: string): HttpError => new HttpError(404, "NOT_FOUND", message);
export const conflict = (message: string, details?: unknown): HttpError => new HttpError(409, "CONFLICT", message, details);
export const badRequest = (message: string, details?: unknown): HttpError => new HttpError(400, "VALIDATION_FAILED", message, details);

const body = (code: ErrorCode, message: string, details?: unknown) => ({
  error: details === undefined ? { code, message } : { code, message, details },
});

export const unknownRoute: RequestHandler = (req, res) => {
  res.status(404).json(body("NOT_FOUND", `No route for ${req.method} ${req.path}`));
};

export function errorHandler(logger: Pick<Logger, "error">): ErrorRequestHandler {
  return (err: unknown, _req, res, _next) => {
    if (err instanceof HttpError) {
      res.status(err.status).json(body(err.code, err.message, err.details));
    } else if (err instanceof ZodError) {
      res.status(400).json(body("VALIDATION_FAILED", "Request failed validation", err.issues));
    } else if (err instanceof multer.MulterError) {
      res.status(400).json(body("VALIDATION_FAILED", `Upload rejected: ${err.message}`, { field: err.field }));
    } else if (err instanceof SyntaxError && "body" in err) {
      res.status(400).json(body("VALIDATION_FAILED", "Malformed JSON body"));
    } else {
      logger.error({ err }, "unhandled error");
      res.status(500).json(body("INTERNAL", "Internal server error"));
    }
  };
}
