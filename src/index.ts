import { loadConfig } from "./config.ts";
import { normalizeUrl, getDomain } from "./normalize.ts";
import {
  dropByExtensionOrPath,
  isAllowedCanadaPath,
  isTrustedSection,
  isEnglishAllowed,
  scoreTextOnly,
  scoreUrlOnly,
} from "./filter.ts";

import { discoverFromRss } from "./discover/rss.ts";
import { discoverFromSitemap } from "./discover/sitemap.ts";
import { fetchAny, extractMainTextAndLinks } from "./discover/crawl.ts";

import { bufferSeen, bufferChecked, flushBuffers, countAllUrls, SourceType } from "./store/supabaseStore.ts";

type QueueItem = {
  url: string;
  depth: number;
  source_type: SourceType;
  discovered_from: string | null;
};

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const cfg = loadConfig();

  // ✅ flush DB writes every N processed (batching)
  const SAVE_EVERY = 25;

  const stats = {
    discovered: 0,
    enqueued: 0,
    fetched: 0,
    kept: 0,
    rejected: 0,
    failed: 0,
    rss_items: 0,
    sitemap_urls: 0,
  };

  const queue: QueueItem[] = [];
  const queued = new Set<string>();

  function enqueue(item: QueueItem) {
    const norm = normalizeUrl(item.url, cfg.filter.drop_query_params_prefix);
    if (!norm) return;

    const url = norm;
    const domain = getDomain(url);

    if (!cfg.allowed_domains.includes(domain)) return;
    if (!isEnglishAllowed(url, cfg)) return;
    if (!isAllowedCanadaPath(url, cfg)) return;

    const dropReason = dropByExtensionOrPath(url, cfg);
    if (dropReason) return;

    // avoid duplicates (this run)
    if (queued.has(url)) return;
    queued.add(url);

    stats.discovered++;
    stats.enqueued++;

    bufferSeen({
  url: item.url,
  domain: getDomain(item.url),
  depth: item.depth,
  source_type: item.source_type,
  discovered_from: item.discovered_from,
});

bufferChecked({
  url: item.url,
  status: "failed",
  relevant: false,
  score: 0,
  reason: "fetch failed",
  http_status: null,
  content_type: null,
});

    queue.push({ ...item, url });
  }

  // seeds
  for (const u of cfg.seed_urls) enqueue({ url: u, depth: 0, source_type: "seed", discovered_from: null });

  // rss
  for (const feed of cfg.rss_feeds) {
    try {
      const links = await discoverFromRss(feed, cfg.user_agent, cfg.crawl.timeout_ms);
      stats.rss_items += links.length;
      for (const u of links) enqueue({ url: u, depth: 0, source_type: "rss", discovered_from: feed });
    } catch (e) {
      console.error("[rss] failed", feed, e);
    }
  }

  // sitemaps
  for (const sm of cfg.sitemaps) {
    try {
      const locs = await discoverFromSitemap(sm, cfg.user_agent, cfg.crawl.timeout_ms);
      stats.sitemap_urls += locs.length;
      for (const u of locs) enqueue({ url: u, depth: 0, source_type: "sitemap", discovered_from: sm });
    } catch (e) {
      console.error("[sitemap] failed", sm, e);
    }
  }

  // Flush discovery buffers once before fetch loop (so you see URLs immediately in Supabase)
  await flushBuffers();

  const lastHit = new Map<string, number>();
  let processed = 0;

  while (queue.length > 0 && processed < cfg.crawl.max_pages_per_run) {
    const item = queue.shift()!;
    const domain = getDomain(item.url);

    // politeness
    const now = Date.now();
    const last = lastHit.get(domain) ?? 0;
    const wait = Math.max(0, cfg.crawl.per_domain_delay_ms - (now - last));
    if (wait > 0) await delay(wait);
    lastHit.set(domain, Date.now());

    processed++;
    stats.fetched++;

    try {
      const { status, bodyText, contentType } = await fetchAny(item.url, cfg.user_agent, cfg.crawl.timeout_ms);

      const trusted = isTrustedSection(item.url);
      const urlScore = scoreUrlOnly(item.url, cfg);

      let textScore = { score: 0, reason: "no text scoring" };
      let links: string[] = [];

      const ct = (contentType || "").toLowerCase();
      if (ct.includes("text/html") || ct.includes("application/xhtml+xml")) {
        const selectors = cfg.filter.main_content_selectors ?? ["main", "[role='main']", "#main-content", "article"];
        const extracted = extractMainTextAndLinks(item.url, bodyText, selectors);
        textScore = scoreTextOnly(extracted.text, cfg);
        links = extracted.links;
      }

      const totalScore = urlScore.score + textScore.score;
      const keep = trusted || totalScore >= cfg.filter.score_threshold;

      if (keep) stats.kept++;
      else stats.rejected++;

      // crawl deeper only if relevant/trusted
      if (keep && item.depth < cfg.crawl.max_depth && links.length > 0) {
        for (const link of links) {
          enqueue({
            url: link,
            depth: item.depth + 1,
            source_type: "crawl",
            discovered_from: item.url,
          });
        }
      }

      // ✅ batch flush every N processed
      if (processed % SAVE_EVERY === 0) {
        await flushBuffers();
      }

      // live progress
      if (processed % 25 === 0) {
        const totalStored = await countAllUrls();
        console.log(`
===== Crawl Progress =====
Processed: ${processed}
Discovered: ${stats.discovered}
Enqueued: ${stats.enqueued}
Fetched: ${stats.fetched}
Kept (relevant): ${stats.kept}
Rejected: ${stats.rejected}
Failed: ${stats.failed}
RSS items read: ${stats.rss_items}
Sitemap URLs read: ${stats.sitemap_urls}
Total stored (Supabase): ${totalStored}
Queue remaining: ${queue.length}
==========================
        `.trim());
      }
    } catch (e) {
      stats.failed++;

      bufferChecked({
        url: item.url,
        status: "failed",
        relevant: false,
        score: 0,
        reason: "fetch failed",
        http_status: null,
        content_type: null,
      });

      if (processed % SAVE_EVERY === 0) {
        await flushBuffers();
      }
      continue;
    }
  }

  // final flush
  await flushBuffers();

  const totalStored = await countAllUrls();
  console.log(`
========== FINAL SUMMARY ==========
Processed this run: ${processed}
Discovered: ${stats.discovered}
Enqueued: ${stats.enqueued}
Fetched: ${stats.fetched}
Kept (relevant): ${stats.kept}
Rejected: ${stats.rejected}
Failed: ${stats.failed}
RSS items read: ${stats.rss_items}
Sitemap URLs read: ${stats.sitemap_urls}
Total URLs stored (Supabase): ${totalStored}
===================================
  `.trim());
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
