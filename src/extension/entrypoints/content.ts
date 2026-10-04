// Runs on github.com. Reports what the reader selects (text, doc, section) to the side panel.
// It never calls the model and never sees the API key.

import type { CairnMessage, PageContext } from "@/lib/messages";
import { parseGithubUrl, sectionAnchorBefore, type SelectionInfo } from "@/lib/page";

export default defineContentScript({
  matches: ["https://github.com/*"],
  main() {
    let last: SelectionInfo | null = null;

    const report = () => {
      const page = parseGithubUrl(location.href);
      const selection = window.getSelection();
      const text = selection?.toString().trim() ?? "";
      if (!page || !selection || selection.rangeCount === 0 || text === "") return;
      const info: SelectionInfo = {
        page,
        selection: text.slice(0, 1000),
        anchor: sectionAnchorBefore(selection.getRangeAt(0).startContainer),
      };
      if (last && last.selection === info.selection && last.page.url === info.page.url) return;
      last = info;
      const message: CairnMessage = { type: "cairn:selection", info };
      browser.runtime.sendMessage(message).catch(() => {}); // the panel may be closed; that's fine
    };

    document.addEventListener("mouseup", () => setTimeout(report, 0)); // after the selection settles
    document.addEventListener("keyup", (event) => {
      if (event.shiftKey) report(); // keyboard selections
    });

    browser.runtime.onMessage.addListener((message: CairnMessage, _sender, sendResponse) => {
      if (message.type !== "cairn:get-context") return;
      const page = parseGithubUrl(location.href);
      const context: PageContext = { page, last: last && page && last.page.url === page.url ? last : null };
      sendResponse(context);
    });
  },
});
