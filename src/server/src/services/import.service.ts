import { EventRole, TeamRole } from "@prisma/client";
import { prisma } from "../db.js";
import { hashPassword, randomToken } from "../lib/crypto.js";
import { badRequest } from "../lib/errors.js";
import { AuditAction, recordAudit } from "./audit.service.js";
import type { EventContext } from "./authorization.service.js";

export interface RosterRow {
  email: string;
  name: string | null;
  team: string | null;
}

export interface ImportResult {
  /** Accounts that did not exist and were created by this import. */
  created: string[];
  granted: string[];
  alreadyHeld: string[];
  invalid: string[];
  teams: {
    created: string[];
    joined: Array<{ email: string; team: string }>;
    skipped: Array<{ email: string; team: string; reason: string }>;
  };
}

const EMAIL = /^[^\s@,;"]+@[^\s@,;"]+\.[^\s@,;"]+$/;
const MAX_ROWS = 1000;

/** Splits one CSV line, honouring double quotes around cells that contain commas. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += ch;
    }
  }
  cells.push(cell.trim());
  return cells;
}

/**
 * Reads a roster. Accepts a bare list of addresses, one per line, or a CSV with an
 * `email` column and optional `name` and `team` columns; other columns are ignored.
 * A repeated address keeps its first row.
 */
export function parseRoster(csv: string): { rows: RosterRow[]; invalid: string[] } {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return { rows: [], invalid: [] };

  const header = splitCsvLine(lines[0]!).map((c) => c.toLowerCase());
  const hasHeader = header.includes("email");
  const col = (name: string) => (hasHeader ? header.indexOf(name) : -1);
  const [emailAt, nameAt, teamAt] = [hasHeader ? col("email") : 0, col("name"), col("team")];

  const rows = new Map<string, RosterRow>();
  const invalid: string[] = [];
  for (const line of hasHeader ? lines.slice(1) : lines) {
    const cells = splitCsvLine(line);
    const email = (cells[emailAt] ?? "").toLowerCase();
    if (!email) continue;
    if (!EMAIL.test(email)) {
      invalid.push(email);
      continue;
    }
    if (rows.has(email)) continue;
    const cell = (at: number) => (at >= 0 && cells[at] ? cells[at]!.slice(0, 120) : null);
    rows.set(email, { email, name: cell(nameAt), team: cell(teamAt) });
  }
  return { rows: [...rows.values()], invalid };
}

/**
 * Bulk roster import. For every row: create the account if the address is new, grant the
 * role in this event, and for participants, place them on the named team (creating the
 * team if this event has none by that name).
 *
 * A created account gets a password nobody knows, so an organizer never holds anyone's
 * credentials: the person signs in with a sign-in link (`POST /auth/magic-link`). Team
 * placement follows the same rules as joining by hand: one team per person per event, and
 * never past the event's maximum team size.
 */
export async function importRoster(
  ctx: EventContext,
  role: EventRole,
  csv: string,
  ipHash?: string,
): Promise<ImportResult> {
  const { rows, invalid } = parseRoster(csv);
  if (rows.length === 0 && invalid.length === 0) {
    throw badRequest("That file has no email addresses in it.");
  }
  if (rows.length > MAX_ROWS) throw badRequest("Import at most 1,000 addresses at a time.");

  const emails = rows.map((r) => r.email);
  const known = await prisma.user.findMany({ where: { email: { in: emails } }, select: { email: true } });
  const knownEmails = new Set(known.map((u) => u.email));
  const newRows = rows.filter((r) => !knownEmails.has(r.email));

  if (newRows.length > 0) {
    // One unusable hash for the whole batch: its plaintext is discarded here.
    const passwordHash = await hashPassword(randomToken(32));
    await prisma.user.createMany({
      data: newRows.map((r) => ({
        email: r.email,
        name: r.name ?? r.email.split("@")[0]!,
        passwordHash,
      })),
      skipDuplicates: true,
    });
  }

  const users = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { id: true, email: true },
  });
  const idByEmail = new Map(users.map((u) => [u.email, u.id]));

  const held = new Set(
    (
      await prisma.eventMembership.findMany({
        where: { eventId: ctx.event.id, role, userId: { in: users.map((u) => u.id) } },
        select: { userId: true },
      })
    ).map((m) => m.userId),
  );

  const result: ImportResult = {
    created: newRows.map((r) => r.email),
    granted: [],
    alreadyHeld: [],
    invalid,
    teams: { created: [], joined: [], skipped: [] },
  };
  for (const row of rows) {
    (held.has(idByEmail.get(row.email)!) ? result.alreadyHeld : result.granted).push(row.email);
  }

  await prisma.eventMembership.createMany({
    data: result.granted.map((email) => ({
      eventId: ctx.event.id,
      userId: idByEmail.get(email)!,
      role,
      invitedById: ctx.user?.id ?? null,
      acceptedAt: new Date(),
    })),
    skipDuplicates: true,
  });

  if (role === EventRole.PARTICIPANT) {
    await placeOnTeams(ctx, rows, idByEmail, result);
  }

  await recordAudit({
    action: AuditAction.BULK_IMPORT,
    eventId: ctx.event.id,
    actorId: ctx.user?.id ?? null,
    targetType: "event",
    targetId: ctx.event.id,
    summary:
      `Bulk ${role.toLowerCase()} import: ${result.granted.length} granted, ` +
      `${result.created.length} accounts created, ${result.teams.created.length} teams created`,
    metadata: {
      role,
      created: result.created.length,
      granted: result.granted.length,
      alreadyHeld: result.alreadyHeld.length,
      invalid: result.invalid.length,
      teamsCreated: result.teams.created.length,
      teamPlacements: result.teams.joined.length,
      teamSkips: result.teams.skipped.length,
    },
    ipHash,
  });

  return result;
}

async function placeOnTeams(
  ctx: EventContext,
  rows: RosterRow[],
  idByEmail: Map<string, string>,
  result: ImportResult,
): Promise<void> {
  const wanted = rows.filter((r) => r.team);
  if (wanted.length === 0) return;

  await prisma.$transaction(async (tx) => {
    const current = await tx.teamMember.findMany({
      where: { team: { eventId: ctx.event.id }, userId: { in: wanted.map((r) => idByEmail.get(r.email)!) } },
      select: { userId: true, team: { select: { name: true } } },
    });
    const teamOf = new Map(current.map((m) => [m.userId, m.team.name]));

    const teams = await tx.team.findMany({
      where: { eventId: ctx.event.id, name: { in: [...new Set(wanted.map((r) => r.team!))] } },
      select: { id: true, name: true, _count: { select: { members: true } } },
    });
    const byName = new Map(teams.map((t) => [t.name, { id: t.id, size: t._count.members }]));

    for (const row of wanted) {
      const userId = idByEmail.get(row.email)!;
      const name = row.team!;
      const skip = (reason: string) => result.teams.skipped.push({ email: row.email, team: name, reason });

      const onTeam = teamOf.get(userId);
      if (onTeam) {
        skip(onTeam === name ? "already on this team" : `already on team "${onTeam}"`);
        continue;
      }

      const team = byName.get(name);
      if (!team) {
        const createdTeam = await tx.team.create({
          data: {
            eventId: ctx.event.id,
            name,
            members: { create: { userId, role: TeamRole.OWNER } },
          },
        });
        byName.set(name, { id: createdTeam.id, size: 1 });
        result.teams.created.push(name);
      } else if (team.size >= ctx.event.maxTeamSize) {
        skip(`team is full (maximum ${ctx.event.maxTeamSize})`);
        continue;
      } else {
        await tx.teamMember.create({ data: { teamId: team.id, userId, role: TeamRole.MEMBER } });
        team.size += 1;
      }
      teamOf.set(userId, name);
      result.teams.joined.push({ email: row.email, team: name });
    }
  });
}
