"use client";

import { useCallback, useEffect, useState } from "react";
import { api, qs } from "@/components/api";
import { LabelButtons, PaperMeta, authorLine } from "@/components/PaperCard";
import type { Paper, TopicMeta } from "@/components/paper";
import { LABEL_NAMES, LABELS, PAPER_TYPES, type Label } from "@/lib/types";

const PAGE = 50;

export default function LibraryPage() {
  const [f, setF] = useState({ q: "", label: "", topic: "", yearFrom: "", yearTo: "", journal: "", type: "" });
  const [applied, setApplied] = useState(f);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [topics, setTopics] = useState<TopicMeta[]>([]);
  const [open, setOpen] = useState<number | null>(null);

  const fetchPage = useCallback(
    async (offset: number) => {
      setLoading(true);
      setError(null);
      try {
        const r = await api<{ papers: Paper[]; total: number }>(`/api/papers${qs({ view: "library", ...applied, limit: PAGE, offset })}`);
        setPapers((ps) => (offset ? [...ps, ...r.papers] : r.papers));
        setTotal(r.total);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [applied],
  );

  useEffect(() => {
    fetchPage(0);
  }, [fetchPage]);
  useEffect(() => {
    api<{ topics: TopicMeta[] }>("/api/meta").then((r) => setTopics(r.topics)).catch(() => {});
  }, []);
  // Debounce typing; selects apply immediately.
  useEffect(() => {
    const t = setTimeout(() => setApplied(f), 350);
    return () => clearTimeout(t);
  }, [f]);

  const relabel = async (p: Paper, l: Label) => {
    const prev = p.label;
    setPapers((ps) => ps.map((x) => (x.id === p.id ? { ...x, label: l } : x)));
    try {
      await api(`/api/papers/${p.id}/label`, { body: { label: l } });
      api("/api/scores", { body: {} }).catch(() => {});
    } catch (e) {
      setPapers((ps) => ps.map((x) => (x.id === p.id ? { ...x, label: prev } : x)));
      alert(`Couldn't save: ${(e as Error).message}`);
    }
  };

  const unlabel = async (p: Paper) => {
    if (!confirm("Move this paper back to the inbox?")) return;
    await api(`/api/papers/${p.id}/label`, { body: { label: null } });
    setPapers((ps) => ps.filter((x) => x.id !== p.id));
    setTotal((t) => t - 1);
  };

  const dot = { relevant: "bg-emerald-500", close: "bg-amber-500", not_related: "bg-stone-400" };

  return (
    <div>
      <h1 className="mb-3 font-serif text-2xl font-semibold">
        Library <span className="text-base font-normal text-stone-500 tabular-nums">{total}</span>
      </h1>
      <div className="card mb-4 grid grid-cols-2 gap-2 p-3 md:grid-cols-6">
        <input
          className="input col-span-2 md:col-span-6"
          placeholder='Search title, abstract, authors — e.g. kalman "fed-batch" -yeast'
          value={f.q}
          onChange={(e) => setF({ ...f, q: e.target.value })}
        />
        <select className="input" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })}>
          <option value="">All labels</option>
          {LABELS.map((l) => (
            <option key={l} value={l}>
              {LABEL_NAMES[l]}
            </option>
          ))}
        </select>
        <select className="input" value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })}>
          <option value="">All topics</option>
          {topics.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
          <option value="">All types</option>
          {PAPER_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <input className="input" placeholder="Journal" value={f.journal} onChange={(e) => setF({ ...f, journal: e.target.value })} />
        <input className="input" inputMode="numeric" placeholder="Year from" value={f.yearFrom} onChange={(e) => setF({ ...f, yearFrom: e.target.value })} />
        <input className="input" inputMode="numeric" placeholder="Year to" value={f.yearTo} onChange={(e) => setF({ ...f, yearTo: e.target.value })} />
      </div>

      {error && <p className="card p-4 text-sm text-red-700">{error}</p>}
      {!loading && !papers.length && !error && <p className="text-sm text-stone-500">No labeled papers match.</p>}

      <ul className="card divide-y divide-stone-200 dark:divide-stone-800">
        {papers.map((p) => (
          <li key={p.id} className="p-3 md:p-4">
            <div className="flex items-start gap-2.5">
              <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${p.label ? dot[p.label] : ""}`} title={p.label ? LABEL_NAMES[p.label] : ""} />
              <div className="min-w-0 flex-1">
                <button className="text-left font-serif leading-snug font-semibold" onClick={() => setOpen(open === p.id ? null : p.id)}>
                  {p.title}
                </button>
                <PaperMeta p={p} />
                <p className="text-sm text-stone-500">{authorLine(p.authors)}</p>
                {open === p.id && (
                  <div className="mt-2 space-y-3">
                    <p className="text-[15px] leading-relaxed text-stone-700 dark:text-stone-300">{p.abstract ?? <em className="text-stone-400">No abstract</em>}</p>
                    {p.doi && (
                      <a className="font-mono text-xs text-teal-700 underline dark:text-teal-400" href={`https://doi.org/${p.doi}`} target="_blank" rel="noreferrer noopener">
                        doi:{p.doi}
                      </a>
                    )}
                    <div className="max-w-sm">
                      <LabelButtons value={p.label} onLabel={(l) => relabel(p, l)} />
                    </div>
                    <button className="text-xs text-stone-500 underline" onClick={() => unlabel(p)}>
                      Remove label (back to inbox)
                    </button>
                  </div>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {papers.length < total && (
        <div className="mt-4 text-center">
          <button className="btn" disabled={loading} onClick={() => fetchPage(papers.length)}>
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
