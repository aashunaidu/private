import { CollectorConfig } from "./config.ts";
import { getDomain } from "./normalize.ts";

export function isEnglishAllowed(url: string, cfg: CollectorConfig): boolean {
  if (!cfg.filter.english_only) return true;

  const u = new URL(url);
  const host = u.host.toLowerCase();
  const path = u.pathname.toLowerCase();

  // Canada.ca: only /en/
  if (host === "www.canada.ca") return path.startsWith("/en/");

  // If you want strict English for ircc.canada.ca too, uncomment:
  // if (host.endsWith("ircc.canada.ca")) return !path.startsWith("/fr/");

  return true;
}

export function isAllowedCanadaPath(url: string, cfg: CollectorConfig): boolean {
  const domain = getDomain(url);
  if (domain !== "www.canada.ca") return true;

  const prefixes = cfg.filter.canada_path_must_start_with ?? [];
  if (prefixes.length === 0) return true;

  const u = new URL(url);
  return prefixes.some((p) => u.pathname.startsWith(p));
}

export function isTrustedSection(url: string): boolean {
  const lower = url.toLowerCase();

  // Justice Laws anchors (IRPA/IRPR)
  if (lower.includes("laws-lois.justice.gc.ca/eng/acts/i-2.5")) return true;
  if (lower.includes("laws-lois.justice.gc.ca/eng/regulations/sor-2002-227")) return true;

  // IRPA/IRPR PDFs you provided
  if (lower.includes("laws.justice.gc.ca/pdf/i-2.5")) return true;
  if (lower.includes("laws-lois.justice.gc.ca/pdf/sor-2002-227")) return true;

  // Gazette indicators
  if (lower.includes("gazette.gc.ca") && (lower.includes("sor-") || lower.includes("si-") || lower.includes("regulations")))
    return true;

  return false;
}

export function dropByExtensionOrPath(url: string, cfg: CollectorConfig): string | null {
  const lower = url.toLowerCase();

  for (const ext of cfg.filter.drop_extensions) {
    if (lower.endsWith(ext.toLowerCase())) return `dropped extension: ${ext}`;
  }
  for (const pat of cfg.filter.drop_path_contains) {
    if (lower.includes(pat.toLowerCase())) return `dropped path: ${pat}`;
  }
  return null;
}

export function scoreUrlOnly(url: string, cfg: CollectorConfig): { score: number; reason: string } {
  const domain = getDomain(url);
  const lower = url.toLowerCase();
  let score = 0;
  const reasons: string[] = [];

  // domain bonus (config)
  score += cfg.filter.score_rules.domain_bonus[domain] ?? 0;

  // +5 trusted IRPA/IRPR
  if (lower.includes("laws-lois.justice.gc.ca/eng/acts/i-2.5") || lower.includes("laws-lois.justice.gc.ca/eng/regulations/sor-2002-227")
    || lower.includes("laws.justice.gc.ca/pdf/i-2.5") || lower.includes("laws-lois.justice.gc.ca/pdf/sor-2002-227")) {
    score += 5;
    reasons.push("+5 trusted IRPA/IRPR");
  }

  // +5 Gazette regs
  if (domain === "gazette.gc.ca" && (lower.includes("sor-") || lower.includes("si-") || lower.includes("regulations"))) {
    score += 5;
    reasons.push("+5 trusted Gazette reg");
  }

  // +2 if ANY immigration term appears in URL
  const terms = cfg.filter.immigration_terms ?? [];
  if (terms.some((t) => lower.includes(t.toLowerCase()))) {
    score += 2;
    reasons.push("+2 url term match");
  }

  // legacy contains_bonus / penalty (still useful)
  for (const [needle, pts] of Object.entries(cfg.filter.score_rules.contains_bonus)) {
    if (lower.includes(needle.toLowerCase())) score += pts;
  }
  for (const [needle, pts] of Object.entries(cfg.filter.score_rules.contains_penalty)) {
    if (lower.includes(needle.toLowerCase())) score -= pts;
  }

  return { score, reason: reasons.join(", ") || "url score" };
}

export function scoreTextOnly(text: string, cfg: CollectorConfig): { score: number; reason: string } {
  const lower = (text || "").toLowerCase();
  const terms = cfg.filter.immigration_terms ?? [];
  if (terms.length === 0) return { score: 0, reason: "no terms configured" };

  // +2 if ANY term matches at least once
  const hit = terms.some((t) => lower.includes(t.toLowerCase()));
  return hit ? { score: 2, reason: "+2 page text term match" } : { score: 0, reason: "no page text match" };
}
