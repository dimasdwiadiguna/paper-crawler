import { body, json, route } from "@/lib/server/http";
import { check, db } from "@/lib/server/db";
import { cleanTopicInput } from "@/lib/server/topics";
import type { TopicGroup } from "@/lib/types";

export const GET = route(async () => {
  const topics = check(await db().from("topic_groups").select("*").order("created_at")) as TopicGroup[];
  const cursors = check(await db().from("source_cursors").select("*")) as { topic_group_id: string; source: string; last_until: string }[];
  const counts = await Promise.all(
    topics.map(async (t) => {
      const r = await db().from("paper_topics").select("paper_id", { count: "exact", head: true }).eq("topic_group_id", t.id);
      return r.count ?? 0;
    }),
  );
  return json({
    topics: topics.map((t, i) => ({
      ...t,
      papers: counts[i],
      cursors: cursors.filter((c) => c.topic_group_id === t.id),
    })),
  });
});

export const POST = route(async (req) => {
  const input = cleanTopicInput(await body<Partial<TopicGroup>>(req));
  if (!input.name) return json({ error: "Name is required" }, 400);
  const row = check(
    await db()
      .from("topic_groups")
      .insert({ name: input.name, blocks: input.blocks ?? [[]], exclude_terms: input.exclude_terms ?? [], active: input.active ?? true })
      .select("*")
      .single(),
  );
  return json(row);
});
