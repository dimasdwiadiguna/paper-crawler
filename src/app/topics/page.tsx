"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/components/api";
import type { TopicGroup } from "@/lib/types";

type Row = TopicGroup & { papers: number; cursors: { source: string; last_until: string }[] };

export default function TopicsPage() {
  const [topics, setTopics] = useState<Row[] | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api<{ topics: Row[] }>("/api/topics")
      .then((r) => setTopics(r.topics))
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const t = await api<TopicGroup>("/api/topics", { body: { name, blocks: [[], []], exclude_terms: [] } });
      window.location.href = `/topics/${t.id}`;
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const toggle = async (t: Row) => {
    await api(`/api/topics/${t.id}`, { method: "PATCH", body: { active: !t.active } });
    load();
  };

  return (
    <div>
      <h1 className="mb-3 font-serif text-2xl font-semibold">Topic groups</h1>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <div className="space-y-2">
        {topics?.map((t) => (
          <div key={t.id} className="card flex items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <Link href={`/topics/${t.id}`} className="font-serif text-lg font-semibold hover:underline">
                {t.name}
              </Link>
              <p className="text-sm text-stone-500">
                {t.blocks.length} concept block{t.blocks.length === 1 ? "" : "s"} · {t.exclude_terms.length} excluded · {t.papers} papers ·{" "}
                {t.cursors.length ? `last fetched ${new Date(Math.max(...t.cursors.map((c) => +new Date(c.last_until)))).toLocaleDateString()}` : "never run"}
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={t.active} onChange={() => toggle(t)} />
              Active
            </label>
          </div>
        ))}
      </div>
      <form onSubmit={create} className="card mt-4 flex gap-2 p-3">
        <input className="input" placeholder="New topic group name" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn btn-primary shrink-0" disabled={!name.trim()}>
          Create
        </button>
      </form>
    </div>
  );
}
