"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, qs } from "@/components/api";
import { PaperCard } from "@/components/PaperCard";
import { SwipeCard } from "@/components/SwipeCard";
import type { Paper, TopicMeta } from "@/components/paper";
import { LABEL_NAMES, PAPER_TYPES, SOURCE_LABELS, SOURCES, type Label } from "@/lib/types";

interface ListResponse {
  papers: Paper[];
  total: number;
  labels: number;
  coldStart: boolean;
}

interface Toast {
  paper: Paper;
  index: number;
  label: Label;
  error?: string;
}

const PAGE = 60;

export default function InboxPage() {
  const [papers, setPapers] = useState<Paper[]>([]);
  const [total, setTotal] = useState(0);
  const [coldStart, setColdStart] = useState(true);
  const [index, setIndex] = useState(0);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [topics, setTopics] = useState<TopicMeta[]>([]);
  const [filters, setFilters] = useState({ topic: "", source: "", type: "", hasAbstract: false, showFiltered: false });
  const [toast, setToast] = useState<Toast | null>(null);
  const [reranked, setReranked] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingMore = useRef(false);

  const query = useCallback(
    (offset: number) =>
      `/api/papers${qs({ view: "inbox", ...filters, limit: PAGE, offset })}`,
    [filters],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api<ListResponse>(query(0));
      setPapers(r.papers);
      setTotal(r.total);
      setColdStart(r.coldStart);
      setIndex(0);
      setReranked(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api<{ topics: TopicMeta[] }>("/api/meta").then((r) => setTopics(r.topics)).catch(() => {});
  }, []);

  // Fetch the next page when the list runs low. Labeled papers drop out server-side,
  // so the next page starts at the number of papers still in the list.
  useEffect(() => {
    if (loading || loadingMore.current || papers.length >= total || papers.length - index > 10) return;
    loadingMore.current = true;
    api<ListResponse>(query(papers.length))
      .then((r) => {
        setPapers((ps) => {
          const seen = new Set(ps.map((p) => p.id));
          return [...ps, ...r.papers.filter((p) => !seen.has(p.id))];
        });
        setTotal(r.total);
      })
      .catch(() => {})
      .finally(() => (loadingMore.current = false));
  }, [index, papers.length, total, loading, query]);

  const scheduleRescore = useCallback(() => {
    if (scoreTimer.current) clearTimeout(scoreTimer.current);
    scoreTimer.current = setTimeout(async () => {
      try {
        await api("/api/scores", { body: {} });
        setReranked(true);
      } catch {
        /* ignore; next run recomputes */
      }
    }, 6000);
  }, []);

  const showToast = useCallback((t: Toast) => {
    setToast(t);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), t.error ? 8000 : 6000);
  }, []);

  const label = useCallback(
    async (l: Label, at = index) => {
      const p = papers[at];
      if (!p) return;
      setPapers((ps) => ps.filter((x) => x.id !== p.id));
      setTotal((t) => Math.max(0, t - 1));
      setIndex((i) => Math.max(0, Math.min(i, papers.length - 2)));
      setExpanded(null);
      showToast({ paper: p, index: at, label: l });
      try {
        await api(`/api/papers/${p.id}/label`, { body: { label: l } });
        scheduleRescore();
      } catch (e) {
        // roll back
        setPapers((ps) => [...ps.slice(0, at), p, ...ps.slice(at)]);
        setTotal((t) => t + 1);
        showToast({ paper: p, index: at, label: l, error: (e as Error).message });
      }
    },
    [index, papers, scheduleRescore, showToast],
  );

  const undo = useCallback(async () => {
    if (!toast || toast.error) return;
    const { paper, index: at } = toast;
    setToast(null);
    setPapers((ps) => [...ps.slice(0, at), paper, ...ps.slice(at)]);
    setTotal((t) => t + 1);
    setIndex(at);
    try {
      await api(`/api/papers/${paper.id}/label`, { body: { label: null } });
      scheduleRescore();
    } catch (e) {
      setPapers((ps) => ps.filter((x) => x.id !== paper.id));
      showToast({ ...toast, error: `Undo failed: ${(e as Error).message}` });
    }
  }, [toast, scheduleRescore, showToast]);

  // Keyboard shortcuts (laptop): 1/2/3 label, j/k move, o open DOI, space/enter expand, u undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
      const p = papers[index];
      switch (e.key) {
        case "1":
          label("relevant");
          break;
        case "2":
          label("close");
          break;
        case "3":
          label("not_related");
          break;
        case "j":
        case "ArrowDown":
          setIndex((i) => Math.min(i + 1, papers.length - 1));
          break;
        case "k":
        case "ArrowUp":
          setIndex((i) => Math.max(i - 1, 0));
          break;
        case "o":
          if (p?.doi) window.open(`https://doi.org/${p.doi}`, "_blank", "noopener");
          break;
        case "Enter":
        case " ":
          if (p) setExpanded((x) => (x === p.id ? null : p.id));
          break;
        case "u":
          undo();
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [papers, index, label, undo]);

  useEffect(() => {
    const p = papers[index];
    if (!p) return;
    document.querySelector(`[data-list] [data-paper-id="${p.id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [index, papers]);

  const topicNames = Object.fromEntries(topics.map((t) => [t.id, t.name]));
  const current = papers[index];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-serif text-2xl font-semibold">
          Inbox <span className="text-base font-normal text-stone-500 tabular-nums">{loading ? "" : total}</span>
        </h1>
        <div className="flex items-center gap-2">
          {reranked && (
            <button className="btn text-xs" onClick={load}>
              Scores updated · re-rank
            </button>
          )}
          {coldStart && !loading && (
            <span className="text-xs text-stone-500">Label 5+ papers to turn on ranking</span>
          )}
        </div>
      </div>

      <div className="mb-4">
        <button className="text-sm text-stone-600 md:hidden dark:text-stone-400" onClick={() => setShowFilters((x) => !x)}>
          {showFilters ? "Hide filters" : "Filters"}
        </button>
        <div className={`${showFilters ? "grid" : "hidden"} mt-2 grid-cols-2 gap-2 md:mt-0 md:flex md:flex-wrap md:items-center`}>
          <select className="input md:w-auto" value={filters.topic} onChange={(e) => setFilters({ ...filters, topic: e.target.value })}>
            <option value="">All topics</option>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select className="input md:w-auto" value={filters.source} onChange={(e) => setFilters({ ...filters, source: e.target.value })}>
            <option value="">All sources</option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABELS[s]}
              </option>
            ))}
          </select>
          <select className="input md:w-auto" value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}>
            <option value="">All types</option>
            {PAPER_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={filters.hasAbstract} onChange={(e) => setFilters({ ...filters, hasAbstract: e.target.checked })} />
            Has abstract
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={filters.showFiltered} onChange={(e) => setFilters({ ...filters, showFiltered: e.target.checked })} />
            Show filtered
          </label>
          <span className="hidden text-xs text-stone-400 lg:ml-auto lg:inline">
            <kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd> label · <kbd>j</kbd>/<kbd>k</kbd> move · <kbd>o</kbd> open · <kbd>space</kbd> expand · <kbd>u</kbd> undo
          </span>
        </div>
      </div>

      {error && <p className="card border-red-300 p-4 text-sm text-red-700">{error}</p>}
      {loading && <p className="text-sm text-stone-500">Loading…</p>}
      {!loading && !error && !papers.length && (
        <div className="card p-8 text-center">
          <p className="font-serif text-lg">Inbox zero.</p>
          <p className="mt-1 text-sm text-stone-500">
            Start a crawl on the <a className="text-teal-700 underline" href="/runs">Runs</a> page.
          </p>
        </div>
      )}

      {/* Phone: one card at a time with swipe gestures */}
      {current && (
        <div className="md:hidden">
          <SwipeCard key={current.id} onSwipe={(l) => label(l)}>
            <PaperCard p={current} big showScore={!coldStart} onLabel={(l) => label(l)} topicNames={topicNames} />
          </SwipeCard>
          <div className="mt-3 flex items-center justify-between text-xs text-stone-500">
            <button className="btn" disabled={index === 0} onClick={() => setIndex(index - 1)}>
              ← Prev
            </button>
            <span>
              {index + 1} / {total} · swipe → relevant, ← not related, ↑ close
            </span>
            <button className="btn" disabled={index >= papers.length - 1} onClick={() => setIndex(index + 1)}>
              Next →
            </button>
          </div>
        </div>
      )}

      {/* Laptop: dense list */}
      <div className="hidden space-y-2 md:block" data-list>
        {papers.map((p, i) => (
          <div key={p.id} onClick={() => setIndex(i)}>
            <PaperCard
              p={p}
              showScore={!coldStart}
              selected={i === index}
              expanded={expanded === p.id}
              onToggle={() => setExpanded(expanded === p.id ? null : p.id)}
              onLabel={(l) => label(l, i)}
              topicNames={topicNames}
            />
          </div>
        ))}
      </div>

      {toast && (
        <div className="fixed inset-x-0 bottom-20 z-40 flex justify-center px-4 md:bottom-6">
          <div className="flex max-w-md items-center gap-3 rounded-xl bg-stone-900 px-4 py-3 text-sm text-white shadow-lg dark:bg-stone-100 dark:text-stone-900">
            <span className="line-clamp-1">
              {toast.error ? `Couldn't save: ${toast.error}` : `${LABEL_NAMES[toast.label]} · ${toast.paper.title}`}
            </span>
            {!toast.error && (
              <button onClick={undo} className="shrink-0 font-semibold text-teal-300 dark:text-teal-700">
                Undo
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
