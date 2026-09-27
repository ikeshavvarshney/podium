import { headers } from "next/headers";
import { get } from "./api";

/**
 * GET from a server component, as the person viewing the page. The browser sends its
 * session cookie to the web host, not to the API, so a server-side call has to carry it
 * across; without it every server-rendered page would see a signed-out visitor, and an
 * organizer would get the public view of their own event.
 */
export async function serverGet<T>(path: string): Promise<T> {
  const cookie = (await headers()).get("cookie");
  return get<T>(path, cookie ? { headers: { cookie } } : undefined);
}
