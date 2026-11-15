"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/components/api";
import { SOURCE_LABELS, type SourceName } from "@/lib/types";

interface PlanTopic {
  id: string;
  name: string;
  cursors: Record<SourceName, string | null>;
  needsRange: boolean;
}
interface RunPair {
  topicId: string;
  topicName: string;
  source: SourceName;
  window: { mode: "initial" | "incremental"; from: string; to: string };
}
interface StepResult {
  fetched: number;
  nomatch: number;
  new: number;
  dupes: number;
  filtered: number;
  done: boolean;
  nextCursor: string | null;
  capHit: boolean;
  total: number | null;
  error: string | null;
  warning: string | null;
}
interface Counts {
  fetched: number;
  nomatch: number;
  new: number;
  dupes: number;
  filtered: number;
  errors?: number;
}
interface Summary {
  totals: Counts;
  bySource: Record<string, Counts & { capHit: boolean; pages: number }>;
  capHits: { topicId: string; source: SourceName }[];
  errors: { source: SourceName; page: number; error: string }[];
  scoring?: { scored: number; labels: number; coldStart: boolean } | { error: string };
}
interface RunRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  summary: Summary | Record<string, never>;
  cap?: number;
}
interface PairProgress extends Counts {
  pair: RunPair;
  page: number;
  state: "pending" | "running" | "done" | "error";
  capHit: boolean;
  total: number | null;
  error: string | null;
  warnings: string[];
}

const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

export default function RunsPage() {
  const [plan, setPlan] = useState<PlanTopic[] | null>(null);
  const [ranges, setRanges] = useState<Record<string, { from: string; to: string }>>({});
  const [cap, setCap] = useState(500);
  const [lookback, setLookback] = useState(30);
  const [history, setHistory] = useState<RunRow[]>([]);
  const [progress, setProgress] = useState<PairProgress[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stop = useRef(false);

  const loadPlan = () =>
    api<{ topics: PlanTopic[]; defaults: { cap: number; lookbackDays: number } }>("/api/runs/plan")
      .then((r) => {
        setPlan(r.topics);
        setCap(r.defaults.cap);
        setLookback(r.defaults.lookbackDays);
        setRanges((prev) => {
          const next = { ...prev };
          for (const t of r.topics) if (t.needsRange && !next[t.id]) next[t.id] = { from: daysAgo(30), to: daysAgo(0) };
          return next;
        });
      })
      .catch((e) => setError(e.message));
  const loadHistory = () =>
    api<{ runs: RunRow[] }>("/api/runs")
      .then((r) => setHistory(r.runs))
      .catch(() => {});

  useEffect(() => {
    loadPlan();
    loadHistory();
  }, []);

  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  const start = async () => {
    if (!plan) return;
    setError(null);
    setSummary(null);
    setRunning(true);
    stop.current = false;
    try {
      const needed = Object.fromEntries(plan.filter((t) => t.needsRange).map((t) => [t.id, ranges[t.id]]));
      const run = await api<{ id: number; params: { pairs: RunPair[] } }>("/api/runs", {
        body: { ranges: needed, cap, lookbackDays: lookback },
      });
      const prog: PairProgress[] = run.params.pairs.map((pair) => ({
        pair,
        page: 0,
        state: "pending",
        fetched: 0,
        nomatch: 0,
        new: 0,
        dupes: 0,
        filtered: 0,
        capHit: false,
        total: null,
        error: null,
        warnings: [],
      }));
      setProgress([...prog]);

      for (let i = 0; i < prog.length; i++) {
        const p = prog[i];
        p.state = "running";
        let cursor: string | null = null;
        for (let page = 1; ; page++) {
          if (stop.current) break;
          p.page = page;
          setStatus(`${p.pair.topicName} · ${SOURCE_LABELS[p.pair.source]} · page ${page} · ${p.new} new`);
          setProgress([...prog]);
          let r: StepResult;
          try {
            r = await api<StepResult>(`/api/runs/${run.id}/step`, {
              body: { pair: i, page, cursor, fetchedSoFar: p.fetched },
            });
          } catch (e) {
            r = { fetched: 0, nomatch: 0, new: 0, dupes: 0, filtered: 0, done: true, nextCursor: null, capHit: false, total: null, error: (e as Error).message, warning: null };
          }
          p.fetched += r.fetched;
          p.nomatch += r.nomatch;
          p.new += r.new;
          p.dupes += r.dupes;
          p.filtered += r.filtered;
          p.total = r.total ?? p.total;
          p.capHit ||= r.capHit;
          if (r.warning) p.warnings.push(r.warning);
          if (r.error) {
            p.error = r.error;
            p.state = "error";
          }
          if (r.done) break;
          cursor = r.nextCursor;
        }
        if (p.state === "running") p.state = stop.current ? "pending" : "done";
        setProgress([...prog]);
        if (stop.current) break;
      }
      setStatus("Finishing: summarising and re-scoring…");
      const fin = await api<{ summary: Summary }>(`/api/runs/${run.id}/finish`, { body: {} });
      setSummary(fin.summary);
      setStatus(stop.current ? "Stopped." : "Done.");
    } catch (e) {
      setError((e as Error).message);
      setStatus(null);
    } finally {
      setRunning(false);
      loadPlan();
      loadHistory();
    }
  };

  const firstRun = plan?.filter((t) => t.needsRange) ?? [];

  return (
    <div className="space-y-6">
      <h1 className="font-serif text-2xl font-semibold">Runs</h1>

      <section className="card space-y-4 p-4">
        {plan && !plan.length && <p className="text-sm text-stone-500">No active topic groups.</p>}
        {firstRun.length > 0 && (
          <div>
            <h2 className="label-sm mb-2">First run — choose a publication date range</h2>
            <div className="space-y-2">
              {firstRun.map((t) => (
                <div key={t.id} className="flex flex-wrap items-end gap-2">
                  <span className="w-full text-sm font-medium md:w-auto md:flex-1">{t.name}</span>
                  <label className="text-xs text-stone-500">
                    From
                    <input
                      type="date"
                      className="input mt-0.5"
                      value={ranges[t.id]?.from ?? ""}
                      onChange={(e) => setRanges({ ...ranges, [t.id]: { ...ranges[t.id], from: e.target.value } })}
                    />
                  </label>
                  <label className="text-xs text-stone-500">
                    To
                    <input
                      type="date"
                      className="input mt-0.5"
                      value={ranges[t.id]?.to ?? ""}
                      onChange={(e) => setRanges({ ...ranges, [t.id]: { ...ranges[t.id], to: e.target.value } })}
                    />
                  </label>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-stone-500">Later runs fetch only what each source added since the last successful run.</p>
          </div>
        )}
        {plan && plan.some((t) => !t.needsRange) && (
          <ul className="text-sm text-stone-600 dark:text-stone-400">
            {plan
              .filter((t) => !t.needsRange)
              .map((t) => (
                <li key={t.id}>
                  <strong className="font-medium text-stone-800 dark:text-stone-200">{t.name}</strong>: since{" "}
                  {new Date(Math.min(...Object.values(t.cursors).map((c) => +new Date(c!)))).toLocaleString()}
                </li>
              ))}
          </ul>
        )}
        <details className="text-sm">
          <summary className="cursor-pointer text-stone-600 dark:text-stone-400">Options</summary>
          <div className="mt-2 flex flex-wrap gap-3">
            <label className="text-xs text-stone-500">
              Max results per topic × source
              <input type="number" min={1} max={10000} className="input mt-0.5 w-32" value={cap} onChange={(e) => setCap(Number(e.target.value))} />
            </label>
            <label className="text-xs text-stone-500">
              OpenAlex look-back (days)
              <input type="number" min={1} max={365} className="input mt-0.5 w-32" value={lookback} onChange={(e) => setLookback(Number(e.target.value))} />
            </label>
          </div>
          <p className="mt-1.5 text-xs text-stone-500">
            OpenAlex&apos;s “added since” filter needs a paid plan, so incremental OpenAlex runs re-check papers published in the look-back window;
            duplicates are merged.
          </p>
        </details>
        <div className="flex items-center gap-3">
          <button className="btn btn-primary px-6 py-2.5 text-base" disabled={running || !plan?.length} onClick={start}>
            {running ? "Running…" : "Run"}
          </button>
          {running && (
            <button className="btn" onClick={() => (stop.current = true)}>
              Stop
            </button>
          )}
          {status && <span className="text-sm text-stone-600 tabular-nums dark:text-stone-400">{status}</span>}
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}

        {progress && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead className="text-left text-xs text-stone-500">
                <tr>
                  <th className="py-1 font-medium">Topic · source</th>
                  <th className="font-medium">Window</th>
                  <th className="text-right font-medium">Fetched</th>
                  <th className="text-right font-medium">No match</th>
                  <th className="text-right font-medium">New</th>
                  <th className="text-right font-medium">Dupes</th>
                  <th className="text-right font-medium">Filtered</th>
                </tr>
              </thead>
              <tbody>
                {progress.map((p, i) => (
                  <tr key={i} className="border-t border-stone-200 align-top dark:border-stone-800">
                    <td className="py-1.5">
                      <span className={p.state === "running" ? "animate-pulse" : ""}>
                        {p.state === "done" ? "✓" : p.state === "error" ? "✗" : p.state === "running" ? "●" : "○"}
                      </span>{" "}
                      {p.pair.topicName} · {SOURCE_LABELS[p.pair.source]}
                      {p.page > 0 && <span className="text-xs text-stone-500"> · p{p.page}</span>}
                      {p.capHit && <div className="text-xs text-amber-700 dark:text-amber-400">Cap of {cap} hit — narrow the query to see everything.</div>}
                      {p.error && <div className="text-xs text-red-600">{p.error}</div>}
                      {p.warnings.length > 0 && <div className="text-xs text-amber-700">{p.warnings[0]}</div>}
                    </td>
                    <td className="text-xs text-stone-500">
                      {p.pair.window.mode === "initial" ? "published" : "added"} {p.pair.window.from} → {p.pair.window.to}
                    </td>
                    <td className="text-right">{p.fetched}</td>
                    <td className="text-right">{p.nomatch}</td>
                    <td className="text-right font-semibold">{p.new}</td>
                    <td className="text-right">{p.dupes}</td>
                    <td className="text-right">{p.filtered}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {summary && (
          <p className="text-sm">
            <strong>{summary.totals.new}</strong> new papers · {summary.totals.dupes} duplicates · {summary.totals.filtered} filtered by venue ·{" "}
            {summary.totals.nomatch} didn&apos;t match the keyword rule
            {summary.errors.length > 0 && <span className="text-red-600"> · {summary.errors.length} error(s)</span>}.{" "}
            <a className="text-teal-700 underline dark:text-teal-400" href="/">
              Go to inbox →
            </a>
          </p>
        )}
      </section>

      <section>
        <h2 className="label-sm mb-2">History</h2>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead className="text-left text-xs text-stone-500">
              <tr>
                <th className="px-3 py-2 font-medium">Run</th>
                <th className="font-medium">Status</th>
                <th className="text-right font-medium">Fetched</th>
                <th className="text-right font-medium">New</th>
                <th className="text-right font-medium">Dupes</th>
                <th className="text-right font-medium">Filtered</th>
                <th className="px-3 text-right font-medium">Errors</th>
              </tr>
            </thead>
            <tbody>
              {history.map((r) => {
                const s = (r.summary as Summary).totals;
                return (
                  <tr key={r.id} className="border-t border-stone-200 dark:border-stone-800">
                    <td className="px-3 py-2">
                      #{r.id} · {new Date(r.started_at).toLocaleString()}
                      {(r.summary as Summary).bySource && (
                        <div className="text-xs text-stone-500">
                          {Object.entries((r.summary as Summary).bySource)
                            .map(([src, c]) => `${SOURCE_LABELS[src as SourceName]} ${c.new}/${c.fetched}${c.capHit ? " (cap)" : ""}`)
                            .join(" · ")}
                        </div>
                      )}
                    </td>
                    <td>{r.status}</td>
                    <td className="text-right">{s?.fetched ?? "—"}</td>
                    <td className="text-right font-semibold">{s?.new ?? "—"}</td>
                    <td className="text-right">{s?.dupes ?? "—"}</td>
                    <td className="text-right">{s?.filtered ?? "—"}</td>
                    <td className="px-3 text-right">{s?.errors ?? "—"}</td>
                  </tr>
                );
              })}
              {!history.length && (
                <tr>
                  <td colSpan={7} className="px-3 py-4 text-center text-stone-500">
                    No runs yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
