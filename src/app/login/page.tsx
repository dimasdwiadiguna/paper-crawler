"use client";

import { useState } from "react";

export default function LoginPage() {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passcode }),
    });
    if (res.ok) {
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    } else {
      setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Login failed");
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto mt-[18vh] max-w-xs">
      <h1 className="text-center font-serif text-3xl font-semibold">Paper Crawler</h1>
      <form onSubmit={submit} className="card mt-6 space-y-3 p-5">
        <label className="label-sm" htmlFor="pc">
          Passcode
        </label>
        <input
          id="pc"
          type="password"
          autoFocus
          autoComplete="current-password"
          className="input py-2.5 text-base"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="btn btn-primary w-full py-2.5 text-base" disabled={busy || !passcode}>
          {busy ? "Checking…" : "Unlock"}
        </button>
      </form>
    </div>
  );
}
