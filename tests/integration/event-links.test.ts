import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, as, createOrganizer, createUser, prisma, resetDatabase, type TestActor } from "../helpers.js";

describe("custom event links", () => {
  let organizer: TestActor;
  let other: TestActor;

  beforeAll(async () => {
    await resetDatabase();
    organizer = await createOrganizer("Organizer");
    other = await createOrganizer("Other organizer");
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("uses the chosen link exactly, lowercased", async () => {
    const res = await as(organizer).post("/api/events").send({ name: "Harbor", slug: "Harbor-Hack-26" }).expect(201);
    expect(res.body.slug).toBe("harbor-hack-26");
    await anon().get("/api/events/harbor-hack-26").expect(404); // still a draft
    await as(organizer).get("/api/events/harbor-hack-26").expect(200);
  });

  it("refuses a link another event already uses, and suggests a free one", async () => {
    const res = await as(other).post("/api/events").send({ name: "Copycat", slug: "harbor-hack-26" }).expect(409);
    expect(res.body.error.details.suggestion).toBe("harbor-hack-26-2");
    expect(await prisma.event.count({ where: { name: "Copycat" } })).toBe(0);
  });

  it.each([
    ["ab", "3 to 60"],
    ["two--hyphens", "single hyphens"],
    ["-leading", "single hyphens"],
    ["spaces here", "single hyphens"],
    ["new", "reserved"],
    ["0162ce17-7984-4999-8df4-909c97a76a1f", "event id"],
  ])("refuses the link %j", async (slug, reason) => {
    const res = await as(organizer).post("/api/events").send({ name: "Bad link", slug }).expect(400);
    expect(res.body.error.message).toContain(reason);
  });

  it("still derives a unique link from the name when none is chosen", async () => {
    const first = await as(organizer).post("/api/events").send({ name: "Auto Link" }).expect(201);
    const second = await as(organizer).post("/api/events").send({ name: "Auto Link" }).expect(201);
    expect(first.body.slug).toBe("auto-link");
    expect(second.body.slug).toBe("auto-link-2");
  });

  it("reports availability for the wizard's live check", async () => {
    const taken = await as(organizer).get("/api/events/slug-availability?slug=harbor-hack-26").expect(200);
    expect(taken.body).toMatchObject({ available: false, suggestion: "harbor-hack-26-2" });

    const free = await as(organizer).get("/api/events/slug-availability?slug=quiet-tide").expect(200);
    expect(free.body).toEqual({ slug: "quiet-tide", available: true });

    const bad = await as(organizer).get("/api/events/slug-availability?slug=new").expect(200);
    expect(bad.body).toMatchObject({ available: false, reason: "That link is reserved." });

    await anon().get("/api/events/slug-availability?slug=quiet-tide").expect(401);
  });

  it("lets an event keep its own link on update, and refuses someone else's", async () => {
    const mine = await as(organizer).post("/api/events").send({ name: "Mine", slug: "mine-26" }).expect(201);
    await as(organizer).patch(`/api/events/${mine.body.id}`).send({ slug: "mine-26", tagline: "same link" }).expect(200);
    await as(organizer).patch(`/api/events/${mine.body.id}`).send({ slug: "harbor-hack-26" }).expect(409);
    const moved = await as(organizer).patch(`/api/events/${mine.body.id}`).send({ slug: "mine-2026" }).expect(200);
    expect(moved.body.slug).toBe("mine-2026");
  });

  it("does not let a non-organizer probe links", async () => {
    const user = await createUser({ name: "User" });
    await as(user).get("/api/events/slug-availability?slug=quiet-tide").expect(403);
    await as(user).post("/api/events").send({ name: "No", slug: "no-way" }).expect(403);
  });
});
