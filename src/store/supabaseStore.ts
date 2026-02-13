import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

export type SourceType = "seed" | "rss" | "sitemap" | "crawl";
export type StatusType = "pending" | "visited" | "failed";

export type SeenRow = {
  url: string;
  domain: string;
  depth: number;
  source_type: SourceType;
  discovered_from: string | null;
};

export type CheckedPatch = {
  url: string;
  status: StatusType;
  relevant: boolean;
  score: number;
  reason: string;
  http_status: number | null;
  content_type: string | null;
  check_interval_hours?: number | null;
  next_check_at?: string | null;
};

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ---------- Batch buffers ----------
const seenBuffer: SeenRow[] = [];
const checkedBuffer: CheckedPatch[] = [];

export function bufferSeen(row: SeenRow) {
  seenBuffer.push(row);
}

export function bufferChecked(patch: CheckedPatch) {
  checkedBuffer.push(patch);
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Flush both buffers in batches (safe + fast)
export async function flushBuffers() {
  const nowIso = new Date().toISOString();

  // 1) upsert "seen" URLs (dedupe by url)
  if (seenBuffer.length > 0) {
    const payload = seenBuffer.splice(0, seenBuffer.length).map((r) => ({
      url: r.url,
      domain: r.domain,
      depth: r.depth,
      source_type: r.source_type,
      discovered_from: r.discovered_from,
      last_seen_at: nowIso,
    }));

    for (const part of chunk(payload, 200)) {
      const { error } = await supabase.from("urls").upsert(part, { onConflict: "url" });
      if (error) throw error;
    }
  }

  // 2) apply "checked" patches using UPDATE (not UPSERT)
  if (checkedBuffer.length > 0) {
    const payload = checkedBuffer.splice(0, checkedBuffer.length);

    // update each row (small batches; SAVE_EVERY keeps this cheap)
    for (const p of payload) {
      const { error } = await supabase
        .from("urls")
        .update({
          status: p.status,
          relevant: p.relevant,
          score: p.score,
          reason: p.reason,
          http_status: p.http_status,
          content_type: p.content_type,
          last_checked_at: nowIso,
          last_seen_at: nowIso,
          ...(p.check_interval_hours !== undefined ? { check_interval_hours: p.check_interval_hours } : {}),
          ...(p.next_check_at !== undefined ? { next_check_at: p.next_check_at } : {}),
        })
        .eq("url", p.url);

      if (error) throw error;
    }
  }
}

export async function countAllUrls(): Promise<number> {
  const { count, error } = await supabase.from("urls").select("id", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

export async function fetchDueUrls(limit: number) {
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from("urls")
    .select("url,domain,depth,source_type,discovered_from")
    .lte("next_check_at", nowIso)
    .order("next_check_at", { ascending: true })
    .limit(limit);

  if (error) throw error;

  return (data ?? []) as Array<{
    url: string;
    domain: string;
    depth: number;
    source_type: "seed" | "rss" | "sitemap" | "crawl";
    discovered_from: string | null;
  }>;
}
