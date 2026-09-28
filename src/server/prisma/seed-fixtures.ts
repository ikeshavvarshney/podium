import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { storeApiToken } from "../src/services/api-token.service.js";
import { fixtureSchema, importFixture, slugify, stableUserId } from "../src/services/fixture-import.service.js";

/** The fixture has no organizer, so the import creates one to own the event. */
const ORGANIZER = { email: "organizer@example.org", name: "Fixture organizer" };

/**
 * The acceptance checker's tokens, committed in .dogfood.toml. They are public by design, so each
 * is scoped to the fixture event: inside it they act as that account, anywhere else as nobody,
 * and never with the account's organizer capability. Revoke them with DELETE /api/auth/tokens/:id,
 * or skip them entirely with FIXTURE_TOKENS=false.
 */
export const CHECKER_TOKENS: Record<string, string> = {
  organizer: "pod_dogfood_organizer_mHUdlL3Z74StgxfAF-ULvUiv",
  judge_a: "pod_dogfood_judgea_tYGVQuQmtrBYbXhQx9E0vKFU",
  judge_b: "pod_dogfood_judgeb_glvLi55oj-xnR4F4kEmvatkc",
  participant: "pod_dogfood_participant_3DXe91anyGasgaMGSdAfCBam",
};

/**
 * Who the acceptance checker acts as. Judge A and judge B are fixture judges who both hold
 * ballots; the participant is the first member of the first fixture team.
 */
const CHECKER = {
  judge_a: "marek.nowak@example.org",
  judge_b: "mira.kaur@example.org",
  participant: "priya1@example.org",
};

function findFixtures(): string | null {
  const candidates = [process.env.FIXTURES_PATH, "fixtures.json", "../../fixtures.json", "/app/fixtures.json"];
  for (const candidate of candidates) {
    if (candidate && existsSync(resolve(candidate))) return resolve(candidate);
  }
  return null;
}

/**
 * Imports fixtures.json once (SEED_FORCE=true rebuilds it), then prints the headers and
 * routes the acceptance checker uses. Those values are stable across reseeds because the
 * accounts get ids derived from their email and the tokens have fixed timestamps.
 */
export async function seedFixtures(prisma: PrismaClient, passwordHash: () => Promise<string>): Promise<void> {
  const path = findFixtures();
  if (!path) {
    console.log("[seed] fixtures.json not found, skipping the fixture event (set FIXTURES_PATH)");
    return;
  }

  const fixture = fixtureSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  const slug = slugify(fixture.event.name);
  const existing = await prisma.event.findUnique({ where: { slug }, select: { id: true } });

  if (existing && process.env.SEED_FORCE === "true") {
    console.log(`[seed] rebuilding the fixture event ${slug}`);
    await prisma.event.delete({ where: { id: existing.id } });
  }

  if (!existing || process.env.SEED_FORCE === "true") {
    const hash = await passwordHash();
    const owner = await prisma.user.upsert({
      where: { email: ORGANIZER.email },
      update: {},
      create: {
        id: stableUserId(ORGANIZER.email),
        email: ORGANIZER.email,
        name: ORGANIZER.name,
        passwordHash: hash,
        isOrganizer: true,
      },
      select: { id: true },
    });
    const result = await importFixture(prisma, fixture, { ownerId: owner.id, passwordHash: hash }).catch(async (err) => {
      // A half-written event would be skipped on the next boot, so it is removed first.
      await prisma.event.deleteMany({ where: { slug } });
      throw err;
    });
    console.log(
      `[seed] imported ${path}: ${result.submissions} submissions, ${result.ballots} ballots` +
        (result.skipped.length ? `, refused ${result.skipped.length}` : ""),
    );
    for (const s of result.skipped) console.log(`[seed]   refused ${s.kind} ${s.id}: ${s.reason}`);
    for (const r of result.renamed) console.log(`[seed]   team ${r.id} "${r.from}" stored as "${r.to}" (name already taken)`);
  } else {
    console.log(`[seed] fixture event ${slug} already present`);
  }

  const people: Record<string, string> = { organizer: ORGANIZER.email, ...CHECKER };
  const users = await prisma.user.findMany({
    where: { email: { in: Object.values(people) } },
    select: { id: true, email: true },
  });
  const byEmail = new Map(users.map((u) => [u.email, u]));
  const event = await prisma.event.findUniqueOrThrow({ where: { slug }, select: { id: true } });

  if (process.env.FIXTURE_TOKENS === "false") {
    console.log("[seed] FIXTURE_TOKENS=false: no acceptance checker tokens issued");
  } else {
    console.log(`[seed] acceptance checker headers (scoped to ${slug} only):`);
    for (const [role, email] of Object.entries(people)) {
      const user = byEmail.get(email);
      if (!user) continue;
      const { token } = await storeApiToken(prisma, user.id, {
        name: `acceptance checker (${role})`,
        eventId: event.id,
        plaintext: CHECKER_TOKENS[role]!,
      });
      console.log(`[seed]   ${role.padEnd(11)} = "Authorization: Bearer ${token}"`);
    }
  }
  const judgeA = byEmail.get(CHECKER.judge_a);
  if (judgeA) console.log(`[seed]   peer_scores = "/api/events/${slug}/judges/${judgeA.id}/scores"`);
}
