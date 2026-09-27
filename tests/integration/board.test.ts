import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  as,
  createEvent,
  createOrganizer,
  createUser,
  prisma,
  resetDatabase,
  type TestActor,
} from "../helpers.js";

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();

describe("team formation board", () => {
  let organizer: TestActor;
  let owner: TestActor;
  let seeker: TestActor;
  let other: TestActor;
  let stranger: TestActor;
  let event: { id: string; slug: string };
  let teamId: string;

  beforeAll(async () => {
    await resetDatabase();
    organizer = await createOrganizer("Organizer");
    owner = await createUser({ name: "Owner" });
    seeker = await createUser({ name: "Seeker" });
    other = await createUser({ name: "Other" });
    stranger = await createUser({ name: "Stranger" });
    event = await createEvent(organizer, {
      name: "Board Event",
      registrationClosesAt: FUTURE,
      submissionDeadline: FUTURE,
      maxTeamSize: 2,
    });
    for (const actor of [owner, seeker, other]) {
      await as(actor).post(`/api/events/${event.id}/register`).expect(201);
    }
    const team = await as(owner).post(`/api/events/${event.id}/teams`).send({ name: "Sievebox" }).expect(201);
    teamId = team.body.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("lets a team owner list what the team needs", async () => {
    await as(owner)
      .post(`/api/events/${event.id}/board/listing`)
      .send({ pitch: "Need a front-end.", needs: ["frontend"], skills: ["go"] })
      .expect(201);
    const board = await as(seeker).get(`/api/events/${event.id}/board`).expect(200);
    expect(board.body.teams[0].needs).toEqual(["frontend"]);
    expect(board.body.teams[0].seatsFilled).toBe(1);
  });

  it("lets a teamless participant list themselves and refuses the unregistered", async () => {
    await as(seeker)
      .post(`/api/events/${event.id}/board/listing`)
      .send({ pitch: "Ruby and on-call tooling.", skills: ["ruby"] })
      .expect(201);
    await as(stranger)
      .post(`/api/events/${event.id}/board/listing`)
      .send({ pitch: "Let me in." })
      .expect(403);
    const board = await as(owner).get(`/api/events/${event.id}/board`).expect(200);
    expect(board.body.seekers.map((s: { name: string }) => s.name)).toEqual(["Seeker"]);
  });

  it("keeps a request private and changes nothing until it is accepted", async () => {
    const ask = await as(seeker).post(`/api/events/${event.id}/board/requests`).send({ teamId }).expect(201);

    const members = await prisma.teamMember.count({ where: { teamId } });
    expect(members).toBe(1);

    const outsiderView = await as(other).get(`/api/events/${event.id}/board/requests/mine`).expect(200);
    expect(outsiderView.body).toHaveLength(0);

    const ownerView = await as(owner).get(`/api/events/${event.id}/board/requests/mine`).expect(200);
    expect(ownerView.body[0].awaitingMe).toBe(true);

    // The asker cannot accept their own request.
    await as(seeker).post(`/api/events/${event.id}/board/requests/${ask.body.id}/accept`).expect(403);

    await as(owner).post(`/api/events/${event.id}/board/requests/${ask.body.id}/accept`).expect(200);
    const after = await prisma.teamMember.count({ where: { teamId } });
    expect(after).toBe(2);
  });

  it("drops a joined person from the seekers and a full team from the board", async () => {
    const board = await as(other).get(`/api/events/${event.id}/board`).expect(200);
    expect(board.body.seekers).toHaveLength(0);
    expect(board.body.teams).toHaveLength(0);
  });

  it("refuses an invite from someone who does not own a team", async () => {
    await as(other)
      .post(`/api/events/${event.id}/board/requests`)
      .send({ userId: seeker.id })
      .expect(403);
  });

  it("refuses to add anyone to a full team", async () => {
    await as(other).post(`/api/events/${event.id}/board/requests`).send({ teamId }).expect(201);
    const pending = await prisma.joinRequest.findFirstOrThrow({
      where: { teamId, userId: other.id, status: "PENDING" },
    });
    await as(owner).post(`/api/events/${event.id}/board/requests/${pending.id}/accept`).expect(409);
  });

  it("audits listings, requests, declines and ownership transfer", async () => {
    const pending = await prisma.joinRequest.findFirstOrThrow({
      where: { teamId, userId: other.id, status: "PENDING" },
    });
    await as(owner).post(`/api/events/${event.id}/board/requests/${pending.id}/decline`).expect(200);
    await as(owner)
      .post(`/api/events/${event.id}/teams/${teamId}/transfer`)
      .send({ userId: seeker.id })
      .expect(200);

    const actions = (
      await prisma.auditLog.findMany({ where: { eventId: event.id }, select: { action: true } })
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "BOARD_LISTING_POSTED",
        "JOIN_REQUESTED",
        "JOIN_REQUEST_DECIDED",
        "TEAM_OWNER_TRANSFERRED",
      ]),
    );
  });
});
