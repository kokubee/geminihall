import type { Entry, PublishedEntry } from "./types";

export class NotFoundError extends Error {}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: "application/json" } });
  if (res.status === 404) throw new NotFoundError(path);
  if (!res.ok) throw new Error(`request failed: ${res.status}`);
  return (await res.json()) as T;
}

export async function listEntries(args: { category?: string; before?: string }) {
  const q = new URLSearchParams();
  if (args.category) q.set("category", args.category);
  if (args.before) q.set("before", args.before);
  const qs = q.toString();
  return getJson<{ entries: PublishedEntry[]; next_before: string | null }>(`/api/public/entries${qs ? `?${qs}` : ""}`);
}

export async function getEntry(id: string) {
  return (await getJson<{ entry: Entry }>(`/api/public/entries/${encodeURIComponent(id)}`)).entry;
}
