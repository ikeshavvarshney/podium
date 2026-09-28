import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { hashPassword, randomToken } from "../lib/crypto.js";
import { badRequest, conflict } from "../lib/errors.js";
import { groupKey } from "../algorithms/pairwise.js";
import { AuditAction, recordAudit, verifyAuditChain } from "./audit.service.js";
import { ballotDigest } from "./results.service.js";
import { slugify } from "./fixture-import.service.js";

/**
 * A portable copy of one event: every event-scoped table as plain rows, with people referenced by
 * email. Secrets (webhooks, invites, tokens, voter codes) are left out on purpose. Importing
 * remaps every id, so an event can move between instances or be cloned inside one.
 */
export const TRANSFER_FORMAT = 2;

type Row = Record<string, unknown>;

interface ModelSpec {
  model: Prisma.ModelName;
  /** How rows belong to the event: a direct eventId, or through a parent relation. */
  scope: { eventId: string } | { via: string };
}

/** Parents before children, so an import can insert in this order. */
const MODELS: ModelSpec[] = [
  { model: "Track", scope: { eventId: "" } },
  { model: "Round", scope: { eventId: "" } },
  { model: "FaqItem", scope: { eventId: "" } },
  { model: "EventPerson", scope: { eventId: "" } },
  { model: "Partner", scope: { eventId: "" } },
  { model: "Challenge", scope: { eventId: "" } },
  { model: "Prize", scope: { eventId: "" } },
  { model: "CustomQuestion", scope: { eventId: "" } },
  { model: "Rubric", scope: { eventId: "" } },
  { model: "RubricCriterion", scope: { via: "rubric" } },
  { model: "EventMembership", scope: { eventId: "" } },
  { model: "Registration", scope: { eventId: "" } },
  { model: "Team", scope: { eventId: "" } },
  { model: "TeamMember", scope: { via: "team" } },
  { model: "SeekerListing", scope: { eventId: "" } },
  { model: "JoinRequest", scope: { eventId: "" } },
  { model: "Upload", scope: { eventId: "" } },
  { model: "Submission", scope: { eventId: "" } },
  { model: "SubmissionImage", scope: { via: "submission" } },
  { model: "CustomAnswer", scope: { via: "submission" } },
  { model: "JudgeAssignment", scope: { eventId: "" } },
  { model: "JudgeScore", scope: { eventId: "" } },
  { model: "CriterionScore", scope: { via: "score" } },
  { model: "PairwiseRanking", scope: { eventId: "" } },
  { model: "NormalizationRun", scope: { eventId: "" } },
  { model: "NormalizedScore", scope: { via: "run" } },
  { model: "VotingConfig", scope: { eventId: "" } },
  { model: "Vote", scope: { eventId: "" } },
  { model: "Comment", scope: { eventId: "" } },
  { model: "EventUpdate", scope: { eventId: "" } },
  { model: "AuditLog", scope: { eventId: "" } },
];

/** Columns the database writes itself on insert. */
const GENERATED: Record<string, string[]> = { AuditLog: ["chainSeq", "prevHash", "hash"] };

const EVENT_OMIT = new Set(["id", "slug", "ownerId", "publishedRunId"]);

const delegate = (db: PrismaClient | Prisma.TransactionClient, model: string) =>
  (db as unknown as Record<string, { findMany(a: unknown): Promise<Row[]>; createMany(a: unknown): Promise<unknown> }>)[
    model.charAt(0).toLowerCase() + model.slice(1)
  ]!;

const modelMeta = (name: string) => Prisma.dmmf.datamodel.models.find((m) => m.name === name)!;

/** Scalar foreign keys of a model, with the model each points at. */
function foreignKeys(name: string): Map<string, string> {
  const keys = new Map<string, string>();
  for (const field of modelMeta(name).fields) {
    if (field.kind === "object" && field.relationFromFields?.length) {
      for (const fk of field.relationFromFields) keys.set(fk, field.type);
    }
  }
  return keys;
}

const bytesFields = (name: string) => new Set(modelMeta(name).fields.filter((f) => f.type === "Bytes").map((f) => f.name));

const jsonFields = (name: string) => new Set(modelMeta(name).fields.filter((f) => f.type === "Json").map((f) => f.name));

export interface EventTransfer {
  formatVersion: number;
  exportedAt: string;
  source: { eventId: string; slug: string; auditHead: string | null; auditIntact: boolean; ballotDigest: string };
  event: Row;
  people: Array<{ id: string; email: string; name: string; org: string | null; pronouns: string | null; bio: string | null; link: string | null }>;
  tables: Record<string, Row[]>;
}

export async function exportEvent(eventId: string): Promise<EventTransfer> {
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  const tables: Record<string, Row[]> = {};
  const userIds = new Set<string>([event.ownerId]);

  for (const spec of MODELS) {
    const where = "via" in spec.scope ? { [spec.scope.via]: { eventId } } : { eventId };
    const rows = await delegate(prisma, spec.model).findMany({ where });
    const userKeys = [...foreignKeys(spec.model)].filter(([, target]) => target === "User").map(([k]) => k);
    for (const row of rows) {
      for (const key of userKeys) if (typeof row[key] === "string") userIds.add(row[key] as string);
      if (typeof row.voterKey === "string" && row.voterKey.startsWith("user:")) userIds.add(row.voterKey.slice(5));
    }
    const bytes = bytesFields(spec.model);
    tables[spec.model] = bytes.size
      ? rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, bytes.has(k) ? { base64: Buffer.from(v as Uint8Array).toString("base64") } : v])))
      : rows;
  }

  const people = await prisma.user.findMany({
    where: { id: { in: [...userIds] } },
    select: { id: true, email: true, name: true, org: true, pronouns: true, bio: true, link: true },
  });
  const chain = await verifyAuditChain(eventId);
  return {
    formatVersion: TRANSFER_FORMAT,
    exportedAt: new Date().toISOString(),
    source: { eventId, slug: event.slug, auditHead: chain.head, auditIntact: chain.ok, ballotDigest: await ballotDigest(eventId) },
    event: event as unknown as Row,
    people,
    tables,
  };
}

const UPLOAD_URL = /^.*\/api\/uploads\/([0-9a-f-]{36})$/i;

/** Replaces every old id found in a string, a list or nested JSON. Upload links move to this instance. */
function remapDeep(value: unknown, ids: Map<string, string>): unknown {
  if (typeof value === "string") {
    if (ids.has(value)) return ids.get(value);
    const upload = UPLOAD_URL.exec(value);
    if (upload && ids.has(upload[1]!)) return `${config.PUBLIC_API_URL.replace(/\/$/, "")}/api/uploads/${ids.get(upload[1]!)}`;
    if (value.startsWith("user:") && ids.has(value.slice(5))) return `user:${ids.get(value.slice(5))}`;
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => remapDeep(v, ids));
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remapDeep(v, ids)]));
  }
  return value;
}

export interface ImportSummary {
  eventId: string;
  slug: string;
  counts: Record<string, number>;
  peopleCreated: number;
  peopleMatched: number;
}

/**
 * Creates a new event from an export. People are matched by email and created, with no usable
 * password, when missing; they sign in by link. The whole import is one transaction.
 */
export async function importEvent(
  data: EventTransfer,
  opts: { ownerId: string; slug?: string; ipHash?: string },
): Promise<ImportSummary> {
  if (data?.formatVersion !== TRANSFER_FORMAT || !data.event || !data.tables || !Array.isArray(data.people)) {
    throw badRequest(`Expected a podium event export (formatVersion ${TRANSFER_FORMAT}).`);
  }
  const slug = slugify(opts.slug ?? String(data.event.slug ?? data.event.name ?? "imported-event"));
  if (!slug) throw badRequest("Give the imported event a slug.");
  if (await prisma.event.findUnique({ where: { slug }, select: { id: true } })) {
    throw conflict(`An event with the link "${slug}" already exists. Choose another slug.`);
  }

  const ids = new Map<string, string>();
  const unusable = await hashPassword(randomToken(32));
  let peopleCreated = 0;
  const existing = await prisma.user.findMany({
    where: { email: { in: data.people.map((p) => p.email.toLowerCase()) } },
    select: { id: true, email: true },
  });
  const byEmail = new Map(existing.map((u) => [u.email, u.id]));

  const summary = await prisma.$transaction(
    async (tx) => {
      for (const person of data.people) {
        const email = person.email.toLowerCase();
        let id = byEmail.get(email);
        if (!id) {
          id = randomUUID();
          await tx.user.create({
            data: { id, email, name: person.name, org: person.org, pronouns: person.pronouns, bio: person.bio, link: person.link, passwordHash: unusable },
          });
          byEmail.set(email, id);
          peopleCreated += 1;
        }
        ids.set(person.id, id);
      }

      const eventId = randomUUID();
      ids.set(String(data.event.id), eventId);
      for (const spec of MODELS) for (const row of data.tables[spec.model] ?? []) if (typeof row.id === "string") ids.set(row.id, randomUUID());

      const eventRow = Object.fromEntries(Object.entries(data.event).filter(([k]) => !EVENT_OMIT.has(k)));
      await tx.event.create({ data: { ...(remapDeep(eventRow, ids) as Prisma.EventUncheckedCreateInput), id: eventId, slug, ownerId: opts.ownerId } });

      const counts: Record<string, number> = {};
      for (const spec of MODELS) {
        const rows = data.tables[spec.model] ?? [];
        if (rows.length === 0) continue;
        const json = jsonFields(spec.model);
        const bytes = bytesFields(spec.model);
        const generated = new Set(GENERATED[spec.model] ?? []);
        const prepared = rows.map((row) => {
          const out: Row = {};
          for (const [key, value] of Object.entries(row)) {
            if (generated.has(key)) continue;
            if (bytes.has(key)) {
              out[key] = new Uint8Array(Buffer.from((value as { base64: string }).base64, "base64"));
              continue;
            }
            const mapped = remapDeep(value, ids);
            out[key] = json.has(key) && mapped === null ? Prisma.DbNull : mapped;
          }
          if (spec.model === "PairwiseRanking") out.groupKey = groupKey(out.order as string[]);
          if (spec.model === "AuditLog") {
            out.metadata = { ...((out.metadata as object) ?? {}), importedFrom: data.source.slug };
          }
          return out;
        });
        // One at a time for the audit log, so the chain trigger numbers entries in their original order.
        if (spec.model === "AuditLog") {
          const at = (row: Row) => new Date(row.createdAt as string | Date).getTime();
          for (const row of prepared.sort((a, b) => at(a) - at(b))) {
            await delegate(tx, spec.model).createMany({ data: [row] });
          }
        } else {
          await delegate(tx, spec.model).createMany({ data: prepared });
        }
        counts[spec.model] = rows.length;
      }

      if (typeof data.event.publishedRunId === "string" && ids.has(data.event.publishedRunId)) {
        await tx.event.update({ where: { id: eventId }, data: { publishedRunId: ids.get(data.event.publishedRunId) } });
      }
      return { eventId, counts };
    },
    { timeout: 120_000, maxWait: 10_000 },
  );

  // A run that matched the source's ballots matches the copy's; the digest is re-derived for the new ids.
  const digest = await ballotDigest(summary.eventId);
  const runs = await prisma.normalizationRun.findMany({ where: { eventId: summary.eventId }, select: { id: true, ballotDigest: true } });
  for (const run of runs) {
    await prisma.normalizationRun.update({
      where: { id: run.id },
      data: { ballotDigest: run.ballotDigest === data.source.ballotDigest ? digest : null },
    });
  }

  await recordAudit({
    action: AuditAction.BULK_IMPORT,
    eventId: summary.eventId,
    actorId: opts.ownerId,
    targetType: "event",
    targetId: summary.eventId,
    summary: `Event imported from ${data.source.slug} (export of ${data.exportedAt}); source audit chain ${data.source.auditIntact ? "intact" : "broken"}, head ${data.source.auditHead?.slice(0, 16) ?? "none"}`,
    metadata: { source: data.source, counts: summary.counts, peopleCreated },
    ipHash: opts.ipHash,
  });

  return {
    eventId: summary.eventId,
    slug,
    counts: summary.counts,
    peopleCreated,
    peopleMatched: data.people.length - peopleCreated,
  };
}
