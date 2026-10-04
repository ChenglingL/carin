# Repo Reading Companion — Scope & Build Plan

October 2, 2026 · [Live doc](https://claude.ai/code/artifact/7e7b75f7-fa4d-4d84-96da-4dc874e325bc)

v0 is a Chrome extension that answers questions about the GitHub repo you are reading, in a side panel, using the repo itself and what it remembers about you. The earlier plan's PDFs, books and local server move to Later.

## What changed

Six of your inputs reshape the plan.

| Your input | Decision |
| --- | --- |
| The aim is less window-switching and fewer irrelevant answers, not smarter answers | Answers stay short, use the repo's own terms, and point to where else the repo covers a concept |
| Start with GitHub repos only | One kind of source: a public GitHub repo of Markdown docs, starting with llm-master |
| Can the agent loop run in an extension? | Yes. The loop runs in the side panel, so v0 needs no local server |
| Answers should be built around the repo, your preferences and your progress | Local memory: repo index, profile, progress, concept ledger and threads |
| No risk of leaking API keys | Each user brings their own key; no key ever ships with the code |
| This is also a learning project | One-call actions first, one real agent, evals from day one; each milestone teaches one idea |

## Scope

v0 is narrow on purpose: one kind of source, one browser, one model provider.

| Area | In v0 | Later |
| --- | --- | --- |
| Sources | Public GitHub repos of Markdown docs, read on github.com; llm-master first | Code-heavy repos; PDFs, papers and books |
| Actions | Explain here, Example, Where it's used, Ask | More lenses once these prove useful |
| Browser | Chrome or another Chromium browser, in the side panel | Firefox |
| Model | Gemini API free tier by default, Claude API as an option; your own key either way | Local models through Ollama |
| Memory | In the browser, with export and import | Plain files through a local server; sync across devices |
| Other tools | None | MCP, so Claude Code can use the same memory |
| Sharing | Public repo, loaded unpacked | Chrome Web Store listing |

The agent core is plain TypeScript with no browser code inside, so moving it into a local server later doesn't mean rewriting it.

## How it works for you

You never leave the GitHub tab.

1. **Open a doc** from the repo on github.com. The side panel shows where the doc sits in your reading path, and which of its concepts you marked unclear.
2. **Select text** and pick Explain here, Example or Where it's used, or type a question.
3. **Read the answer in the panel.** It's short and cites docs and headings. It connects to docs you've read, and points ahead instead of explaining docs you haven't reached.
4. **Mark it.** Got it or Still unclear updates your memory. Follow-up buttons let you keep going without typing.
5. **Check your memory** on the panel's Memory page: edit your profile, progress and concept ledger, or export everything.

An example: you're on model_quantization.md (#47 in the reading path) and select "KV Cache量化". Memory shows you finished kv_cache_paged_attention.md yesterday and marked FP8 as unclear.

> **KV Cache 量化, here:** this doc treats the KV cache as the third thing you can quantize, next to weights and activations [model_quantization.md].
>
> **Connects to:** yesterday's kv_cache_paged_attention.md, on why the cache fills GPU memory under long contexts and many users. Quantizing the cache shrinks that memory.
>
> **Careful with:** FP8, which you marked unclear. One extra line on what it means for the cache.
>
> **Later in your path:** llm_pricing.md (#66) uses the same cache to explain prompt-cache billing. No need to look now.
>
> [Got it] [Still unclear]

Without memory, the same click would explain what a KV cache is from scratch.

## Architecture

Four parts run inside the browser, and only two outside calls leave it: the repo download and the Claude API.

_Architecture diagram: see the live doc or the PDF copy._

Your selection travels down the left column. The agent core reads and writes memory in storage. The same core runs under Node for evals, which is why it contains no browser code.

| Part | Choice | Why |
| --- | --- | --- |
| Extension framework | WXT, TypeScript, Manifest V3 | Side panel and content scripts, with hot reload |
| Panel UI | React | Common, with plenty of examples |
| Storage | IndexedDB through Dexie; chrome.storage for settings and the key | Simple typed tables |
| Repo download | GitHub zip, unzipped with fflate | One request instead of one per file |
| Search | MiniSearch, with Intl.Segmenter for Chinese | Small keyword search, no server |
| Model calls | fetch, behind one ModelClient interface: Gemini by default, Claude Messages API as an option | No SDK needed, easy to read, and the provider is one adapter |
| Evals | Vitest under Node | Runs the same agent core |

## Repo index

The extension turns the repo into a small, searchable index once, and rebuilds it only when the repo changes.

1. **Download.** Fetch one zip of the default branch from GitHub. Each time the panel opens, one API call checks the latest commit; a new commit triggers a rebuild.
2. **Parse.** Read each Markdown file's frontmatter (title, keywords, tags) and split its text into sections at the headings. Each section keeps GitHub's heading anchor, so citations link straight to it.
3. **Doc map.** Write one line per doc: path, title and keywords. It's small enough to send with every question, and it's what keeps answers inside the repo.
4. **Concept index.** For each concept, list the docs that explain it and the docs that use it. Frontmatter keywords seed it. A doc explains a concept when the concept is in its title, and uses it when the term appears in its text.
5. **Reading path.** Follow the repo's roadmap links in order. Other repos fall back to the README's link order, then folder order.

For llm-master:

| Measure | Value |
| --- | --- |
| Markdown docs | 172 |
| Whole repo | Roughly 640K tokens, too big to send with each question |
| Typical doc | About 5,700 characters; the largest is about 24,000 |
| Docs with a title and keywords | 153 |
| Doc map | Roughly 15K tokens |
| Docs on the reading path | 160 |

Chinese text has no spaces between words, so search splits it with Intl.Segmenter, a word splitter built into both Chrome and Node.

## Memory

Five stores live in the browser on your machine: two describe the repo, three describe you.

| Store | What it holds | Example | Updated by |
| --- | --- | --- | --- |
| Repo index | Doc map, concept index, reading path | "KV Cache: explained in kv_cache_paged_attention.md, used in many other docs" | Rebuilt when the repo changes |
| Profile | Background, goals, answer language, length, what to skip | "Software engineer. Answer in English, keep Chinese terms. Short." | You, on the Memory page |
| Progress | Per doc: unread, reading or done, plus the last heading reached | "kv_cache_paged_attention.md: done" | Opening docs, and your Mark done clicks |
| Concept ledger | Per concept: seen, explained, got it or unclear, with links to the evidence | "PagedAttention: got it (thread, Oct 1)" | Answers, plus Got it and Still unclear clicks |
| Threads | Every question and answer, pinned to its doc, heading and quoted text | One per question | Each answer |

**Rules**

- Only you can mark a concept "got it". Opening a doc moves its concepts to "seen", never to "known".
- Everything stored is visible and editable on the Memory page.
- Export and import exist from day one: the profile as Markdown, everything else as JSON.

**What one question uses.** Before each call, the extension picks a small slice of memory without asking the model. It matches the selection against the concept index to find its concepts. It then takes their ledger entries, the read or unread status of docs that mention them, the last three threads on this doc, and your profile. That's a few hundred tokens, not your whole history.

**Where it's stored.** IndexedDB holds the repo index, progress, ledger and threads; extension storage holds the profile and settings. The unlimitedStorage permission removes size limits. Uninstalling the extension deletes everything, which is why export matters.

## Agent core

Two actions are one model call each, which makes them workflows. Two are a real agent that chooses what to read. Learning when each is right is the point of v0.

| Action | Kind | What goes in | Tools | Length |
| --- | --- | --- | --- | --- |
| Explain here | One call | Answer rules, doc map, current doc, selection and its heading, memory slice | None | Up to 150 words |
| Example | One call | Same, plus the doc's own examples when it has them | None | Up to 150 words and one small example |
| Where it's used | Agent, up to 5 steps | Answer rules, doc map, selection, memory slice | search_repo, read_section | Up to 200 words, one line per doc |
| Ask (typed question) | Agent, up to 5 steps | Same as Where it's used, plus the current doc | search_repo, read_section | Up to 200 words |

**Answer rules**, shared by all four:

```
You are a reading companion for the repo "{repo}".
1. Answer only what the selection needs, as this repo uses it.
2. Use the repo's terms, keeping its Chinese terms. Answer in {profile.language}.
3. Cite a doc and heading for every statement that comes from the repo.
4. Concepts marked known: don't re-explain. Docs already read: refer to them by name.
   Docs not yet read: point to them and their place in the path; don't explain them.
5. Outside knowledge only if the repo assumes it: minimal, labeled, tied back in one sentence.
6. Stay within the length limit. End with up to three follow-ups the repo can answer.
```

**Output**, as JSON: the answer, its citations (doc and heading), docs ahead in your path, follow-ups, and the concepts it explained.

**Checks before showing an answer.** Every cited doc and heading must exist in the index, and the answer must fit its length limit. On a failure the agent retries once, then drops the unsupported claim.

**The two tools**

- **search_repo(query)** returns the 8 best-matching sections: doc, heading, a 200-character snippet, read or unread, and position in your path. It uses keyword scoring over sections, boosted by the concept index; no embeddings.
- **read_section(doc, heading)** returns that section's text, capped at about 3K tokens.

**Caching.** The answer rules and the doc map come first and stay the same for every question on a repo, so the API can cache them. Your position, the selection and the memory slice come after.

## Keys and sharing

No key ever ships with the code; each user pastes their own.

- **Settings page.** Each user pastes their own Claude API key. During development, your key lives in a .env file listed in .gitignore. If a Claude key is ever pushed to a public GitHub repo, GitHub reports it to Anthropic, which deactivates it.
- **Only the side panel calls the API.** The script injected into github.com never sees the key. Calling the Claude API from a browser requires the anthropic-dangerous-direct-browser-access header.
- **Remember the key, or not.** Extension storage isn't encrypted, so by default the key stays in session storage, which lives in memory until the browser closes. A toggle saves it across restarts instead.
- **Limit the damage.** Use a key made just for this extension, with a spending limit, and rotate it now and then.
- **Sharing.** The code is a public repo that people load unpacked. An unlisted Chrome Web Store listing comes later, once someone else wants it.

## Evals

Fifteen test cases from llm-master check that answers stay in the repo, cite real sections, and skip what you already know.

**Each case** has a selection, an action, a memory state, the docs it should cite, and tangents it must not raise. A memory state is a sketch such as "finished docs 1–46 on the path, marked FP8 unclear". A text search proposes the expected docs, and you correct the list by hand.

**Starting concepts**, each mentioned in several docs, which is what Where it's used needs: KV Cache (15 docs), PagedAttention (5), Prefill (5), Rerank (23), Function Calling (22) and 结构化输出 (23).

| Check | How it's measured | Proposed pass mark |
| --- | --- | --- |
| Citations exist | Every cited doc and heading is in the index | Every answer |
| Expected docs found | Share of the expected docs that Where it's used cites | 80% or more |
| Memory respected | No re-explaining concepts marked known; no explaining unread docs; judged by a model | Every answer |
| No tangents | Paragraphs a judging model labels off-topic | 5% or less |
| Length | Words against the action's limit | Every answer |
| Steps and cost | Agent steps, tokens and cache hits per answer | Tracked, no target yet |

**When they run.** Under Node, with the same agent core and fake memory states, after every change to a prompt or tool. A drop blocks the change.

**Feedback.** A Still unclear or thumbs-down in the panel can be saved as a new case.

## Milestones

The agent comes before the extension: M0 and M1 run under Node, so you build and test the core before any UI exists.

_Milestones diagram (5 milestones, 4 gates): see the live doc or the PDF copy._

Rough effort, part-time: M0 and M1 take about a weekend together, M2 about one more, and M3 one to two.

| Milestone | What it teaches |
| --- | --- |
| M0 | Preparing context without embeddings: maps, indexes and reading order |
| M1 | Workflow versus agent, tool design, the loop itself, structured output, evals |
| M2 | Product plumbing: the extension lifecycle, streaming, key handling |
| M3 | Memory as context engineering: what to store, what to retrieve, and who may change it |
| M4 | Cost and speed: caching and budgets |

## Open decisions

Each has a proposed default, so building can start now.

| Decision | Options | Proposed default |
| --- | --- | --- |
| Answer language | English, Chinese, or match the question | Match the question, keeping the repo's Chinese terms |
| When a doc counts as done | A Mark done button only, or also scrolling to the end | The button, suggested when you reach the end |
| Remembering the API key | This browser session only, or across restarts | This session only, with a toggle |
| Model | Gemini Flash free tier, or Claude Sonnet / Haiku | Gemini 3.7 Flash during development (changed Oct 3, 2026: no API cost; 3.8 was often overloaded); Claude as a setting |
| Typed questions | Always the agent, or one call unless tools are needed | The agent, which may answer without tools |
| Reading path | The repo's roadmap order, or your own | Roadmap order, editable on the Memory page |

## References

- [llm-master](https://github.com/ChenglingL/llm-master): the first repo v0 targets.
- [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents): workflows versus agents, and starting simple.
- [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents): external memory, and what to load up front versus fetch on demand.
- [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching): why stable content goes first.
- [Claude API calls from the browser](https://simonwillison.net/2024/Aug/23/anthropic-dangerous-direct-browser-access/): the header direct browser calls need.
- [chrome.storage](https://developer.chrome.com/docs/extensions/reference/api/storage): session storage, plus the [older page](https://developer.chrome.com/docs/extensions/mv2/reference/storage) warning that regular storage isn't encrypted.
- [API key best practices](https://support.claude.com/en/articles/9767949-api-key-best-practices-keeping-your-keys-safe-and-secure): separate keys, spending limits, rotation, and leaked-key deactivation.
- [Chrome Web Store visibility](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution): public, unlisted and private listings.
