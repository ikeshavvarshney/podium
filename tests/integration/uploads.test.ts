import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, app, as, createEvent, createOrganizer, createUser, prisma, resetDatabase, type TestActor } from "../helpers.js";

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("rest of a tiny png, which the server only sniffs"),
]);

const upload = (actor: TestActor | null, body: Buffer, query = "") => {
  const req = request(app).post(`/api/uploads${query}`).set("Content-Type", "application/octet-stream");
  if (actor) req.set("Authorization", `Bearer ${actor.token}`);
  return req.send(body);
};

describe("image uploads", () => {
  let organizer: TestActor;
  let event: { id: string; slug: string };

  beforeAll(async () => {
    await resetDatabase();
    organizer = await createOrganizer("Uploader");
    event = await createEvent(organizer, { name: "Upload Event" });
  });

  afterAll(async () => {
    await resetDatabase();
  });

  it("stores a raster image and serves it back safely", async () => {
    const res = await upload(organizer, PNG, `?event=${event.slug}`).expect(201);
    expect(res.body).toMatchObject({ contentType: "image/png", size: PNG.length });
    expect(res.body.url).toMatch(/\/api\/uploads\/[0-9a-f-]{36}$/);

    const got = await anon().get(`/api/uploads/${res.body.id}`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(Buffer.compare(got.body as Buffer, PNG)).toBe(0);
    expect(got.headers["content-type"]).toBe("image/png");
    expect(got.headers["x-content-type-options"]).toBe("nosniff");
    expect(got.headers["content-security-policy"]).toContain("sandbox");
  });

  it("refuses SVG and anything that is not a known image, whatever it claims to be", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    await request(app).post("/api/uploads").set("Authorization", `Bearer ${organizer.token}`).set("Content-Type", "image/png").send(svg).expect(400);
    await upload(organizer, Buffer.from("plain text")).expect(400);
  });

  it("refuses an anonymous upload, an oversized one, and an event the uploader is not part of", async () => {
    await upload(null, PNG).expect(401);
    await upload(organizer, Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)])).expect(413);
    const stranger = await createUser({ name: "Stranger" });
    await upload(stranger, PNG, `?event=${event.slug}`).expect(404);
  });

  it("answers a malformed JSON body with 400, not 500", async () => {
    await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send('{"email": ')
      .expect(400);
  });

  it("travels with an event export and gets a new address on import", async () => {
    // The same image was uploaded above, so this reuses it and ties it to the event.
    const up = await upload(organizer, PNG, `?event=${event.slug}`).expect(200);
    await as(organizer).patch(`/api/events/${event.id}`).send({ tagline: `Cover at ${up.body.url}` }).expect(200);
    const exported = (await as(organizer).get(`/api/events/${event.id}/export/event.json`).expect(200)).body;
    expect(exported.tables.Upload.length).toBeGreaterThanOrEqual(1);

    const imported = await as(organizer).post("/api/events/import").send({ data: exported, slug: "upload-copy" }).expect(201);
    expect(imported.body.counts.Upload).toBe(exported.tables.Upload.length);
    const copy = await prisma.upload.findFirstOrThrow({ where: { event: { slug: "upload-copy" } } });
    expect(copy.id).not.toBe(up.body.id);
    expect(Buffer.compare(Buffer.from(copy.data), PNG)).toBe(0);
  });
});
