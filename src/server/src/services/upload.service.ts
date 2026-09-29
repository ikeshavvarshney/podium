import { prisma } from "../db.js";

const UPLOAD_ID = /\/api\/uploads\/([0-9a-f-]{36})$/i;
const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;

/** Ties images uploaded before their event existed to that event, so they are exported and deleted with it. */
export async function claimUploads(ownerId: string, eventId: string, urls: Array<string | null | undefined>) {
  const ids = urls.map((u) => (u ? UPLOAD_ID.exec(u)?.[1] : undefined)).filter((id): id is string => Boolean(id));
  if (ids.length === 0) return;
  await prisma.upload.updateMany({ where: { id: { in: ids }, ownerId, eventId: null }, data: { eventId } });
}

export async function pruneOrphanUploads(now = Date.now()): Promise<number> {
  const { count } = await prisma.upload.deleteMany({
    where: { eventId: null, createdAt: { lt: new Date(now - ORPHAN_AGE_MS) } },
  });
  return count;
}

export function startUploadPruner(intervalMs = 60 * 60 * 1000): () => void {
  const timer = setInterval(() => {
    pruneOrphanUploads().catch((err) => console.error("[uploads] prune", err));
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
