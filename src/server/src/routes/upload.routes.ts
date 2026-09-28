import { createHash } from "node:crypto";
import express, { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import { badRequest, notFound, tooManyRequests } from "../lib/errors.js";
import { currentUser, requireAuth } from "../middleware/auth.js";
import { writeRateLimit } from "../middleware/rate-limit.js";
import { validate } from "../middleware/validate.js";
import { findEventByIdOrSlug } from "../services/authorization.service.js";

const router: Router = Router();

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const DAILY_BYTES_PER_USER = 50 * 1024 * 1024;

/** Raster formats only, recognised by their first bytes. SVG is refused: it can carry script. */
export function sniffImage(data: Buffer): string | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 6 && ["GIF87a", "GIF89a"].includes(data.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

export const uploadUrl = (id: string) => `${config.PUBLIC_API_URL.replace(/\/$/, "")}/api/uploads/${id}`;

router.post(
  "/",
  requireAuth,
  writeRateLimit,
  express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
  validate({ query: z.object({ event: z.string().trim().max(120).optional() }) }),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (data.length === 0) throw badRequest("Send the image as the request body.");
    const contentType = sniffImage(data);
    if (!contentType) throw badRequest("Upload a PNG, JPEG, GIF or WebP image.");

    let eventId: string | null = null;
    if (req.query.event) {
      const event = await findEventByIdOrSlug(req.query.event as string);
      const member =
        event && (event.ownerId === user.id || (await prisma.eventMembership.count({ where: { eventId: event.id, userId: user.id } })) > 0);
      if (!event || !member) throw notFound("Event not found.");
      eventId = event.id;
    }

    const today = await prisma.upload.aggregate({
      where: { ownerId: user.id, createdAt: { gte: new Date(Date.now() - 86_400_000) } },
      _sum: { size: true },
    });
    if ((today._sum.size ?? 0) + data.length > DAILY_BYTES_PER_USER) {
      throw tooManyRequests("You have uploaded 50 MB in the last day. Try again tomorrow.");
    }

    const upload = await prisma.upload.create({
      data: {
        ownerId: user.id,
        eventId,
        contentType,
        size: data.length,
        sha256: createHash("sha256").update(data).digest("hex"),
        data: new Uint8Array(data),
      },
      select: { id: true, contentType: true, size: true, sha256: true },
    });
    res.status(201).json({ ...upload, url: uploadUrl(upload.id) });
  }),
);

router.get(
  "/:uploadId",
  validate({ params: z.object({ uploadId: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const upload = await prisma.upload.findUnique({
      where: { id: req.params.uploadId as string },
      select: { contentType: true, data: true, sha256: true },
    });
    if (!upload) throw notFound("Upload not found.");
    res.set({
      "Content-Type": upload.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: `"${upload.sha256}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": "inline",
    });
    res.send(Buffer.from(upload.data));
  }),
);

export default router;
