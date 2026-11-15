import { json, route } from "@/lib/server/http";
import { listTopics } from "@/lib/server/repo";

export const GET = route(async () => {
  const topics = await listTopics();
  return json({ topics: topics.map((t) => ({ id: t.id, name: t.name, active: t.active })) });
});
