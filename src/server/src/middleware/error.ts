import { Prisma } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { AppError } from "../lib/errors.js";

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: "not_found", message: "Route not found." } });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      res.status(409).json({
        error: {
          code: "conflict",
          message: "That value is already taken.",
          details: { target: err.meta?.target },
        },
      });
      return;
    }
    // P2023: a malformed id (not a UUID) reached a query. No row can have that id, so it is
    // the same answer as an id that does not exist.
    if (err.code === "P2025" || err.code === "P2023") {
      res.status(404).json({ error: { code: "not_found", message: "Not found." } });
      return;
    }
  }

  // body-parser: malformed JSON (400) or a body over the route's limit (413) is the client's error.
  const parser = err as { type?: string; status?: number };
  if (typeof parser.status === "number" && parser.status >= 400 && parser.status < 500 && parser.type) {
    const tooLarge = parser.type === "entity.too.large";
    res.status(parser.status).json({
      error: {
        code: tooLarge ? "payload_too_large" : "bad_request",
        message: tooLarge ? "That request body is too large." : "The request body could not be read.",
      },
    });
    return;
  }

  console.error("[error]", err);
  res.status(500).json({
    error: {
      code: "internal_error",
      message: "Something went wrong.",
      ...(config.isProduction ? {} : { detail: String(err) }),
    },
  });
}
