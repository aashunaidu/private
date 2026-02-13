import { XMLParser } from "fast-xml-parser";
import { fetchTextWithRedirects } from "../http.ts";

function looksLikeXml(s: string): boolean {
  const t = s.trim();
  return t.startsWith("<?xml") || t.startsWith("<rss") || t.startsWith("<feed") || t.startsWith("<rdf:RDF");
}

export async function discoverFromRss(
  feedUrl: string,
  userAgent: string,
  timeoutMs: number
): Promise<string[]> {
  const { status, headers, bodyText, finalUrl } = await fetchTextWithRedirects(feedUrl, {
    userAgent,
    timeoutMs,
    accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9,*/*;q=0.8",
    maxRedirects: 5,
  });

  if (status < 200 || status >= 400) {
    console.warn("[rss] http", status, feedUrl);
    return [];
  }

  const ct = (headers["content-type"] ?? "").toString().toLowerCase();

  if (!ct.includes("xml") && !looksLikeXml(bodyText)) {
    const preview = bodyText.trim().slice(0, 220).replace(/\s+/g, " ");
    console.warn("[rss] not xml:", { feedUrl, finalUrl, contentType: ct, preview });
    return [];
  }

  try {
    const parser = new XMLParser({ ignoreAttributes: false });
    const xml = parser.parse(bodyText);

    const links: string[] = [];

    // RSS 2.0
    const items = xml?.rss?.channel?.item;
    if (Array.isArray(items)) {
      for (const it of items) {
        if (typeof it?.link === "string") links.push(it.link);
      }
    }

    // Atom
    const atomEntries = xml?.feed?.entry;
    if (Array.isArray(atomEntries)) {
      for (const e of atomEntries) {
        const l = e?.link;
        // can be array or object
        if (Array.isArray(l)) {
          for (const one of l) {
            if (typeof one?.["@_href"] === "string") links.push(one["@_href"]);
          }
        } else {
          if (typeof l?.["@_href"] === "string") links.push(l["@_href"]);
        }
      }
    }

    return links;
  } catch (e) {
    const preview = bodyText.trim().slice(0, 220).replace(/\s+/g, " ");
    console.warn("[rss] parse failed:", { feedUrl, finalUrl, contentType: ct, preview });
    return [];
  }
}
