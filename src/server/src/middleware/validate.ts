import type { NextFunction, Request, Response } from "express";
import { z, type ZodTypeAny } from "zod";
import { badRequest } from "../lib/errors.js";

interface Schemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/**
 * Parsed output replaces the raw input, so handlers only ever see values that
 * passed the schema.
 */
export function validate(schemas: Schemas) {
  const middleware = (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params);
      if (schemas.query) {
        Object.defineProperty(req, "query", {
          value: schemas.query.parse(req.query),
          writable: true,
          configurable: true,
        });
      }
      if (schemas.body) req.body = schemas.body.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof z.ZodError) {
        return next(badRequest("Validation failed.", fieldErrors(err)));
      }
      next(err);
    }
  };
  // Read by the OpenAPI generator, so the published spec uses the schemas actually enforced.
  return Object.assign(middleware, { schemas });
}

export const httpUrl = z
  .string()
  .trim()
  .refine((v) => /^https?:\/\/\S+\.\S+/.test(v), "Must be a full URL, including https://");
