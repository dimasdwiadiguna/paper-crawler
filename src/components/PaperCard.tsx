"use client";

import { useState } from "react";
import { LABEL_NAMES, SOURCE_LABELS, type Label } from "@/lib/types";
import type { Paper } from "./paper";

export const LABEL_STYLES: Record<Label, { btn: string; dot: string; key: string }> = {
  relevant: {
    btn: "border-emerald-600/40 text-emerald-800 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950 data-[on=true]:bg-emerald-600 data-[on=true]:text-white",
    dot: "bg-emerald-500",
    key: "1",
  },
  close: {
    btn: "border-amber-600/40 text-amber-800 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950 data-[on=true]:bg-amber-500 data-[on=true]:text-white",
    dot: "bg-amber-500",
    key: "2",
  },
  not_related: {
    btn: "border-stone-400/60 text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800 data-[on=true]:bg-stone-600 data-[on=true]:text-white",
    dot: "bg-stone-400",
    key: "3",
  },
};

export function authorLine(authors: string[]): string {
  if (!authors.length) return "Unknown authors";
  return authors.length > 3 ? `${authors.slice(0, 3).join(", ")} et al.` : authors.join(", ");
}

export function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return null;
  const tone =
    score > 0.15
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
      : score > 0
        ? "bg-teal-50 text-teal-800 dark:bg-teal-950 dark:text-teal-300"
        : "bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400";
  return (
    <span title="Relevance score (TF-IDF similarity to your labels)" className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] tabular-nums ${tone}`}>
      {score >= 0 ? "+" : ""}
      {score.toFixed(2)}
    </span>
  );
}

export function LabelButtons({
  value,
  onLabel,
  size = "md",
}: {
  value: Label | null;
  onLabel: (l: Label) => void;
  size?: "md" | "lg";
}) {
  return (
    <div className={`grid grid-cols-3 ${size === "lg" ? "gap-2" : "gap-1.5"}`}>
      {(Object.keys(LABEL_NAMES) as Label[]).map((l) => (
        <button
          key={l}
          data-on={value === l}
          onClick={(e) => {
            e.stopPropagation();
            onLabel(l);
          }}
          className={`rounded-lg border font-medium transition ${LABEL_STYLES[l].btn} ${size === "lg" ? "py-3.5 text-base" : "px-2 py-1.5 text-sm"}`}
        >
          {LABEL_NAMES[l]}
          {size === "md" && <kbd className="ml-1.5 hidden font-mono text-[10px] opacity-50 lg:inline">{LABEL_STYLES[l].key}</kbd>}
        </button>
      ))}
    </div>
  );
}

export function PaperMeta({ p }: { p: Paper }) {
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-stone-600 dark:text-stone-400">
      <span className="font-medium text-stone-700 italic dark:text-stone-300">{p.journal ?? "Unknown venue"}</span>
      <span aria-hidden>·</span>
      <span>{p.year ?? "n.d."}</span>
      <span aria-hidden>·</span>
      <span className="capitalize">{p.type}</span>
    </div>
  );
}

export function PaperCard({
  p,
  showScore,
  onLabel,
  selected,
  expanded: expandedProp,
  onToggle,
  big,
  topicNames,
}: {
  p: Paper;
  showScore: boolean;
  onLabel: (l: Label) => void;
  selected?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  big?: boolean;
  topicNames?: Record<string, string>;
}) {
  const [localExpanded, setLocalExpanded] = useState(false);
  const expanded = expandedProp ?? localExpanded;
  const toggle = onToggle ?? (() => setLocalExpanded((x) => !x));
  return (
    <article
      className={`card p-4 ${selected ? "ring-2 ring-teal-600/60" : ""} ${big ? "md:p-6" : ""}`}
      data-paper-id={p.id}
    >
      <div className="flex items-start gap-3">
        <h2 className={`flex-1 font-serif leading-snug font-semibold text-pretty ${big ? "text-xl" : "text-[17px]"}`}>{p.title}</h2>
        {showScore && <ScoreBadge score={p.score} />}
      </div>
      <div className="mt-1.5">
        <PaperMeta p={p} />
      </div>
      <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">{authorLine(p.authors)}</p>

      {p.abstract ? (
        <button onClick={toggle} className="mt-3 block w-full text-left" aria-expanded={expanded}>
          <p className={`text-[15px] leading-relaxed text-stone-700 dark:text-stone-300 ${expanded ? "" : "line-clamp-4"}`}>{p.abstract}</p>
          {!expanded && <span className="mt-1 inline-block text-xs text-teal-700 dark:text-teal-400">Show more</span>}
        </button>
      ) : (
        <p className="mt-3 text-sm text-stone-400 italic">No abstract</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {p.doi && (
          <a
            href={`https://doi.org/${p.doi}`}
            target="_blank"
            rel="noreferrer noopener"
            onClick={(e) => e.stopPropagation()}
            className="mr-1 font-mono text-xs text-teal-700 underline decoration-teal-700/30 underline-offset-2 hover:decoration-teal-700 dark:text-teal-400"
          >
            doi:{p.doi}
          </a>
        )}
        {p.sources.map((s) => (
          <span key={s} className="chip">
            {SOURCE_LABELS[s]}
          </span>
        ))}
        {p.unclassified && <span className="chip" title="No OpenAlex field found">unclassified</span>}
        {p.status === "filtered" && <span className="chip bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300">filtered</span>}
        {topicNames &&
          p.topics.map((t) =>
            topicNames[t] ? (
              <span key={t} className="chip bg-teal-50 text-teal-800 dark:bg-teal-950 dark:text-teal-300">
                {topicNames[t]}
              </span>
            ) : null,
          )}
      </div>

      <div className="mt-4">
        <LabelButtons value={p.label} onLabel={onLabel} size={big ? "lg" : "md"} />
      </div>
    </article>
  );
}
