/**
 * Real test crawl against the live APIs, without a database: runs the exact per-page pipeline the
 * app uses (fetch → local boolean match → OpenAlex field lookup → venue rule → dedupe/merge) into an
 * in-memory store, and prints per-source counts.
 *
 *   npx tsx scripts/test-crawl.ts [days=30] [cap=500] [--incremental]
 *
 * --incremental simulates a later run whose cursor is `days` ago ("added since"), instead of a first run.
 */
import { DEFAULT_CAP, processPage, type StepCounts } from "../src/lib/server/crawl";
import { writeFileSync } from "node:fs";
import { MemoryStore } from "../src/lib/server/memoryStore";
import { DEFAULT_OPENALEX_LOOKBACK_DAYS } from "../src/lib/sources/openalex";
import { SOURCE_LABELS, SOURCES, type CrawlWindow, type TopicGroup } from "../src/lib/types";

const seed: TopicGroup = {
  id: "seed",
  name: "Soft sensor for fermentation monitoring",
  active: true,
  blocks: [
    ["soft sensor", "software sensor", "virtual sensor", "state estimation", "state observer", "Kalman filter", "hybrid model", "grey-box model"],
    ["fermentation", "bioprocess", "bioreactor", "cultivation", "fed-batch", "cell culture"],
  ],
  exclude_terms: [],
};

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const days = Number(args[0] ?? 30);
  const cap = Number(args[1] ?? DEFAULT_CAP);
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const incremental = process.argv.includes("--incremental");
  const window: CrawlWindow = { mode: incremental ? "incremental" : "initial", from, to };
  const store = new MemoryStore();
  console.log(
    `Topic: ${seed.name}\nWindow: ${incremental ? `added since ${from} (incremental)` : `published ${from} → ${to} (first run)`}, cap ${cap} per source\n`,
  );

  const rows: (StepCounts & { source: string; pages: number; total: number | null; capHit: boolean; errors: string[]; ms: number })[] = [];
  for (const source of SOURCES) {
    const t0 = Date.now();
    const agg = { source: SOURCE_LABELS[source], fetched: 0, nomatch: 0, new: 0, dupes: 0, filtered: 0, pages: 0, total: null as number | null, capHit: false, errors: [] as string[], ms: 0 };
    let cursor: string | null = null;
    let maxStepMs = 0;
    const totals = new Map<string, number>(); // Crossref: hits per sub-query
    for (let page = 1; ; page++) {
      const s0 = Date.now();
      const r = await processPage({ topic: seed, pair: { source, window }, cursor, fetchedSoFar: agg.fetched, runId: 1, cap, lookbackDays: DEFAULT_OPENALEX_LOOKBACK_DAYS, store });
      maxStepMs = Math.max(maxStepMs, Date.now() - s0);
      agg.pages = page;
      agg.fetched += r.fetched;
      agg.nomatch += r.nomatch;
      agg.new += r.new;
      agg.dupes += r.dupes;
      agg.filtered += r.filtered;
      if (r.total !== null) totals.set(r.label ?? "", r.total);
      agg.total = [...totals.values()].reduce((a, b) => a + b, 0);
      agg.capHit ||= r.capHit;
      if (r.error) agg.errors.push(r.error);
      if (r.warning) agg.errors.push(r.warning);
      process.stdout.write(`  ${agg.source} · page ${page}${r.label ? ` (${r.label})` : ""} · ${agg.new} new (${Date.now() - s0} ms)\n`);
      if (r.done) break;
      cursor = r.nextCursor;
    }
    agg.ms = maxStepMs;
    rows.push(agg);
  }

  console.log("\nPer-source counts");
  console.table(
    rows.map((r) => ({
      source: r.source,
      "source hits": r.total,
      pages: r.pages,
      fetched: r.fetched,
      "no match": r.nomatch,
      new: r.new,
      dupes: r.dupes,
      filtered: r.filtered,
      "cap hit": r.capHit,
      "slowest step ms": r.ms,
      errors: r.errors.length ? r.errors.join("; ").slice(0, 120) : "",
    })),
  );
  const all = [...store.rows.values()];
  const by = (k: (p: (typeof all)[number]) => string) => all.reduce<Record<string, number>>((m, p) => ((m[k(p)] = (m[k(p)] ?? 0) + 1), m), {});
  console.log(`Unique papers stored: ${all.length}`);
  console.log("Found by n sources:", by((p) => String(p.sources.length)));
  console.log("Types:", by((p) => p.type));
  console.log("With abstract:", all.filter((p) => p.abstract).length, "· unclassified (no OpenAlex field):", all.filter((p) => p.unclassified).length);
  const out = process.argv.find((a) => a.startsWith("--out="))?.slice(6);
  if (out) writeFileSync(out, JSON.stringify(all.map((p) => ({ ...p, topics: ["seed"] })), null, 1));
  console.log("\nSample:");
  for (const p of all.slice(0, 8)) console.log(` - [${p.sources.join("+")}] ${p.title.slice(0, 100)} (${p.journal ?? "?"}, ${p.year})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
