import { defineConfig } from "wxt";

// The Chrome extension (M2). Only src/extension/ uses browser APIs; it reuses src/index and src/core as they are.
export default defineConfig({
  srcDir: "src/extension",
  outDir: "dist", // not a dot folder, so it shows in Chrome's "Load unpacked" picker
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Cairn",
    description: "Ask about the GitHub repo you're reading, in a side panel.",
    action: { default_title: "Open Cairn" },
    permissions: ["storage", "unlimitedStorage", "sidePanel"],
    host_permissions: [
      "https://github.com/*", // the content script reads the page and the selection
      "https://api.github.com/*", // latest commit of the repo
      "https://codeload.github.com/*", // the repo zip
      "https://generativelanguage.googleapis.com/*", // Gemini
      "https://api.anthropic.com/*", // Claude
    ],
  },
});
