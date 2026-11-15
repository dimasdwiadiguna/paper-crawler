import { json, route } from "@/lib/server/http";
import { check, db } from "@/lib/server/db";

export const GET = route(async () => {
  const [journals, fields] = await Promise.all([
    db().from("journal_whitelist").select("*").order("name"),
    db().from("allowed_fields").select("*").order("name"),
  ]);
  return json({ journals: check(journals), fields: check(fields) });
});
