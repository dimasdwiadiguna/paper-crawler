import { body, json, route } from "@/lib/server/http";
import { check, db } from "@/lib/server/db";
import { cleanTopicInput } from "@/lib/server/topics";
import { getTopic } from "@/lib/server/repo";
import type { TopicGroup } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (_req, { params }) => {
  const { id } = await params;
  const topic = await getTopic(id);
  if (!topic) return json({ error: "Not found" }, 404);
  const cursors = check(await db().from("source_cursors").select("*").eq("topic_group_id", id));
  return json({ topic, cursors });
});

export const PATCH = route<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const input = cleanTopicInput(await body<Partial<TopicGroup>>(req));
  const row = check(await db().from("topic_groups").update(input).eq("id", id).select("*").single());
  return json(row);
});

export const DELETE = route<Ctx>(async (_req, { params }) => {
  const { id } = await params;
  check(await db().from("topic_groups").delete().eq("id", id));
  return json({ ok: true });
});
