import { json, route } from "@/lib/server/http";
import { recomputeScores } from "@/lib/server/scores";

export const maxDuration = 60;
export const POST = route(async () => json(await recomputeScores()));
