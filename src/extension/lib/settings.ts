// Settings and API keys. Keys live in session storage by default (in memory until the browser
// closes, docs/PLAN.md § Keys and sharing); "remember" moves them to local storage. Neither is
// readable from content scripts, so github.com never sees a key.

import { GEMINI_MODEL } from "../../core/gemini.ts";
import { DEFAULT_MODEL } from "../../core/model.ts";

export type Provider = "gemini" | "claude";

export interface Settings {
  provider: Provider;
  model: string;
  remember: boolean; // keep keys across browser restarts
}

export type Keys = Partial<Record<Provider, string>>;

export const DEFAULT_SETTINGS: Settings = { provider: "gemini", model: GEMINI_MODEL, remember: false };
export const DEFAULT_MODELS: Record<Provider, string> = { gemini: GEMINI_MODEL, claude: DEFAULT_MODEL };

export async function loadSettings(): Promise<{ settings: Settings; keys: Keys }> {
  const stored = await browser.storage.local.get(["settings", "keys"]);
  const session = await browser.storage.session.get("keys");
  const settings = { ...DEFAULT_SETTINGS, ...(stored.settings as Partial<Settings> | undefined) };
  const keys = { ...(stored.keys as Keys | undefined), ...(session.keys as Keys | undefined) };
  return { settings, keys };
}

export async function saveSettings(settings: Settings, keys: Keys): Promise<void> {
  await browser.storage.local.set({ settings });
  if (settings.remember) {
    await browser.storage.local.set({ keys });
    await browser.storage.session.remove("keys");
  } else {
    await browser.storage.session.set({ keys });
    await browser.storage.local.remove("keys");
  }
}
