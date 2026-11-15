import { body, json, route } from "@/lib/server/http";
import { check, db } from "@/lib/server/db";

export const POST = route(async (req) => {
  const b = await body<{ id: string; name: string; level: "field" | "subfield" }>(req);
  if (!/^(fields|subfields)\/\d+$/.test(b.id ?? "") || !b.name) return json({ error: "Invalid field" }, 400);
  const level = b.id.startsWith("subfields/") ? "subfield" : "field";
  return json(check(await db().from("allowed_fields").upsert({ openalex_id: b.id, name: b.name, level }).select("*").single()));
});

export const DELETE = route(async (req) => {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return json({ error: "id required" }, 400);
  check(await db().from("allowed_fields").delete().eq("openalex_id", id));
  return json({ ok: true });
});
