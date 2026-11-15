import { body, json, route } from "@/lib/server/http";
import { check, db } from "@/lib/server/db";
import { autocompleteSources, getSource } from "@/lib/sources/openalex";

/** GET ?q= -> OpenAlex sources autocomplete */
export const GET = route(async (req) => {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 2) return json({ results: [] });
  return json({ results: await autocompleteSources(q) });
});

/** POST {openalexId} -> look up ISSN-L + ISSNs and add to the whitelist */
export const POST = route(async (req) => {
  const { openalexId } = await body<{ openalexId: string }>(req);
  if (!openalexId) return json({ error: "openalexId required" }, 400);
  const s = await getSource(openalexId);
  if (!s.issn_l) return json({ error: `${s.name} has no ISSN-L in OpenAlex` }, 400);
  const row = check(
    await db()
      .from("journal_whitelist")
      .upsert({ issn_l: s.issn_l, name: s.name, issns: s.issns, openalex_id: s.id }, { onConflict: "issn_l" })
      .select("*")
      .single(),
  );
  return json(row);
});

export const DELETE = route(async (req) => {
  const issn = req.nextUrl.searchParams.get("issn_l");
  if (!issn) return json({ error: "issn_l required" }, 400);
  check(await db().from("journal_whitelist").delete().eq("issn_l", issn));
  return json({ ok: true });
});
