import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

export type CollectorConfig = {
  user_agent: string;
  allowed_domains: string[];
  seed_urls: string[];
  rss_feeds: string[];
  sitemaps: string[];
  crawl: {
    max_depth: number;
    max_pages_per_run: number;
    per_domain_delay_ms: number;
    timeout_ms: number;
  };
  filter: {
    english_only?: boolean;
    canada_path_must_start_with?: string[];
    main_content_selectors?: string[];
    immigration_terms?: string[];

    drop_extensions: string[];
    drop_path_contains: string[];
    drop_query_params_prefix: string[];
    always_keep_contains: string[];

    score_threshold: number;

    score_rules: {
      domain_bonus: Record<string, number>;
      contains_bonus: Record<string, number>;
      contains_penalty: Record<string, number>;
    };
  };

  schedule?: {
    default_interval_hours?: number;
    rss_interval_hours?: number;
    sitemap_interval_hours?: number;
    trusted_interval_hours?: number;
    updates_interval_hours?: number;
    failed_retry_hours?: number;
    updates_url_contains?: string[];
  };
};

export function loadConfig(): CollectorConfig {
  const p = path.resolve(process.cwd(), "config/collector.config.yaml");
  const raw = fs.readFileSync(p, "utf-8");
  return yaml.load(raw) as CollectorConfig;
}
