import { body, json, route } from "@/lib/server/http";
import { buildOpenAlexSearch, buildOpenAlexUrl, DEFAULT_OPENALEX_LOOKBACK_DAYS } from "@/lib/sources/openalex";
import { buildCrossrefSubqueries, buildCrossrefUrl } from "@/lib/sources/crossref";
import { buildEpmcQuery, buildEpmcUrl } from "@/lib/sources/europepmc";
import type { CrawlWindow, TopicGroup } from "@/lib/types";
import { addDays, toDate } from "@/lib/sources/http";

/** POST {blocks, exclude_terms} -> the query each source would receive (for an incremental run since yesterday). */
export const POST = route(async (req) => {
  const g = await body<Pick<TopicGroup, "blocks" | "exclude_terms">>(req);
  const group = { blocks: g.blocks ?? [], exclude_terms: g.exclude_terms ?? [] };
  const today = toDate(new Date());
  const w: CrawlWindow = { mode: "incremental", from: addDays(today, -1), to: today };
  const strip = (u: string) => u.replace(/([?&])mailto=[^&]*&?/, "$1").replace(/[?&]$/, "");
  return json({
    window: w,
    openalex: { query: buildOpenAlexSearch(group), url: strip(buildOpenAlexUrl(group, w, null, { lookbackDays: DEFAULT_OPENALEX_LOOKBACK_DAYS })) },
    crossref: (() => {
      const subs = buildCrossrefSubqueries(group);
      return { query: subs.map((q, i) => `${i + 1}. ${q}`).join("\n"), url: subs[0] ? strip(buildCrossrefUrl(subs[0], w)) : "" };
    })(),
    europepmc: { query: buildEpmcQuery(group, w), url: buildEpmcUrl(group, w, null) },
  });
});
