import * as cheerio from "cheerio";
import { fetchTextWithRedirects } from "../http.ts";

export function extractMainTextAndLinks(
  url: string,
  html: string,
  selectors: string[]
): { text: string; links: string[] } {
  const $ = cheerio.load(html);

  // remove obvious junk
  $("script, style, nav, footer, header, aside").remove();

  // pick main content area
  let $root = $(selectors.join(","));
  if ($root.length === 0) $root = $("body");

  // text
  const text = $root.text().replace(/\s+/g, " ").trim();

  // links only inside main content
  const links = new Set<string>();
  $root.find("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    if (href.startsWith("mailto:") || href.startsWith("tel:")) return;
    try {
      const abs = new URL(href, url).toString();
      links.add(abs);
    } catch {}
  });

  return { text, links: [...links] };
}

export async function fetchAny(
  url: string,
  userAgent: string,
  timeoutMs: number
): Promise<{ status: number; finalUrl: string; bodyText: string; contentType: string }> {
  const { status, finalUrl, headers, bodyText } = await fetchTextWithRedirects(url, {
    userAgent,
    timeoutMs,
    accept: "*/*",
    maxRedirects: 5,
  });

  const contentType = (headers["content-type"] ?? "").toString();
  return { status, finalUrl, bodyText, contentType };
}
