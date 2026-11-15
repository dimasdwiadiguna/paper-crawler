import { body, json, route } from "@/lib/server/http";
import { check, db } from "@/lib/server/db";
import { createRun } from "@/lib/server/crawl";

export const GET = route(async () => {
  const runs = check(
    await db().from("runs").select("id,started_at,finished_at,status,summary,params->cap,params->lookbackDays").order("id", { ascending: false }).limit(30),
  );
  return json({ runs });
});

export const POST = route(async (req) => {
  const input = await body<{ ranges?: Record<string, { from: string; to: string }>; cap?: number; lookbackDays?: number }>(req);
  for (const r of Object.values(input.ranges ?? {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.from) || !/^\d{4}-\d{2}-\d{2}$/.test(r.to) || r.from > r.to) {
      return json({ error: "Invalid date range" }, 400);
    }
  }
  return json(await createRun(input));
});
