import { describe, expect, it } from "vitest";
import { AnswerFormatError, checkAnswer, countWords, dropFailures, parseAnswer, renderAnswer } from "./answer.ts";
import { openRepo } from "./repo.ts";
import { answerReply, reply, sampleIndex } from "./testing.ts";
import type { Answer } from "./types.ts";

const repo = openRepo(sampleIndex());
const good: Answer = {
  points: [
    { text: "PagedAttention 把 KV Cache 切成块。", source: "repo", citations: [{ doc: "docs/app/kv.md", anchor: "pagedattention-怎么省显存" }] },
    { text: "Paging is an old operating-system idea.", source: "outside", citations: [] },
  ],
  ahead: [{ doc: "docs/app/quant.md" }],
  followUps: ["KV Cache 能量化吗？"],
  conceptsExplained: ["PagedAttention"],
};

describe("parseAnswer", () => {
  it("reads the JSON from the last text block, after thinking", () => {
    expect(parseAnswer(answerReply(good))).toEqual(good);
  });

  it("rejects replies that aren't the answer JSON", () => {
    expect(() => parseAnswer(reply([{ type: "text", text: "Sure! Here's…" }]))).toThrow(AnswerFormatError);
    expect(() => parseAnswer(reply([{ type: "text", text: "{}" }]))).toThrow(/missing points/);
    expect(() => parseAnswer(reply([], "max_tokens"))).toThrow(/stop_reason: max_tokens/);
  });
});

describe("countWords", () => {
  it("counts Chinese words without spaces, and English words", () => {
    expect(countWords("Rerank 在召回之后重排序")).toBeGreaterThanOrEqual(4);
    expect(countWords("one two, three.")).toBe(3);
  });
});

describe("checkAnswer", () => {
  it("passes a well-formed answer", () => {
    expect(checkAnswer(good, repo, 150)).toEqual([]);
  });

  it("flags unknown docs and anchors, listing the real anchors", () => {
    const bad: Answer = {
      ...good,
      points: [
        { text: "a", source: "repo", citations: [{ doc: "docs/app/nope.md", anchor: "x" }] },
        { text: "b", source: "repo", citations: [{ doc: "docs/app/kv.md", anchor: "made-up" }] },
      ],
    };
    const problems = checkAnswer(bad, repo, 150);
    expect(problems.map((p) => [p.kind, p.point])).toEqual([
      ["citation", 0],
      ["citation", 1],
    ]);
    expect(problems[1]?.message).toContain("Its sections: kv-cache-详解");
  });

  it("flags repo points without citations and outside points with them", () => {
    const bad: Answer = {
      ...good,
      points: [
        { text: "a", source: "repo", citations: [] },
        { text: "b", source: "outside", citations: [{ doc: "docs/app/kv.md", anchor: "前缀缓存" }] },
      ],
    };
    expect(checkAnswer(bad, repo, 150).map((p) => p.point)).toEqual([0, 1]);
  });

  it("flags unknown ahead docs, too many follow-ups and long answers", () => {
    const bad: Answer = {
      ...good,
      points: [{ text: "word ".repeat(20), source: "outside", citations: [] }],
      ahead: [{ doc: "docs/nope.md" }],
      followUps: ["1", "2", "3", "4"],
    };
    expect(checkAnswer(bad, repo, 10).map((p) => p.kind)).toEqual(["ahead", "followups", "length"]);
  });
});

describe("dropFailures", () => {
  it("removes failing points and ahead docs, and trims follow-ups", () => {
    const bad: Answer = {
      ...good,
      points: [...good.points, { text: "unsupported", source: "repo", citations: [] }],
      ahead: [...good.ahead, { doc: "docs/nope.md" }],
      followUps: ["1", "2", "3", "4"],
    };
    const { answer, dropped } = dropFailures(bad, checkAnswer(bad, repo, 150));
    expect(answer.points).toEqual(good.points);
    expect(answer.ahead).toEqual(good.ahead);
    expect(answer.followUps).toEqual(["1", "2", "3"]);
    expect(dropped.map((p) => p.text)).toEqual(["unsupported"]);
  });
});

describe("renderAnswer", () => {
  it("links citations to the indexed commit and labels outside knowledge", () => {
    const text = renderAnswer(good, repo);
    expect(text).toContain(
      `[kv.md › PagedAttention 怎么省显存](https://github.com/owner/repo/blob/abc1234/docs/app/kv.md#${encodeURIComponent("pagedattention-怎么省显存")})`,
    );
    expect(text).toContain("_Outside the repo:_ Paging is an old operating-system idea.");
    expect(text).toContain("**Later in your path:** quant.md (#2)");
  });
});
