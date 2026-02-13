export function getDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function normalizeUrl(
  url: string,
  dropQueryPrefixes: string[]
): string | null {
  try {
    const u = new URL(url);

    // force https
    u.protocol = "https:";

    // remove fragment
    u.hash = "";

    // remove tracking query params
    for (const key of [...u.searchParams.keys()]) {
      if (dropQueryPrefixes.some((p) => key.startsWith(p))) {
        u.searchParams.delete(key);
      }
    }

    // normalize trailing slash (if not a file)
    if (!u.pathname.endsWith("/") && !u.pathname.includes(".")) {
      u.pathname += "/";
    }

    return u.toString();
  } catch {
    return null;
  }
}


