import { describe, expect, it } from "vitest";
import { estimateTokens } from "../../index/doc-map.ts";
import { ANSWER_RULES_VERSION, answerRules } from "./answer-rules.ts";

describe("answerRules", () => {
  const rules = () => answerRules({ repo: "ChenglingL/llm-master" });

  it("has a version, bumped from 0 when first written", () => {
    expect(ANSWER_RULES_VERSION).toBeGreaterThanOrEqual(1);
  });

  it("names the repo and leaves no {placeholders}", () => {
    expect(rules()).toContain("ChenglingL/llm-master");
    expect(rules()).not.toMatch(/\{[a-zA-Z.]+\}/);
  });

  it("is identical on every call, so it can be cached", () => {
    expect(rules()).toBe(rules());
  });

  it("covers outside knowledge and docs ahead in the path", () => {
    expect(rules()).toMatch(/outside/i);
    expect(rules()).toMatch(/ahead/i);
  });

  it("stays short: under 1,000 tokens", () => {
    expect(estimateTokens(rules())).toBeLessThan(1000);
  });
});
