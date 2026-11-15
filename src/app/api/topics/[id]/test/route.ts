import { body, json, route } from "@/lib/server/http";
import { getTopic } from "@/lib/server/repo";
import { fetchSourcePage, matchAndCollapse } from "@/lib/server/crawl";
import { SOURCES, type TopicGroup } from "@/lib/types";

export const maxDuration = 60;

/**
 * Test a topic's queries without saving anything: for each source, the source's own hit count
 * plus how many of the first page pass the local boolean matcher. Uses unsaved edits if sent.
 */
export const POST = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const { id } = await params;
  const b = await body<{ from: string; to: string; blocks?: string[][]; exclude_terms?: string[] }>(req);
  const saved = await getTopic(id);
  if (!saved) return json({ error: "Not found" }, 404);
  const topic: TopicGroup = { ...saved, blocks: b.blocks ?? saved.blocks, exclude_terms: b.exclude_terms ?? saved.exclude_terms };
  const window = { mode: "initial" as const, from: b.from, to: b.to };
  const results = await Promise.all(
    SOURCES.map(async (source) => {
      try {
        if (source !== "crossref") {
          const page = await fetchSourcePage(source, topic, window, null);
          const { kept } = matchAndCollapse(page.records, topic);
          return { source, total: page.total, sampled: page.records.length + page.skipped, matched: kept.length, error: null };
        }
        // Crossref: the first page (20 results) of every sub-query; "hits" is summed over sub-queries.
        let cursor: string | null = null;
        let total = 0;
        let sampled = 0;
        const matched = new Set<string>();
        for (let i = 0; i < 20; i++) {
          const page = await fetchSourcePage(source, topic, window, cursor, undefined, 1);
          total += page.total ?? 0;
          sampled += page.records.length + page.skipped;
          for (const p of matchAndCollapse(page.records, topic).kept) matched.add(p.doi ?? p.title);
          cursor = page.nextCursor;
          if (!cursor) break;
        }
        return { source, total, sampled, matched: matched.size, error: null };
      } catch (e) {
        return { source, total: null, sampled: 0, matched: 0, error: (e as Error).message };
      }
    }),
  );
  return json({ window, results });
});
