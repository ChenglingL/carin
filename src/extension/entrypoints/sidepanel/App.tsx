import { useCallback, useEffect, useRef, useState } from "react";
import type { Repo } from "../../../core/repo.ts";
import type { Action, AnswerResult } from "../../../core/types.ts";
import { ask, forgetRepo, loadRepo } from "@/lib/engine";
import type { CairnMessage, PageContext } from "@/lib/messages";
import { parseGithubUrl, type SelectionInfo } from "@/lib/page";
import { DEFAULT_MODELS, DEFAULT_SETTINGS, loadSettings, saveSettings, type Keys, type Provider, type Settings } from "@/lib/settings";

type RepoState =
  | { status: "none" }
  | { status: "loading"; note: string }
  | { status: "ready"; repo: Repo }
  | { status: "error"; message: string };

type RunState =
  | { status: "idle" }
  | { status: "running"; action: Action; note: string }
  | { status: "done"; action: Action; result: AnswerResult }
  | { status: "error"; message: string };

const ACTION_LABELS: Record<Action, string> = {
  explain: "Explain here",
  example: "Example",
  "where-used": "Where it's used",
  ask: "Ask",
};

async function readActiveTab(): Promise<{ tabId: number | null; context: PageContext }> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) return { tabId: null, context: { page: null, last: null } };
  try {
    const message: CairnMessage = { type: "cairn:get-context" };
    return { tabId: tab.id, context: (await browser.tabs.sendMessage(tab.id, message)) as PageContext };
  } catch {
    // The content script isn't in this tab yet (e.g. it was open before the extension loaded).
    return { tabId: tab.id, context: { page: parseGithubUrl(tab.url), last: null } };
  }
}

export function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [keys, setKeys] = useState<Keys>({});
  const [showSettings, setShowSettings] = useState(false);
  const [tabId, setTabId] = useState<number | null>(null);
  const [context, setContext] = useState<PageContext>({ page: null, last: null });
  const [repoState, setRepoState] = useState<RepoState>({ status: "none" });
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [typed, setTyped] = useState("");
  const [run, setRun] = useState<RunState>({ status: "idle" });
  const loadedRepo = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const { tabId, context } = await readActiveTab();
    setTabId(tabId);
    setContext(context);
    if (context.last) setSelection(context.last);
  }, []);

  // Settings, the active tab, and selections as they happen.
  useEffect(() => {
    void loadSettings().then(({ settings, keys }) => {
      setSettings(settings);
      setKeys(keys);
      if (!keys[settings.provider]) setShowSettings(true);
    });
    void refresh();
    const onMessage = (message: CairnMessage) => {
      if (message.type === "cairn:selection") {
        setSelection(message.info);
        setContext((current) => ({ ...current, page: message.info.page }));
      }
    };
    const onTabChange = () => void refresh();
    const onTabUpdated = (_id: number, change: { url?: string; status?: string }) => {
      if (change.url || change.status === "complete") void refresh();
    };
    browser.runtime.onMessage.addListener(onMessage);
    browser.tabs.onActivated.addListener(onTabChange);
    browser.tabs.onUpdated.addListener(onTabUpdated);
    return () => {
      browser.runtime.onMessage.removeListener(onMessage);
      browser.tabs.onActivated.removeListener(onTabChange);
      browser.tabs.onUpdated.removeListener(onTabUpdated);
    };
  }, [refresh]);

  // The index for the repo in the active tab: cached, or downloaded and built once.
  const page = context.page;
  useEffect(() => {
    if (!page) return;
    if (loadedRepo.current === page.repo) return;
    loadedRepo.current = page.repo;
    setRepoState({ status: "loading", note: "Loading…" });
    loadRepo(page.repo, page.ref, (note) => setRepoState({ status: "loading", note }))
      .then((repo) => setRepoState({ status: "ready", repo }))
      .catch((error: Error) => {
        loadedRepo.current = null;
        setRepoState({ status: "error", message: error.message });
      });
  }, [page]);

  const repo = repoState.status === "ready" ? repoState.repo : null;
  const doc = repo && page ? repo.doc(page.path) : undefined;
  const position = repo && page ? repo.position(page.path) : null;
  const activeSelection = selection && page && selection.page.url === page.url ? selection : null;

  async function runAction(action: Action, text?: string) {
    if (!repo || !page) return;
    const anchor = activeSelection?.anchor && repo.section(page.path, activeSelection.anchor) ? activeSelection.anchor : null;
    const question = {
      doc: page.path,
      anchor,
      selection: activeSelection?.selection ?? "",
      text: action === "ask" ? (text ?? typed).trim() || null : null,
    };
    setRun({ status: "running", action, note: "Thinking…" });
    try {
      const result = await ask(action, question, repo, settings, keys, (note) =>
        setRun((current) => (current.status === "running" ? { ...current, note } : current)),
      );
      setRun({ status: "done", action, result });
    } catch (error) {
      setRun({ status: "error", message: (error as Error).message });
    }
  }

  function openUrl(url: string) {
    if (tabId !== null) void browser.tabs.update(tabId, { url });
  }

  async function rebuildIndex() {
    if (!page) return;
    await forgetRepo(page.repo);
    loadedRepo.current = null;
    setContext((current) => ({ ...current, page: current.page ? { ...current.page } : null }));
  }

  const busy = run.status === "running";
  const ready = Boolean(repo && doc && doc.kind !== "stub");

  return (
    <main>
      <header>
        <div>
          <h1>Cairn</h1>
          <p className="muted">
            {page ? (
              <>
                {page.repo}
                {doc ? <> · {page.path.split("/").at(-1)}</> : null}
                {position ? <> · #{position} of {repo?.index.readingPath.length}</> : null}
              </>
            ) : (
              "Open a Markdown doc on github.com"
            )}
          </p>
        </div>
        <button className="ghost" onClick={() => setShowSettings((v) => !v)} aria-expanded={showSettings}>
          Settings
        </button>
      </header>

      {showSettings && (
        <SettingsForm
          settings={settings}
          keys={keys}
          canRebuild={Boolean(page)}
          onRebuild={rebuildIndex}
          onSave={async (next, nextKeys) => {
            await saveSettings(next, nextKeys);
            setSettings(next);
            setKeys(nextKeys);
            setShowSettings(false);
          }}
        />
      )}

      {repoState.status === "loading" && <p className="status">{repoState.note}</p>}
      {repoState.status === "error" && <p className="error">Couldn't load the repo: {repoState.message}</p>}
      {repo && page && !doc && <p className="muted">This page isn't one of the repo's Markdown docs.</p>}

      {ready && (
        <section className="question">
          <blockquote className={activeSelection ? "" : "muted"}>
            {activeSelection ? activeSelection.selection : "Select text in the doc, or type a question below."}
          </blockquote>
          <div className="actions">
            {(["explain", "example", "where-used"] as const).map((action) => (
              <button key={action} disabled={busy || !activeSelection} onClick={() => void runAction(action)}>
                {ACTION_LABELS[action]}
              </button>
            ))}
          </div>
          <form
            className="ask"
            onSubmit={(event) => {
              event.preventDefault();
              if (typed.trim()) void runAction("ask");
            }}
          >
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Ask about this repo…" disabled={busy} />
            <button type="submit" disabled={busy || !typed.trim()}>
              Ask
            </button>
          </form>
        </section>
      )}

      {run.status === "running" && (
        <p className="status">
          {ACTION_LABELS[run.action]}: {run.note}
        </p>
      )}
      {run.status === "error" && <p className="error">{run.message}</p>}
      {run.status === "done" && repo && (
        <AnswerView
          result={run.result}
          repo={repo}
          onOpen={openUrl}
          onFollowUp={(q) => {
            setTyped(q);
            void runAction("ask", q);
          }}
        />
      )}
    </main>
  );
}

function AnswerView(props: { result: AnswerResult; repo: Repo; onOpen: (url: string) => void; onFollowUp: (q: string) => void }) {
  const { answer, trace } = props.result;
  const { repo } = props;
  const cite = (doc: string, anchor: string) => {
    const heading = repo.section(doc, anchor)?.heading || anchor;
    return (
      <button key={`${doc}#${anchor}`} className="cite" onClick={() => props.onOpen(repo.url(doc, anchor))} title={`${doc}#${anchor}`}>
        {doc.split("/").at(-1)} › {heading}
      </button>
    );
  };
  return (
    <section className="answer">
      {answer.points.length === 0 && <p className="muted">No answer the repo supports.</p>}
      {answer.points.map((point, i) => (
        <p key={i} className={point.source === "outside" ? "outside" : ""}>
          {point.source === "outside" && <span className="tag">Outside the repo</span>}
          {point.text} {point.citations.map((c) => cite(c.doc, c.anchor))}
        </p>
      ))}
      {answer.ahead.length > 0 && (
        <p className="ahead">
          <strong>Later in your path:</strong>{" "}
          {answer.ahead.map(({ doc }) => (
            <button key={doc} className="cite" onClick={() => props.onOpen(repo.url(doc))}>
              {doc.split("/").at(-1)} (#{repo.position(doc) ?? "?"})
            </button>
          ))}
        </p>
      )}
      {answer.followUps.length > 0 && (
        <div className="followups">
          {answer.followUps.map((q) => (
            <button key={q} className="ghost" onClick={() => props.onFollowUp(q)}>
              {q}
            </button>
          ))}
        </div>
      )}
      <p className="trace">
        {trace.model} · {trace.calls} call{trace.calls === 1 ? "" : "s"} · {trace.toolCalls.length} tool call
        {trace.toolCalls.length === 1 ? "" : "s"} · {(trace.ms / 1000).toFixed(1)}s
        {trace.retried ? " · retried" : ""}
        {trace.dropped.length ? ` · ${trace.dropped.length} unsupported point(s) dropped` : ""}
      </p>
    </section>
  );
}

function SettingsForm(props: {
  settings: Settings;
  keys: Keys;
  canRebuild: boolean;
  onRebuild: () => Promise<void>;
  onSave: (settings: Settings, keys: Keys) => Promise<void>;
}) {
  const [settings, setSettings] = useState(props.settings);
  const [keys, setKeys] = useState(props.keys);
  const provider = settings.provider;
  return (
    <form
      className="settings"
      onSubmit={(event) => {
        event.preventDefault();
        void props.onSave(settings, keys);
      }}
    >
      <label>
        Provider
        <select
          value={provider}
          onChange={(e) => {
            const next = e.target.value as Provider;
            setSettings({ ...settings, provider: next, model: DEFAULT_MODELS[next] });
          }}
        >
          <option value="gemini">Gemini (free tier)</option>
          <option value="claude">Claude</option>
        </select>
      </label>
      <label>
        Model
        <input value={settings.model} onChange={(e) => setSettings({ ...settings, model: e.target.value })} />
      </label>
      <label>
        {provider === "gemini" ? "Gemini API key (aistudio.google.com)" : "Claude API key (platform.claude.com)"}
        <input
          type="password"
          autoComplete="off"
          value={keys[provider] ?? ""}
          onChange={(e) => setKeys({ ...keys, [provider]: e.target.value.trim() })}
        />
      </label>
      <label className="check">
        <input type="checkbox" checked={settings.remember} onChange={(e) => setSettings({ ...settings, remember: e.target.checked })} />
        Remember keys after the browser closes
      </label>
      <div className="row">
        <button type="submit">Save</button>
        {props.canRebuild && (
          <button type="button" className="ghost" onClick={() => void props.onRebuild()}>
            Rebuild index
          </button>
        )}
      </div>
    </form>
  );
}
