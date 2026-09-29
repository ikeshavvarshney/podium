import { PHOTO_BOX, shrinkImage, type ImageBox } from "@/lib/image";

/**
 * Thin API client. Credentials travel in the HTTP-only session cookie, so
 * nothing here ever touches a token.
 */
const BROWSER_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const SERVER_BASE = process.env.INTERNAL_API_URL ?? BROWSER_BASE;

export const apiBase = () => (typeof window === "undefined" ? SERVER_BASE : BROWSER_BASE);

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, string>;

  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.error?.message ?? "Request failed.");
    this.name = "ApiError";
    this.status = status;
    this.code = body?.error?.code ?? "unknown";
    this.details = body?.error?.details as Record<string, string> | undefined;
  }
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${apiBase()}/api${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    cache: "no-store",
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const body = text ? JSON.parse(text) : null;

  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export const get = <T>(path: string, init?: RequestInit) => api<T>(path, init);
export const post = <T>(path: string, data?: unknown) =>
  api<T>(path, { method: "POST", body: data === undefined ? undefined : JSON.stringify(data) });
export const put = <T>(path: string, data: unknown) =>
  api<T>(path, { method: "PUT", body: JSON.stringify(data) });
export const patch = <T>(path: string, data: unknown) =>
  api<T>(path, { method: "PATCH", body: JSON.stringify(data) });
export const del = <T>(path: string) => api<T>(path, { method: "DELETE" });

/** Shrinks one image to the box, uploads it and returns its link. */
export const uploadImage = async (file: File, event?: string, box: ImageBox = PHOTO_BOX) =>
  api<{ id: string; url: string }>(`/uploads${event ? `?event=${encodeURIComponent(event)}` : ""}`, {
    method: "POST",
    body: await shrinkImage(file, box),
    headers: { "Content-Type": "application/octet-stream" },
  });

/** Points an upload link at the address this instance is served from now. */
export function mediaUrl(url: string): string {
  const m = /\/api\/uploads\/([0-9a-f-]{36})$/i.exec(url);
  return m ? `${BROWSER_BASE.replace(/\/$/, "")}/api/uploads/${m[1]}` : url;
}
