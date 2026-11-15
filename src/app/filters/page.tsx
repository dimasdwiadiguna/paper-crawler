"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/components/api";

interface Journal {
  issn_l: string;
  name: string;
  issns: string[];
}
interface AllowedField {
  openalex_id: string;
  name: string;
  level: "field" | "subfield";
}
interface CatalogEntry {
  id: string;
  name: string;
  level: "field" | "subfield";
  parent: string | null;
}
interface Suggestion {
  id: string;
  name: string;
  hint: string | null;
  issn: string | null;
  works_count: number | null;
}

export default function FiltersPage() {
  const [journals, setJournals] = useState<Journal[]>([]);
  const [fields, setFields] = useState<AllowedField[]>([]);
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Suggestion[]>([]);
  const [fieldQ, setFieldQ] = useState("");
  const [openField, setOpenField] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api<{ journals: Journal[]; fields: AllowedField[] }>("/api/filters")
      .then((r) => {
        setJournals(r.journals);
        setFields(r.fields);
      })
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
    api<{ catalog: CatalogEntry[] }>("/api/filters/fields/catalog")
      .then((r) => setCatalog(r.catalog))
      .catch((e) => setError(`Couldn't load OpenAlex fields: ${e.message}`));
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      api<{ results: Suggestion[] }>(`/api/filters/journals?q=${encodeURIComponent(q.trim())}`)
        .then((r) => setResults(r.results))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const addJournal = async (s: Suggestion) => {
    setError(null);
    try {
      await api("/api/filters/journals", { body: { openalexId: s.id } });
      setQ("");
      setResults([]);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const allowed = new Set(fields.map((f) => f.openalex_id));
  const toggleField = async (c: CatalogEntry) => {
    if (allowed.has(c.id)) await api(`/api/filters/fields?id=${encodeURIComponent(c.id)}`, { method: "DELETE" });
    else await api("/api/filters/fields", { body: { id: c.id, name: c.name, level: c.level } });
    load();
  };

  const tree = useMemo(() => {
    if (!catalog) return [];
    const needle = fieldQ.trim().toLowerCase();
    return catalog
      .filter((c) => c.level === "field")
      .map((f) => {
        const subs = catalog.filter((s) => s.parent === f.id);
        const subsShown = needle ? subs.filter((s) => s.name.toLowerCase().includes(needle)) : subs;
        const show = !needle || f.name.toLowerCase().includes(needle) || subsShown.length > 0;
        return { f, subs: needle && !f.name.toLowerCase().includes(needle) ? subsShown : subs, show };
      })
      .filter((x) => x.show)
      .sort((a, b) => a.f.name.localeCompare(b.f.name));
  }, [catalog, fieldQ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold">Venue filters</h1>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
          A paper passes if its journal is whitelisted <strong>or</strong> it falls in an allowed field. Preprints are judged by field only. Papers
          whose field is unknown are kept and flagged “unclassified”. With nothing configured, everything passes.
        </p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <section className="card p-4">
        <h2 className="label-sm mb-2">Journal whitelist ({journals.length})</h2>
        <div className="relative">
          <input className="input" placeholder="Search journals (OpenAlex)…" value={q} onChange={(e) => setQ(e.target.value)} />
          {results.length > 0 && (
            <ul className="absolute z-20 mt-1 max-h-80 w-full overflow-auto rounded-lg border border-stone-200 bg-white shadow-lg dark:border-stone-700 dark:bg-stone-900">
              {results.map((s) => (
                <li key={s.id}>
                  <button className="w-full px-3 py-2 text-left text-sm hover:bg-stone-100 dark:hover:bg-stone-800" onClick={() => addJournal(s)}>
                    <span className="font-medium">{s.name}</span>
                    <span className="ml-2 text-xs text-stone-500">
                      {[s.hint, s.issn, s.works_count ? `${s.works_count.toLocaleString()} works` : null].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <ul className="mt-3 divide-y divide-stone-200 dark:divide-stone-800">
          {journals.map((j) => (
            <li key={j.issn_l} className="flex items-center gap-2 py-2 text-sm">
              <span className="flex-1">{j.name}</span>
              <span className="font-mono text-xs text-stone-500">{j.issn_l}</span>
              <button
                className="btn btn-danger px-2 py-0.5 text-xs"
                onClick={async () => {
                  await api(`/api/filters/journals?issn_l=${encodeURIComponent(j.issn_l)}`, { method: "DELETE" });
                  load();
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="card p-4">
        <h2 className="label-sm mb-2">Allowed fields ({fields.length})</h2>
        {fields.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {fields.map((f) => (
              <span key={f.openalex_id} className="chip bg-teal-50 text-teal-800 dark:bg-teal-950 dark:text-teal-300">
                {f.name}
                <span className="ml-1 opacity-60">{f.level === "subfield" ? "sub" : ""}</span>
              </span>
            ))}
          </div>
        )}
        <input className="input mb-2" placeholder="Filter fields and subfields…" value={fieldQ} onChange={(e) => setFieldQ(e.target.value)} />
        {!catalog && <p className="text-sm text-stone-500">Loading OpenAlex fields…</p>}
        <ul className="divide-y divide-stone-200 dark:divide-stone-800">
          {tree.map(({ f, subs }) => (
            <li key={f.id} className="py-1.5">
              <div className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={allowed.has(f.id)} onChange={() => toggleField(f)} />
                <button className="flex-1 text-left font-medium" onClick={() => setOpenField(openField === f.id ? null : f.id)}>
                  {f.name}
                </button>
                <span className="text-xs text-stone-500">
                  {subs.filter((s) => allowed.has(s.id)).length || ""} {openField === f.id || fieldQ ? "▾" : "▸"}
                </span>
              </div>
              {(openField === f.id || fieldQ) && (
                <ul className="mt-1 ml-6 grid gap-0.5 md:grid-cols-2">
                  {subs.map((s) => (
                    <li key={s.id}>
                      <label className="flex items-center gap-2 text-sm text-stone-700 dark:text-stone-300">
                        <input type="checkbox" checked={allowed.has(s.id)} onChange={() => toggleField(s)} />
                        {s.name}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
