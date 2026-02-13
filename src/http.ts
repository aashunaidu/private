import { request } from "undici";

export type FetchResult = {
  status: number;
  finalUrl: string;
  headers: Record<string, string | string[] | undefined>;
  bodyText: string;
};

export async function fetchTextWithRedirects(
  url: string,
  opts: {
    userAgent: string;
    accept: string;
    timeoutMs: number;
    maxRedirects?: number;
  }
): Promise<FetchResult> {
  const maxRedirects = opts.maxRedirects ?? 5;

  let current = url;

  for (let i = 0; i <= maxRedirects; i++) {
    const res = await request(current, {
      headers: {
        "user-agent": opts.userAgent,
        "accept": opts.accept,
      },
      bodyTimeout: opts.timeoutMs,
    });

    const status = res.statusCode;
    const headers = res.headers as any;

    const location = (headers["location"] ?? "") as string;

    // handle redirects
    if ([301, 302, 303, 307, 308].includes(status) && location) {
      const next = new URL(location, current).toString();
      current = next;
      await res.body.text().catch(() => "");
      continue;
    }

    const bodyText = await res.body.text();
    return { status, finalUrl: current, headers, bodyText };
  }

  throw new Error(`Too many redirects: ${url}`);
}
