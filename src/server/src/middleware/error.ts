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
    if (err.code === "P2025") {
      res.status(404).json({ error: { code: "not_found", message: "Not found." } });
      return;
    }
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
