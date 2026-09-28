import { readFileSync, writeFileSync } from "node:fs";
import { prisma } from "../src/db.js";
import { findEventByIdOrSlug } from "../src/services/authorization.service.js";
import { exportEvent, importEvent, type EventTransfer } from "../src/services/event-transfer.service.js";

/**
 * Moving an event between instances without the HTTP API:
 *
 *   npm run event -- export <slug> [file.json]
 *   npm run event -- import <file.json> --owner <email> [--slug <new-slug>]
 */
const [command, target, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};

async function main(): Promise<void> {
  if (command === "export" && target) {
    const event = await findEventByIdOrSlug(target);
    if (!event) throw new Error(`No event ${target}`);
    const json = JSON.stringify(await exportEvent(event.id), null, 2);
    if (rest[0]) writeFileSync(rest[0], json);
    else process.stdout.write(json);
    return;
  }
  if (command === "import" && target) {
    const email = flag("owner");
    if (!email) throw new Error("--owner <email> is required: the account that will own the imported event");
    const owner = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!owner) throw new Error(`No account ${email}`);
    const data = JSON.parse(readFileSync(target, "utf8")) as EventTransfer;
    console.log(JSON.stringify(await importEvent(data, { ownerId: owner.id, slug: flag("slug") }), null, 2));
    return;
  }
  throw new Error("usage: event export <slug> [file] | event import <file> --owner <email> [--slug <slug>]");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
