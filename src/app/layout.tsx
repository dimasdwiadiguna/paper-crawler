import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "Paper Crawler",
  description: "Personal journal paper crawler and triage",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf9" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0a09" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans">
        <Nav />
        <main className="mx-auto w-full max-w-5xl px-4 pt-4 pb-24 md:pb-10">{children}</main>
      </body>
    </html>
  );
}
