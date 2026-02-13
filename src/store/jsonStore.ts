import fs from "node:fs";
import path from "node:path";

export type StoredUrl = {
  url: string;
  domain: string;
  depth: number;
  source_type: "seed" | "rss" | "sitemap" | "crawl";
  discovered_from: string | null;

  // scoring + relevance
  score: number;
  reason: string;
  relevant: boolean;

  // lifecycle
  status: "pending" | "visited" | "failed";
  first_seen_at: string;
  last_seen_at: string;
  last_checked_at: string | null;

  // scheduling
  next_check_at: string | null;
  check_interval_hours: number | null;

  // fetch metadata
  http_status: number | null;
  content_type: string | null;
};

const DATA_PATH = path.resolve(process.cwd(), "data/urls.json");

export function loadStore(): Map<string, StoredUrl> {
  if (!fs.existsSync(DATA_PATH)) return new Map();

  try {
    const raw = fs.readFileSync(DATA_PATH, "utf-8").trim();
    if (!raw) return new Map();

    const arr = JSON.parse(raw) as StoredUrl[];
    if (!Array.isArray(arr)) return new Map();

    return new Map(arr.map((x) => [x.url, x]));
  } catch (e) {
    // If JSON is corrupted (partial write), back it up and start fresh
    const backupPath = DATA_PATH.replace(/\.json$/i, `.corrupt.${Date.now()}.json`);
    try {
      fs.renameSync(DATA_PATH, backupPath);
      console.warn(`[store] urls.json was corrupt. Moved to: ${backupPath}`);
    } catch {
      console.warn("[store] urls.json was corrupt and could not be renamed. Starting fresh.");
    }
    return new Map();
  }
}


export function saveStore(map: Map<string, StoredUrl>) {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  const arr = [...map.values()].sort((a, b) => a.url.localeCompare(b.url));
  fs.writeFileSync(DATA_PATH, JSON.stringify(arr, null, 2), "utf-8");
}

export function upsertSeen(
  map: Map<string, StoredUrl>,
  item: Omit<
    StoredUrl,
    | "first_seen_at"
    | "last_seen_at"
    | "last_checked_at"
    | "http_status"
    | "content_type"
    | "next_check_at"
    | "check_interval_hours"
  > & {
    next_check_at?: string | null;
    check_interval_hours?: number | null;
  }
) {
  const now = new Date().toISOString();
  const existing = map.get(item.url);

  if (!existing) {
    map.set(item.url, {
      ...item,
      first_seen_at: now,
      last_seen_at: now,
      last_checked_at: null,
      http_status: null,
      content_type: null,
      next_check_at: item.next_check_at ?? now, // default: due now
      check_interval_hours: item.check_interval_hours ?? null,
    });
  } else {
    // keep first_seen_at, update last_seen_at
    map.set(item.url, {
      ...existing,
      ...item,
      last_seen_at: now,
      next_check_at: item.next_check_at ?? existing.next_check_at,
      check_interval_hours: item.check_interval_hours ?? existing.check_interval_hours,
    });
  }
}

export function markChecked(
  map: Map<string, StoredUrl>,
  url: string,
  patch: Partial<
    Pick<
      StoredUrl,
      | "status"
      | "relevant"
      | "score"
      | "reason"
      | "http_status"
      | "content_type"
      | "next_check_at"
      | "check_interval_hours"
    >
  >
) {
  const existing = map.get(url);
  if (!existing) return;

  map.set(url, {
    ...existing,
    ...patch,
    last_checked_at: new Date().toISOString(),
  });
}

export function isDue(u: StoredUrl, nowMs: number): boolean {
  if (!u.next_check_at) return true;
  const t = Date.parse(u.next_check_at);
  if (Number.isNaN(t)) return true;
  return t <= nowMs;
}
