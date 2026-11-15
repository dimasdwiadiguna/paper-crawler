import { body, json, route } from "@/lib/server/http";
import { check, db } from "@/lib/server/db";
import { LABELS, type Label } from "@/lib/types";

export const POST = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const { id } = await params;
  const { label } = await body<{ label: Label | null }>(req);
  if (label !== null && !LABELS.includes(label)) return json({ error: "Invalid label" }, 400);
  const row = check(
    await db()
      .from("papers")
      .update({ label, labeled_at: label ? new Date().toISOString() : null})
      .eq("id", Number(id))
      .select("id,label,labeled_at")
      .single(),
  );
  return json(row);
});
