import { JudgingMode } from "@prisma/client";
import { prisma } from "../db.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { AuditAction, recordAudit } from "./audit.service.js";
import type { EventContext } from "./authorization.service.js";

export interface CriterionInput {
  key: string;
  label: string;
  hint?: string | null;
  weight: number;
  minScore?: number;
  maxScore?: number;
}

export interface RubricInput {
  name?: string;
  mode?: JudgingMode;
  groupSize?: number;
  criteria: CriterionInput[];
}

export const rubricInclude = {
  criteria: { orderBy: { position: "asc" } },
} as const;

/**
 * Weights are integer percentages and must total exactly 100. Anything else
 * makes a weighted total meaningless, so it is refused rather than rescaled.
 */
export function assertWeightsValid(criteria: CriterionInput[]): void {
  if (criteria.length === 0) {
    throw badRequest("A rubric needs at least one criterion.");
  }

  const keys = new Set<string>();
  for (const c of criteria) {
    if (keys.has(c.key)) throw badRequest(`Duplicate criterion key "${c.key}".`);
    keys.add(c.key);

    const min = c.minScore ?? 1;
    const max = c.maxScore ?? 5;
    if (min >= max) {
      throw badRequest(`Criterion "${c.label}" needs a score range where min is below max.`);
    }
  }

  const total = criteria.reduce((sum, c) => sum + c.weight, 0);
  if (total !== 100) {
    throw badRequest(`Criterion weights must total 100%. They currently total ${total}%.`, {
      total,
    });
  }
}

export async function getRubric(ctx: EventContext) {
  return prisma.rubric.findUnique({
    where: { eventId: ctx.event.id },
    include: rubricInclude,
  });
}

/**
 * Replaces the rubric wholesale. Refused once any ballot exists, because
 * changing a weight underneath cast ballots silently rewrites past results.
 */
export async function upsertRubric(ctx: EventContext, input: RubricInput, ipHash?: string) {
  assertWeightsValid(input.criteria);

  const ballotCount = await prisma.judgeScore.count({ where: { eventId: ctx.event.id } });
  if (ballotCount > 0) {
    throw conflict(
      `The rubric is locked: ${ballotCount} ballots have already been cast against it.`,
    );
  }

  const rubric = await prisma.$transaction(async (tx) => {
    const existing = await tx.rubric.findUnique({ where: { eventId: ctx.event.id } });

    const base = existing
      ? await tx.rubric.update({
          where: { id: existing.id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.mode !== undefined ? { mode: input.mode } : {}),
            ...(input.groupSize !== undefined ? { groupSize: input.groupSize } : {}),
          },
        })
      : await tx.rubric.create({
          data: {
            eventId: ctx.event.id,
            name: input.name ?? "Default rubric",
            mode: input.mode ?? JudgingMode.RUBRIC,
            groupSize: input.groupSize ?? 4,
          },
        });

    await tx.rubricCriterion.deleteMany({ where: { rubricId: base.id } });
    await tx.rubricCriterion.createMany({
      data: input.criteria.map((c, i) => ({
        rubricId: base.id,
        key: c.key,
        label: c.label,
        hint: c.hint ?? null,
        weight: c.weight,
        minScore: c.minScore ?? 1,
        maxScore: c.maxScore ?? 5,
        position: i,
      })),
    });

    return tx.rubric.findUniqueOrThrow({ where: { id: base.id }, include: rubricInclude });
  });

  await recordAudit({
    action: AuditAction.RUBRIC_UPDATED,
    eventId: ctx.event.id,
    actorId: ctx.user?.id ?? null,
    targetType: "rubric",
    targetId: rubric.id,
    summary: `Rubric updated: ${input.criteria.length} criteria`,
    metadata: {
      criteria: input.criteria.map((c) => ({ key: c.key, weight: c.weight })),
    },
    ipHash,
  });

  return rubric;
}

export async function requireRubric(eventId: string) {
  const rubric = await prisma.rubric.findUnique({
    where: { eventId },
    include: rubricInclude,
  });
  if (!rubric || rubric.criteria.length === 0) {
    throw notFound("This event does not have a rubric yet.");
  }
  return rubric;
}

/** Marks the rubric frozen the first time a ballot lands. */
export async function lockRubricIfNeeded(eventId: string): Promise<void> {
  await prisma.rubric.updateMany({
    where: { eventId, lockedAt: null },
    data: { lockedAt: new Date() },
  });
}
