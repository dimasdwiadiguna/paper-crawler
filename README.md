# Paper Crawler

A personal web app that collects journal-paper **metadata** on your research topics from free scholarly APIs (OpenAlex, Crossref, Europe PMC). You run it by hand, triage new papers into **Relevant / Close / Not related**, and the inbox ranks papers better as you label (local TF-IDF, no AI API cost).

Next.js 16 (App Router, TypeScript) · Tailwind CSS 4 · Supabase Postgres · deploys on Vercel.

- **Metadata only, from APIs only.** No scraping, no full text.
- **No background jobs.** A crawl starts only when you press **Run**.
- **Single user.** One shared passcode (`APP_PASSCODE`), an httpOnly cookie, and a Next.js proxy (formerly called middleware) that checks it on every page and API route. Supabase is reached only from the server with the service-role key; every table has RLS on with no policies.

---

## API notes (checked against the live APIs, Nov 2026)

What differs from the original spec, and what the app does instead:

| Spec | Reality | What the app does |
|---|---|---|
| OpenAlex key optional | Keyless requests share a small **per-IP daily budget** that is often already spent on cloud hosts (`429 Insufficient budget`). Keys are free. | Set `OPENALEX_API_KEY` (sent as `Authorization: Bearer`). A key gives $1/day of credit: a search page costs $0.001 and a DOI lookup $0.0001, so ~1,000 search pages a day. |
| OpenAlex created-date filter | `from_created_date` is part of the **paid "daily sync" plans** (Member+): `Plan upgrade required`. | Incremental runs use `from_publication_date` = last run − **look-back window** (default 30 days, configurable per run). Dedupe absorbs the repeats. |
| OpenAlex boolean search | `filter=title_and_abstract.search:` supports `AND / OR / NOT`, quoted phrases and parentheses (stemmed). Plain `search=` also searches **full text**, which is noisier. | Uses `title_and_abstract.search`. Types: `article\|review\|preprint\|conference-paper` (OpenAlex has a `conference-paper` type now). |
| Crossref `from-index-date` | Works, but Crossref **re-indexes old records constantly**: a 30-day index window returned ~60,000 hits, most of them years old. | Uses `from-created-date` (first DOI deposit), which means "added since". |
| Crossref relevance query | `query.bibliographic` needs a **share of the words to match**: 20 words gave 60 hits, 3 words gave 5,490. Also, **`cursor` paging drops relevance order**, so on-topic results fell from rank 1 to rank 91. | Sends **one sub-query per term of the first concept block**, followed by the other blocks' words, and pages with `offset`. The cap is split across the sub-queries. Put your most specific concept in block 1. |
| Europe PMC | As described: `resultType=core`, `cursorMark`, `FIRST_IDATE`, `TITLE_ABS:` all work. | Sources limited to `SRC:MED OR SRC:PMC OR SRC:PPR` (PubMed, PMC, preprints). |

## How it works

### Run model
- A cursor is kept per **(topic group, source)** in `source_cursors`.
- **First run** of a group (including groups added later): the Runs page asks for a **publication-date** range.
- **Later runs** fetch records added since the cursor, minus 1 day of overlap:
  - Crossref: `from-created-date`
  - Europe PMC: `FIRST_IDATE`
  - OpenAlex: publication date with the look-back window
- A cursor moves forward only when every page of that (topic, source) finished without errors.
- **Vercel timeouts:** the browser creates a `runs` row, then calls `POST /api/runs/:id/step` once per (topic, source, page). Each step is one API page and took 0.1–2 s in testing. Live progress looks like "Topic · OpenAlex · page 3 · 42 new". `POST /api/runs/:id/finish` writes the summary and recomputes scores.
- 429/5xx responses retry with exponential back-off and honour a short `Retry-After`. A long `Retry-After`, such as an exhausted daily quota, fails fast and is logged on the step.
- Each run is capped at **N results per (topic, source)**, default 500. If the cap is hit, the run shows a warning.

### Keyword logic
- A topic group has **concept blocks**: synonyms inside a block are OR'ed, and blocks are AND'ed. It also has **exclude terms** (NOT) and an active switch.
- Each group is translated into each source's syntax. You can see the exact queries on `/topics/:id`, along with a **Test query** button that saves nothing.
- One **local boolean matcher** then checks title + abstract for every source:
  - case-insensitive, and hyphens count as spaces
  - each term is a whole-word phrase
  - the last word of a term may carry a suffix when it has 4+ letters ("sensor" → "sensors")

### Venue filter
- A paper passes if its journal is **whitelisted** (by ISSN-L; all of the journal's ISSNs are stored so Crossref/PMC ISSNs match) **or** it falls in an **allowed OpenAlex field/subfield**.
- Preprints are judged by field only.
- Crossref and Europe PMC records are looked up in OpenAlex by DOI, in batches of 50 (`filter=doi:a|b|…`).
- A paper whose field is still unknown is kept and flagged `unclassified`.
- Rejected papers are stored with `status = 'filtered'`. They're hidden by default; turn on "Show filtered" to see them.
- With no rules configured, everything passes.

### Dedupe
- The key is the lowercased DOI, without the `https://doi.org/` prefix. For records without a DOI it's `sha1(normalised title | year)`.
- Repeats are merged into one row: longest abstract, most complete author list, the union of sources and ISSNs.
- Crawl updates **never write `label` / `score`**, so a labeled paper never returns to the inbox, and labeling during a run is safe.

### Ranking and suggestions
- **Ranking:**
  - Score = TF-IDF (title + abstract, stopwords removed, unigrams + bigrams), `sim(Relevant) + 0.5·sim(Close) − sim(Not related)`.
  - Centroids are per topic group when the group has ≥ 10 labels, otherwise global.
  - With fewer than 5 labels in total, the inbox sorts by date and hides the score badge.
  - Scores are recomputed after each run and 6 s after you stop labeling.
- **Suggestions:** with ≥ 10 Not-related and ≥ 10 Relevant/Close labels in a group, the topic page lists the 15 terms most over-represented in Not-related papers. It uses smoothed log-odds (α = 0.5) divided by its standard error. Each suggestion has an **Exclude** button and a count of how many current inbox papers it would remove. The page also lists the top terms from Relevant papers as possible synonyms.

## Data model (`supabase/migrations/`)

`topic_groups`, `papers`, `paper_topics`, `runs`, `run_steps`, `source_cursors`, `journal_whitelist`, `allowed_fields`. These follow the spec, with these changes:

- `papers.title_hash` is indexed but **not unique**. It's only a fallback match key, and two different papers can legitimately share a title and year. `doi` stays `unique`.
- `papers.fts` is a `tsvector` kept by a trigger: title (weight A), abstract (B), authors (C, unstemmed), with a GIN index. A trigger is used because a generated column can't expand the authors JSON array.
- `run_steps` splits "filtered out" into `nomatch` (failed the keyword rule, or unsupported type; **not stored**) and `filtered` (failed the venue rule; stored with status `filtered`). It also stores `cap_hit`.
- `runs.id` is a bigint identity, so "newest run first" is a plain `order by first_seen_run_id desc`. `runs.params` stores each (topic, source) window, so the client can't change them mid-run.
- `journal_whitelist.issns` holds every ISSN of the journal, not only the ISSN-L.
- `set_scores(jsonb)` is an RPC for bulk score updates.

## Setup

### 1. Supabase
1. Create a project at [supabase.com](https://supabase.com) (the free tier is fine).
2. Apply the schema, either:
   - **SQL editor:** paste and run `supabase/migrations/20261115000000_init.sql`, then `supabase/seed.sql`.
   - **CLI:** `npx supabase link --project-ref <ref>`, then `npx supabase db push`, then run `supabase/seed.sql` in the SQL editor.
3. From **Project Settings → API**, copy the project URL and the **service_role** key.

### 2. Environment variables
Copy `.env.example` to `.env.local` and fill in:

| Variable | |
|---|---|
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only. Never expose it to the browser. |
| `APP_PASSCODE` | Your passcode. Changing it logs every browser out. |
| `CONTACT_EMAIL` | Sent as `mailto` for the OpenAlex/Crossref polite pools. |
| `OPENALEX_API_KEY` | Optional but strongly recommended. Free at openalex.org. |

### 3. Run locally
```bash
npm install
npm run dev          # http://localhost:3000
npm test             # 52 unit tests (Vitest)
npm run typecheck
```

A database-free check of the whole pipeline against the live APIs (the seed topic, last 30 days):

```bash
npx tsx scripts/test-crawl.ts 30 500                 # first-run window
npx tsx scripts/test-crawl.ts 1 500 --incremental    # "added since yesterday"
```

If your network needs an HTTPS proxy, Node's `fetch` only uses it with `NODE_USE_ENV_PROXY=1` (Node ≥ 22.21).

### 4. Deploy to Vercel
1. Push the repo to GitHub and import it in Vercel. The framework preset (Next.js) is detected automatically.
2. Add the five environment variables under **Settings → Environment Variables**.
3. Deploy. Each crawl step is one API page (a few seconds), well inside the Hobby plan's function limit; step routes set `maxDuration = 60`.

## Usage
1. **Filters:** add whitelisted journals (OpenAlex search) and/or allowed fields. Skip this to keep everything.
2. **Topics:** edit the seed group. Put the most specific concept in block 1, and use **Test query** to check counts.
3. **Runs:** pick the first-run date range and press **Run**.
4. **Inbox:**
   - Laptop: `1/2/3` label, `j/k` move, `o` open DOI, `space` expand, `u` undo.
   - Phone: one card at a time. Swipe → Relevant, ← Not related, ↑ Close.
5. **Library:** full-text search (`websearch` syntax, e.g. `kalman "fed-batch" -yeast`) and relabeling.

## Project layout
```
src/proxy.ts                 passcode check for every page + API route
src/lib/sources/             openalex.ts, crossref.ts, europepmc.ts, http.ts (retry/back-off)
src/lib/matcher.ts           local boolean matcher
src/lib/merge.ts, venue.ts   dedupe/merge, venue rule
src/lib/tfidf.ts, suggest.ts ranking, log-odds suggestions
src/lib/server/crawl.ts      plan / run / step / finish
src/app/api/…                route handlers (all re-check the session)
supabase/migrations, seed.sql
tests/                       Vitest
```
