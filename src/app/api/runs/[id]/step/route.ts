import { body, json, route } from "@/lib/server/http";
import { runStep } from "@/lib/server/crawl";

// One page of one (topic, source): a few seconds normally, far inside Vercel Hobby's limit.
export const maxDuration = 60;

export const POST = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const { id } = await params;
  const b = await body<{ pair: number; page: number; cursor: string | null; fetchedSoFar: number }>(req);
  return json(
    await runStep({
      runId: Number(id),
      pair: Number(b.pair),
      page: Number(b.page) || 1,
      cursor: b.cursor ?? null,
      fetchedSoFar: Number(b.fetchedSoFar) || 0,
    }),
  );
});
