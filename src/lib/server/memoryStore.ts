import type { PaperStore } from "./crawl";
import type { PaperRow } from "../types";
import type { VenueRules } from "../venue";

/** In-memory PaperStore with the same semantics as the Supabase one (tests + local test crawl). */
export class MemoryStore implements PaperStore {
  rows = new Map<number, PaperRow>();
  links = new Set<string>();
  private nextId = 1;
  constructor(public rules: VenueRules = { whitelistIssns: new Set(), allowedFieldIds: new Set() }) {}

  async venueRules() {
    return this.rules;
  }
  async findByDois(dois: string[]) {
    const set = new Set(dois);
    return [...this.rows.values()].filter((r) => r.doi && set.has(r.doi)).map((r) => ({ ...r }));
  }
  async findByTitleHashes(hashes: string[]) {
    const set = new Set(hashes);
    return [...this.rows.values()].filter((r) => set.has(r.title_hash)).map((r) => ({ ...r }));
  }
  async insert(rows: PaperRow[]) {
    return rows.map((r) => {
      if (r.doi && [...this.rows.values()].some((x) => x.doi === r.doi)) throw new Error(`duplicate key doi=${r.doi}`);
      const id = this.nextId++;
      this.rows.set(id, { ...r, id });
      return id;
    });
  }
  async update(rows: PaperRow[]) {
    for (const r of rows) {
      const cur = this.rows.get(r.id!);
      if (!cur) throw new Error(`no row ${r.id}`);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { label, labeled_at, score, first_seen_run_id, ...rest } = r;
      this.rows.set(r.id!, { ...cur, ...rest });
    }
  }
  async linkTopic(ids: number[], topicId: string) {
    for (const id of ids) this.links.add(`${id}:${topicId}`);
  }
}
