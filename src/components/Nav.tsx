"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Inbox", icon: "M3 12h4l2 3h6l2-3h4M5 5h14l2 7v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z" },
  { href: "/library", label: "Library", icon: "M4 19V5a1 1 0 0 1 1-1h3v15M8 4h4v15M12 4h3l4 14.5-3 .8L12 6" },
  { href: "/topics", label: "Topics", icon: "M4 6h16M4 12h10M4 18h6" },
  { href: "/filters", label: "Filters", icon: "M4 5h16l-6 8v5l-4 2v-7z" },
  { href: "/runs", label: "Runs", icon: "M7 4v16l13-8z" },
];

export function Nav() {
  const path = usePathname();
  if (path === "/login") return null;
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <>
      <header className="sticky top-0 z-30 border-b border-stone-200 bg-stone-50/90 backdrop-blur dark:border-stone-800 dark:bg-stone-950/90">
        <div className="mx-auto flex h-12 max-w-5xl items-center gap-6 px-4">
          <Link href="/" className="font-serif text-lg font-semibold tracking-tight">
            Paper Crawler
          </Link>
          <nav className="hidden gap-1 md:flex">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-md px-2.5 py-1 text-sm ${active(l.href) ? "bg-stone-200 font-medium dark:bg-stone-800" : "text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"}`}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <button
            className="ml-auto text-xs text-stone-500 hover:text-stone-800 dark:hover:text-stone-200"
            onClick={async () => {
              await fetch("/api/logout", { method: "POST" });
              window.location.href = "/login";
            }}
          >
            Lock
          </button>
        </div>
      </header>
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-stone-200 bg-stone-50/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden dark:border-stone-800 dark:bg-stone-950/95">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${active(l.href) ? "text-teal-700 dark:text-teal-400" : "text-stone-500"}`}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d={l.icon} />
            </svg>
            {l.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
