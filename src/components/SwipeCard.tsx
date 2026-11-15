"use client";

import { useRef, useState } from "react";
import type { Label } from "@/lib/types";

const THRESHOLD = 90;

/** Swipe right = Relevant, left = Not related, up = Close. Taps and vertical scrolling pass through. */
export function SwipeCard({ children, onSwipe }: { children: React.ReactNode; onSwipe: (l: Label) => void }) {
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const [d, setD] = useState({ x: 0, y: 0 });
  const [leaving, setLeaving] = useState(false);

  const intent: Label | null =
    d.x > THRESHOLD ? "relevant" : d.x < -THRESHOLD ? "not_related" : d.y < -THRESHOLD && Math.abs(d.x) < THRESHOLD ? "close" : null;

  const end = () => {
    if (!start.current) return;
    start.current = null;
    if (intent) {
      setLeaving(true);
      setD((cur) => ({ x: cur.x * 3, y: intent === "close" ? -600 : cur.y }));
      setTimeout(() => onSwipe(intent), 150);
    } else {
      setD({ x: 0, y: 0 });
    }
  };

  const hint = intent ? { relevant: "Relevant", not_related: "Not related", close: "Close" }[intent] : null;

  return (
    <div className="relative touch-pan-y select-none">
      {hint && (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center">
          <span className="rounded-full bg-stone-900/80 px-3 py-1 text-sm font-semibold text-white">{hint}</span>
        </div>
      )}
      <div
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("a, button")) return;
          start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
        }}
        onPointerMove={(e) => {
          if (!start.current || start.current.id !== e.pointerId) return;
          const x = e.clientX - start.current.x;
          const y = e.clientY - start.current.y;
          if (Math.abs(x) > 8 || y < -8) (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          setD({ x, y: Math.min(0, y) });
        }}
        onPointerUp={end}
        onPointerCancel={() => {
          start.current = null;
          setD({ x: 0, y: 0 });
        }}
        style={{
          transform: `translate(${d.x}px, ${d.y}px) rotate(${d.x / 30}deg)`,
          transition: start.current && !leaving ? "none" : "transform 150ms ease-out",
          opacity: leaving ? 0 : 1,
        }}
      >
        {children}
      </div>
    </div>
  );
}
