import type { Field, Label, PaperType, SourceName } from "@/lib/types";

export interface Paper {
  id: number;
  doi: string | null;
  title: string;
  abstract: string | null;
  authors: string[];
  journal: string | null;
  issn_l: string | null;
  pub_date: string | null;
  year: number | null;
  type: PaperType;
  fields: Field[] | null;
  unclassified: boolean;
  sources: SourceName[];
  status: "active" | "filtered";
  label: Label | null;
  labeled_at: string | null;
  score: number | null;
  first_seen_run_id: number | null;
  topics: string[];
}

export interface TopicMeta {
  id: string;
  name: string;
  active: boolean;
}
