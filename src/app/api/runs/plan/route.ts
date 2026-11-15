import { json, route } from "@/lib/server/http";
import { DEFAULT_CAP, planRun } from "@/lib/server/crawl";
import { DEFAULT_OPENALEX_LOOKBACK_DAYS } from "@/lib/sources/openalex";

export const GET = route(async () => json({ topics: await planRun(), defaults: { cap: DEFAULT_CAP, lookbackDays: DEFAULT_OPENALEX_LOOKBACK_DAYS } }));
