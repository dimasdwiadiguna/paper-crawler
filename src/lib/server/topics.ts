import type { TopicGroup } from "../types";

/** Validate/clean a topic group payload from the client. */
export function cleanTopicInput(b: Partial<TopicGroup>): Partial<TopicGroup> {
  const out: Partial<TopicGroup> = {};
  if (typeof b.name === "string") {
    const n = b.name.trim();
    if (!n) throw new Error("Name is required");
    out.name = n.slice(0, 200);
  }
  if (Array.isArray(b.blocks)) {
    out.blocks = b.blocks
      .filter(Array.isArray)
      .map((blk) => [...new Set(blk.map((t) => String(t).trim()).filter(Boolean))].slice(0, 100))
      .filter((blk) => blk.length)
      .slice(0, 10);
  }
  if (Array.isArray(b.exclude_terms)) {
    out.exclude_terms = [...new Set(b.exclude_terms.map((t) => String(t).trim()).filter(Boolean))].slice(0, 200);
  }
  if (typeof b.active === "boolean") out.active = b.active;
  return out;
}
