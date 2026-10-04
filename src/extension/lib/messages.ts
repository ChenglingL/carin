// Messages between the content script (on github.com) and the side panel.
// The content script never sees the API key: it only reports what the reader is looking at.

import type { PageInfo, SelectionInfo } from "./page.ts";

export type CairnMessage =
  | { type: "cairn:selection"; info: SelectionInfo } // content script → panel, on each selection
  | { type: "cairn:get-context" }; // panel → content script, when the panel opens

export interface PageContext {
  page: PageInfo | null; // null when the tab isn't a Markdown doc on github.com
  last: SelectionInfo | null; // the latest selection on this page, if any
}
