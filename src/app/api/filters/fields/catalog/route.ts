import { json, route } from "@/lib/server/http";
import { fieldCatalog } from "@/lib/sources/openalex";

export const GET = route(async () => json({ catalog: await fieldCatalog() }));
