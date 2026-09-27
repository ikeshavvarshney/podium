import { EventRole } from "@prisma/client";
import { prisma } from "../db.js";
import { badRequest } from "../lib/errors.js";
import { AuditAction, recordAudit } from "./audit.service.js";
import type { EventContext } from "./authorization.service.js";

export interface ImportResult {
  granted: string[];
  alreadyHeld: string[];
  unknown: string[];
  invalid: string[];
}

const EMAIL = /^[^\s@,;"]+@[^\s@,;"]+\.[^\s@,;"]+$/;

/**
 * Pulls email addresses out of CSV text. Accepts a bare list, one per line, or
 * a CSV with an `email` column; anything else in the row is ignored.
 */
export function parseEmails(csv: string): { emails: string[]; invalid: string[] } {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return { emails: [], invalid: [] };

  const header = lines[0]!.toLowerCase().split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  const emailColumn = header.indexOf("email");
  const rows = emailColumn >= 0 ? lines.slice(1) : lines;

  const emails = new Set<string>();
  const invalid: string[] = [];
  for (const row of rows) {
    const cells = row.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const value = (emailColumn >= 0 ? cells[emailColumn] : cells[0])?.toLowerCase() ?? "";
    if (!value) continue;
    if (EMAIL.test(value)) emails.add(value);
    else invalid.push(value);
  }
  return { emails: [...emails], invalid };
}

/**
 * Grants a role to every listed account that already exists. The platform
 * sends no email, so unknown addresses are reported rather than invited.
 */
export async function importRoster(
  ctx: EventContext,
  role: EventRole,
  csv: string,
  ipHash?: string,
): Promise<ImportResult> {
  const { emails, invalid } = parseEmails(csv);
  if (emails.length === 0 && invalid.length === 0) {
    throw badRequest("That file has no email addresses in it.");
  }
  if (emails.length > 1000) throw badRequest("Import at most 1,000 addresses at a time.");

  const users = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { id: true, email: true },
  });
  const byEmail = new Map(users.map((u) => [u.email, u.id]));

  const existing = await prisma.eventMembership.findMany({
    where: { eventId: ctx.event.id, role, userId: { in: users.map((u) => u.id) } },
    select: { userId: true },
  });
  const held = new Set(existing.map((m) => m.userId));

  const result: ImportResult = { granted: [], alreadyHeld: [], unknown: [], invalid };
  const toCreate: Array<{ userId: string; email: string }> = [];

  for (const email of emails) {
    const userId = byEmail.get(email);
    if (!userId) result.unknown.push(email);
    else if (held.has(userId)) result.alreadyHeld.push(email);
    else toCreate.push({ userId, email });
  }

  if (toCreate.length > 0) {
    await prisma.eventMembership.createMany({
      data: toCreate.map(({ userId }) => ({
        eventId: ctx.event.id,
        userId,
        role,
        invitedById: ctx.user?.id ?? null,
        acceptedAt: new Date(),
      })),
      skipDuplicates: true,
    });
    result.granted = toCreate.map((t) => t.email);
  }

  await recordAudit({
    action: AuditAction.BULK_IMPORT,
    eventId: ctx.event.id,
    actorId: ctx.user?.id ?? null,
    targetType: "event",
    targetId: ctx.event.id,
    summary: `Bulk ${role.toLowerCase()} import: ${result.granted.length} granted, ${result.unknown.length} unknown`,
    metadata: {
      role,
      granted: result.granted.length,
      alreadyHeld: result.alreadyHeld.length,
      unknown: result.unknown.length,
      invalid: result.invalid.length,
    },
    ipHash,
  });

  return result;
}
