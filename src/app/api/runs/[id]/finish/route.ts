import { json, route } from "@/lib/server/http";
import { finishRun } from "@/lib/server/crawl";

export const maxDuration = 60;

export const POST = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const { id } = await params;
  return json({ summary: await finishRun(Number(id)) });
});
