import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  as,
  createEvent,
  createOrganizer,
  createUser,
  grantRole,
  prisma,
  resetDatabase,
  type TestActor,
} from "../helpers.js";

describe("admins limited to parts of an event", () => {
  let owner: TestActor;
  let editor: TestActor;
  let full: TestActor;
  let judge: TestActor;
  let event: { id: string; slug: string };
  let editorMembership: string;

  beforeAll(async () => {
    await resetDatabase();
    owner = await createOrganizer("Owner");
    editor = await createUser({ name: "Editor" });
    full = await createUser({ name: "Full" });
    judge = await createUser({ name: "Judge" });
    event = await createEvent(owner, { name: "Scoped Admins" });
    editorMembership = await grantRole(owner, event.id, editor, "ADMIN", ["UPDATES", "ROLES"]);
    await grantRole(owner, event.id, full, "ADMIN");
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("starts a new admin with nothing when no access is given", async () => {
    const bare = await createUser({ name: "Bare" });
    const id = await grantRole(owner, event.id, bare, "ADMIN", []);
    const row = await prisma.eventMembership.findUniqueOrThrow({ where: { id } });
    expect(row.permissions).toEqual([]);
    await as(bare).patch(`/api/events/${event.id}`).send({ name: "Nope" }).expect(403);
  });

  it("allows only the granted areas", async () => {
    await as(editor)
      .post(`/api/events/${event.id}/updates`)
      .send({ title: "Doors open", body: "Doors open at nine." })
      .expect(201);
    await as(editor).patch(`/api/events/${event.id}`).send({ name: "Renamed" }).expect(403);
    await as(editor).get(`/api/events/${event.id}/voting/config`).expect(403);
    await as(editor).get(`/api/events/${event.id}/audit`).expect(403);
  });

  it("lets a roles admin manage judges but not admins", async () => {
    await grantRole(editor, event.id, judge, "JUDGE");
    const other = await createUser({ name: "Other" });
    await as(editor)
      .post(`/api/events/${event.id}/members`)
      .send({ email: other.email, role: "ADMIN", permissions: ["ALL"] })
      .expect(403);
    await as(editor)
      .patch(`/api/events/${event.id}/members/${editorMembership}`)
      .send({ permissions: ["ALL"] })
      .expect(403);
  });

  it("lets a full-access admin change another admin's access", async () => {
    await as(full)
      .patch(`/api/events/${event.id}/members/${editorMembership}`)
      .send({ permissions: ["SETTINGS"] })
      .expect(200);
    await as(editor).patch(`/api/events/${event.id}`).send({ name: "Scoped Admins" }).expect(200);
    await as(editor).get(`/api/events/${event.id}/members`).expect(403);
  });

  it("reports the caller's areas on the event", async () => {
    const res = await as(editor).get(`/api/events/${event.id}`).expect(200);
    expect(res.body.viewer.fullAccess).toBe(false);
    expect(res.body.viewer.permissions).toEqual(["SETTINGS"]);
  });
});
