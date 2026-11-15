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
        const page = await fetchSourcePage(source, topic, window, null);
        const { kept } = matchAndCollapse(page.records, topic);
        return { source, total: page.total, sampled: page.records.length + page.skipped, matched: kept.length, error: null };
      } catch (e) {
        return { source, total: null, sampled: 0, matched: 0, error: (e as Error).message };
      }
    }),
  );
  return json({ window, results });
});
