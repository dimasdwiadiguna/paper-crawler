"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/components/api";
import { SOURCE_LABELS, SOURCES, type SourceName, type TopicGroup } from "@/lib/types";

interface Preview {
  window: { from: string; to: string };
  openalex: { query: string; url: string };
  crossref: { query: string; url: string };
  europepmc: { query: string; url: string };
}
interface TestResult {
  source: SourceName;
  total: number | null;
  sampled: number;
  matched: number;
  error: string | null;
}
interface Stat {
  term: string;
  z: number;
  inTarget: number;
  inReference: number;
  wouldRemove?: number;
}
interface Suggestions {
  ready: boolean;
  counts: { notRelated: number; positive: number; relevant: number; inbox: number };
  need?: number;
  exclude: Stat[];
  synonyms: Stat[];
}

const toLines = (terms: string[]) => terms.join("\n");
const fromLines = (s: string) =>
  s
    .split("\n")
    .map((t) => t.trim())
    .filter(Boolean);

const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

export default function TopicPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [topic, setTopic] = useState<TopicGroup | null>(null);
  const [name, setName] = useState("");
  const [blocks, setBlocks] = useState<string[]>([]);
  const [exclude, setExclude] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [test, setTest] = useState<{ from: string; to: string; running: boolean; results: TestResult[] | null }>({
    from: daysAgo(30),
    to: daysAgo(0),
    running: false,
    results: null,
  });
  const [sugg, setSugg] = useState<Suggestions | null>(null);

  const draft = useCallback(
    () => ({ name, blocks: blocks.map(fromLines).filter((b) => b.length), exclude_terms: fromLines(exclude) }),
    [name, blocks, exclude],
  );

  useEffect(() => {
    api<{ topic: TopicGroup }>(`/api/topics/${id}`)
      .then(({ topic }) => {
        setTopic(topic);
        setName(topic.name);
        setBlocks(topic.blocks.length ? topic.blocks.map(toLines) : ["", ""]);
        setExclude(toLines(topic.exclude_terms));
      })
      .catch((e) => setMsg(e.message));
    api<Suggestions>(`/api/topics/${id}/suggestions`).then(setSugg).catch(() => {});
  }, [id]);

  // Live query preview for the unsaved draft.
  useEffect(() => {
    if (!topic) return;
    const t = setTimeout(() => {
      const d = draft();
      api<Preview>("/api/topics/preview", { body: { blocks: d.blocks, exclude_terms: d.exclude_terms } }).then(setPreview).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [topic, draft]);

  const save = async (override?: Partial<ReturnType<typeof draft>>) => {
    setSaving(true);
    setMsg(null);
    try {
      const t = await api<TopicGroup>(`/api/topics/${id}`, { method: "PATCH", body: { ...draft(), ...override } });
      setTopic(t);
      setExclude(toLines(t.exclude_terms));
      setDirty(false);
      setMsg("Saved");
      setTimeout(() => setMsg(null), 2000);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTest((t) => ({ ...t, running: true, results: null }));
    try {
      const d = draft();
      const r = await api<{ results: TestResult[] }>(`/api/topics/${id}/test`, {
        body: { from: test.from, to: test.to, blocks: d.blocks, exclude_terms: d.exclude_terms },
      });
      setTest((t) => ({ ...t, running: false, results: r.results }));
    } catch (e) {
      setTest((t) => ({ ...t, running: false }));
      setMsg((e as Error).message);
    }
  };

  const addExclude = async (term: string) => {
    const next = [...new Set([...fromLines(exclude), term])];
    setExclude(toLines(next));
    await save({ exclude_terms: next });
    api<Suggestions>(`/api/topics/${id}/suggestions`).then(setSugg).catch(() => {});
  };

  const addSynonym = (term: string, blockIndex: number) => {
    setBlocks((bs) => bs.map((b, i) => (i === blockIndex ? toLines([...new Set([...fromLines(b), term])]) : b)));
    setDirty(true);
  };

  const remove = async () => {
    if (!confirm(`Delete "${topic?.name}"? Papers stay in the database; their link to this topic is removed.`)) return;
    await api(`/api/topics/${id}`, { method: "DELETE" });
    router.push("/topics");
  };

  if (!topic) return <p className="text-sm text-stone-500">{msg ?? "Loading…"}</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input flex-1 font-serif text-xl font-semibold md:text-2xl"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setDirty(true);
          }}
        />
        <button className="btn btn-primary" disabled={!dirty || saving} onClick={() => save()}>
          {saving ? "Saving…" : "Save"}
        </button>
        {msg && <span className="text-sm text-stone-500">{msg}</span>}
      </div>

      <section>
        <h2 className="label-sm mb-2">Concept blocks — one term per line; terms OR'ed within a block, blocks AND'ed</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {blocks.map((b, i) => (
            <div key={i} className="card p-3">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-sm font-medium">Block {i + 1}</span>
                <button
                  className="text-xs text-stone-500 hover:text-red-600"
                  onClick={() => {
                    setBlocks(blocks.filter((_, j) => j !== i));
                    setDirty(true);
                  }}
                >
                  Remove
                </button>
              </div>
              <textarea
                className="input min-h-40 font-mono text-[13px] leading-6"
                value={b}
                onChange={(e) => {
                  setBlocks(blocks.map((x, j) => (j === i ? e.target.value : x)));
                  setDirty(true);
                }}
              />
            </div>
          ))}
        </div>
        <button
          className="btn mt-2"
          onClick={() => {
            setBlocks([...blocks, ""]);
            setDirty(true);
          }}
        >
          + Add block (AND)
        </button>
      </section>

      <section className="card p-3">
        <h2 className="label-sm mb-1.5">Exclude terms (NOT) — one per line</h2>
        <textarea
          className="input min-h-20 font-mono text-[13px] leading-6"
          value={exclude}
          onChange={(e) => {
            setExclude(e.target.value);
            setDirty(true);
          }}
        />
        <p className="mt-1.5 text-xs text-stone-500">
          Matching is case-insensitive, hyphens count as spaces, and the last word of a term matches as a prefix when it has 4+ letters
          (“sensor” also matches “sensors”).
        </p>
      </section>

      <section>
        <h2 className="label-sm mb-2">Generated queries {dirty && "(unsaved draft)"}</h2>
        <div className="space-y-2">
          {preview &&
            SOURCES.map((s) => (
              <div key={s} className="card p-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm font-medium">{SOURCE_LABELS[s]}</span>
                  <a className="text-xs text-teal-700 underline dark:text-teal-400" href={preview[s].url} target="_blank" rel="noreferrer noopener">
                    API URL
                  </a>
                </div>
                <code className="block text-[12.5px] break-words whitespace-pre-wrap text-stone-700 dark:text-stone-300">{preview[s].query}</code>
              </div>
            ))}
          <p className="text-xs text-stone-500">
            Crossref&apos;s search is relevance-ranked, so it gets the plain words; every source is then checked by the same local boolean rule.
          </p>
        </div>
      </section>

      <section className="card p-3">
        <h2 className="label-sm mb-2">Test query (nothing is saved)</h2>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            Published from
            <input type="date" className="input mt-1" value={test.from} onChange={(e) => setTest({ ...test, from: e.target.value })} />
          </label>
          <label className="text-sm">
            to
            <input type="date" className="input mt-1" value={test.to} onChange={(e) => setTest({ ...test, to: e.target.value })} />
          </label>
          <button className="btn btn-primary" disabled={test.running} onClick={runTest}>
            {test.running ? "Testing…" : "Test query"}
          </button>
        </div>
        {test.results && (
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs text-stone-500">
              <tr>
                <th className="py-1 font-medium">Source</th>
                <th className="font-medium">Source hits</th>
                <th className="font-medium">1st page: pass local rule</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {test.results.map((r) => (
                <tr key={r.source} className="border-t border-stone-200 dark:border-stone-800">
                  <td className="py-1.5">{SOURCE_LABELS[r.source]}</td>
                  {r.error ? (
                    <td colSpan={2} className="text-red-600">
                      {r.error}
                    </td>
                  ) : (
                    <>
                      <td>{r.total?.toLocaleString() ?? "—"}</td>
                      <td>
                        {r.matched} / {r.sampled}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 className="label-sm mb-2">Keyword suggestions</h2>
        {!sugg && <p className="text-sm text-stone-500">Loading…</p>}
        {sugg && !sugg.ready && (
          <p className="card p-3 text-sm text-stone-500">
            Needs at least {sugg.need} “Not related” and {sugg.need} Relevant/Close labels in this topic (now {sugg.counts.notRelated} and{" "}
            {sugg.counts.positive}).
          </p>
        )}
        {sugg?.ready && (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="card p-3">
              <h3 className="mb-0.5 text-sm font-semibold">Over-represented in Not related</h3>
              <p className="mb-2 text-xs text-stone-500">Candidates for exclude terms. “removes” = current inbox papers it would drop.</p>
              <ul className="space-y-1">
                {sugg.exclude.map((s) => (
                  <li key={s.term} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 font-mono text-[13px]">{s.term}</span>
                    <span className="text-xs text-stone-500 tabular-nums" title="docs in Not related / in Relevant+Close">
                      {s.inTarget}:{s.inReference}
                    </span>
                    <span className="w-20 text-right text-xs text-stone-500 tabular-nums">removes {s.wouldRemove}</span>
                    <button className="btn px-2 py-0.5 text-xs" onClick={() => addExclude(s.term)}>
                      Exclude
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="card p-3">
              <h3 className="mb-0.5 text-sm font-semibold">Common in Relevant papers</h3>
              <p className="mb-2 text-xs text-stone-500">Possible new synonyms. Adds to a block as an unsaved edit.</p>
              <ul className="space-y-1">
                {sugg.synonyms.map((s) => (
                  <li key={s.term} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 font-mono text-[13px]">{s.term}</span>
                    <span className="text-xs text-stone-500 tabular-nums">{s.inTarget}:{s.inReference}</span>
                    {blocks.map((_, i) => (
                      <button key={i} className="btn px-2 py-0.5 text-xs" onClick={() => addSynonym(s.term, i)}>
                        +B{i + 1}
                      </button>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </section>

      <button className="btn btn-danger" onClick={remove}>
        Delete topic group
      </button>
    </div>
  );
}
