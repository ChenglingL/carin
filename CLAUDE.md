# Cairn

A Chrome extension that answers questions about the GitHub repo you're reading, in a side panel.
Answers stay grounded in the repo, use its own terms, cite its docs, and build on what the reader has already read.

The full plan is in `docs/PLAN.md`. Read the relevant section before starting a milestone.

## Current milestone

**M1: agent core, under Node.** Update this line when a milestone's gate passes. (M0 passed on 2026-10-02.)

- M0 Repo index (Node). Gate: doc map is about 15K tokens; the KV Cache entry lists the docs a text search finds.
- M1 Agent core (Node). Gate: every citation is real; "Where it's used" finds at least 80% of expected docs.
- M2 Extension shell. Gate: select text on github.com and get an answer in the side panel.
- M3 Memory. Gate: the KV Cache example in `docs/PLAN.md` behaves as written.
- M4 Polish and share. Ongoing.

Don't start work that belongs to a later milestone. Out of scope for v0: PDFs, code-heavy repos, a local server, MCP, local models.

## How we work

This is a learning project: the owner is learning agent engineering by building it.

- Plan before each milestone, and keep changes small. Commit when a gate passes.
- Explain non-obvious choices briefly as you go.
- Write routine plumbing yourself: project setup, parsing, build config, storage schema, UI wiring, the eval runner.
- Leave a `TODO(human)` with a short brief for the owner to write these parts:
  - the agent tool loop (M1)
  - the context builder and the answer rules (M1)
  - how memory is picked for each question (M3)
  - the expected docs in each eval case
- Don't fill in a `TODO(human)` unless the owner asks you to.

## Architecture rules

- `src/core/` (agent) and `src/index/` (repo index) must run unchanged in both Chrome and Node.
  No `chrome.*`, DOM, or Node built-ins (`fs`, `path`, `process`) in them.
  Anything that touches the outside world comes in through interfaces: `ModelClient`, `MemoryStore`, `RepoSource`.
- `src/extension/` is the only place that uses `chrome.*`: side panel, content script, settings page.
- Only the side panel calls the model API. The content script never sees the API key.
- The index JSON written by the Node script has the same shapes IndexedDB will store in M2–M3.
- Prompts (answer rules, action instructions) live in `src/core/prompts/` and are versioned like code.
  Any prompt or tool change runs the evals.

## Layout

```
src/core/        context builder, actions, tool loop, answer checks, memory updates
src/index/       repo download, parsing, doc map, concept index, reading path
src/extension/   WXT entrypoints: side panel, content script, settings (from M2)
scripts/         Node entry points: build-index, ask
evals/           cases, fixtures, runner
docs/PLAN.md     the plan
```

## Commands

Keep this list current. Node 24+ runs the `.ts` scripts directly (type stripping, no build step).

- `npm run index -- --repo ChenglingL/llm-master` writes `data/index.json` and caches the repo zip per commit in `data/cache/`.
  Options: `--ref <branch>`, `--start <roadmap page>`, `--count-tokens` (exact doc map count from the API; needs `ANTHROPIC_API_KEY` in `.env`).
- `npm test` runs Vitest. The M0 gate tests (`scripts/index-gate.test.ts`) skip until the index is built.
- `npm run typecheck` runs `tsc --noEmit` on the whole project, then on `tsconfig.portable.json`,
  which fails if `src/core/` or `src/index/` use Node or browser APIs.
- `npm run evals` runs the eval cases and prints a report (from M1)
- `npm run dev` / `npm run build` build the extension with WXT (from M2)

## Conventions

- TypeScript in strict mode, ES modules, Node LTS.
- Tests sit next to the code as `*.test.ts`.
- Chinese text has no spaces: split words with `Intl.Segmenter`, never by whitespace.
- Keep the source repo's Chinese terms and doc titles exactly as written.
- Citations point to a doc path plus a heading anchor that exists in the index.

## Model

- Default model `claude-sonnet-5-5`; cheaper option `claude-haiku-4-5-20251001`.
- Put the stable part first (answer rules + doc map) so prompt caching can reuse it.
  The reader's position, selection and memory slice come after.

## Secrets and data

- Never commit API keys. Local runs read `ANTHROPIC_API_KEY` from `.env`, which is gitignored.
- In the extension the user's key lives in `chrome.storage.session` by default.
  Browser calls to the Claude API need the `anthropic-dangerous-direct-browser-access: true` header.
- Don't commit downloaded repos or `data/index.json` (both gitignored).
- llm-master is MIT (© 2026 程序员Carl). Excerpts copied into `evals/fixtures/` keep its LICENSE file beside them.

## Done means

Tests pass, `npm run typecheck` is clean, the evals don't regress, and no browser or Node APIs have crept into `src/core/` or `src/index/`.
