import { XMLParser } from "fast-xml-parser";
import { fetchTextWithRedirects } from "../http.ts";

function looksLikeXml(s: string): boolean {
  const t = s.trim();
  return t.startsWith("<?xml") || t.startsWith("<urlset") || t.startsWith("<sitemapindex");
}

export async function discoverFromSitemap(
  sitemapUrl: string,
  userAgent: string,
  timeoutMs: number
): Promise<string[]> {
  const { status, headers, bodyText, finalUrl } = await fetchTextWithRedirects(sitemapUrl, {
    userAgent,
    timeoutMs,
    accept: "application/xml, text/xml;q=0.9,*/*;q=0.8",
    maxRedirects: 5,
  });

  if (status < 200 || status >= 400) {
    console.warn("[sitemap] http", status, sitemapUrl);
    return [];
  }

  const ct = (headers["content-type"] ?? "").toString().toLowerCase();
  if (!ct.includes("xml") && !looksLikeXml(bodyText)) {
    const preview = bodyText.trim().slice(0, 220).replace(/\s+/g, " ");
    console.warn("[sitemap] not xml:", { sitemapUrl, finalUrl, contentType: ct, preview });
    return [];
  }

  const parser = new XMLParser({ ignoreAttributes: false });
  const xml = parser.parse(bodyText);

  const out: string[] = [];

  // urlset
  const urls = xml?.urlset?.url;
  if (Array.isArray(urls)) {
    for (const u of urls) {
      if (typeof u?.loc === "string") out.push(u.loc);
    }
  }

  // sitemap index
  const sitemaps = xml?.sitemapindex?.sitemap;
  if (Array.isArray(sitemaps)) {
    for (const sm of sitemaps) {
      if (typeof sm?.loc === "string") out.push(sm.loc);
    }
  }

  // If this was a sitemap index, we return child sitemap URLs too.
  // index.ts will enqueue them, and they’ll get parsed on subsequent runs.
  return out;
}
