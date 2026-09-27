import type { NextFunction, Request, RequestHandler, Response } from "express";

/** Express 4 does not forward rejected promises to the error middleware. */
export function asyncHandler<T extends RequestHandler>(fn: T): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    void Promise.resolve(fn(req, res, next)).catch(next);
  };
}
