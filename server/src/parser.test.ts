import { describe, expect, it } from "vitest";
import { buildDailyStats, buildRequests, buildSessionSummary } from "./aggregate.js";
import { CostCalculator, type PricingTable } from "./cost.js";
import { LineFeeder, SessionParser } from "./parser.js";

const pricing: PricingTable = {
  models: [
    { match: "claude-opus-4", input: 5, output: 25 },
    { match: "claude-haiku-4-5", input: 1, output: 5 },
    { match: "<synthetic>", input: 0, output: 0 },
  ],
  cacheWrite5mMultiplier: 1.25,
  cacheWrite1hMultiplier: 2.0,
  cacheReadMultiplier: 0.1,
};
const calc = new CostCalculator(pricing);

function assistantLine(opts: {
  requestId: string;
  uuid: string;
  model?: string;
  input?: number;
  output?: number;
  cacheRead?: number;
  cache5m?: number;
  cache1h?: number;
  omitBreakdown?: boolean;
  isSidechain?: boolean;
  timestamp?: string;
  content?: unknown[];
}): string {
  const usage: Record<string, unknown> = {
    input_tokens: opts.input ?? 0,
    output_tokens: opts.output ?? 0,
    cache_read_input_tokens: opts.cacheRead ?? 0,
    cache_creation_input_tokens: (opts.cache5m ?? 0) + (opts.cache1h ?? 0),
  };
  if (!opts.omitBreakdown) {
    usage.cache_creation = {
      ephemeral_5m_input_tokens: opts.cache5m ?? 0,
      ephemeral_1h_input_tokens: opts.cache1h ?? 0,
    };
  }
  return JSON.stringify({
    type: "assistant",
    uuid: opts.uuid,
    requestId: opts.requestId,
    isSidechain: opts.isSidechain ?? false,
    timestamp: opts.timestamp ?? "2026-06-01T00:00:00.000Z",
    message: {
      model: opts.model ?? "claude-opus-4-7",
      usage,
      content: opts.content ?? [{ type: "text", text: "hello" }],
    },
  });
}

function parse(lines: string[]): SessionParser {
  const p = new SessionParser("test-session");
  for (const l of lines) p.pushLine(l);
  return p;
}

describe("SessionParser", () => {
  it("同一 requestId のレコードを 1 リクエストに重複排除し、usage は最新値で上書きする", () => {
    const p = parse([
      assistantLine({ requestId: "req_1", uuid: "u1", input: 100, output: 10 }),
      assistantLine({ requestId: "req_1", uuid: "u2", input: 100, output: 50 }),
      assistantLine({ requestId: "req_2", uuid: "u3", input: 200, output: 5 }),
    ]);
    expect(p.result.requests).toHaveLength(2);
    expect(p.result.requests[0]!.usage.output).toBe(50);
    expect(p.result.requests[0]!.uuid).toBe("u1");
  });

  it("コンテキストサイズ = input + cacheRead + cacheCreation", () => {
    const p = parse([
      assistantLine({ requestId: "r", uuid: "u", input: 10, cacheRead: 1000, cache5m: 200, cache1h: 300 }),
    ]);
    expect(p.result.requests[0]!.contextTokens).toBe(10 + 1000 + 200 + 300);
  });

  it("cache_creation の内訳が無い場合は全量 5m TTL として扱う", () => {
    const p = parse([
      assistantLine({ requestId: "r", uuid: "u", cache5m: 700, omitBreakdown: true }),
    ]);
    expect(p.result.requests[0]!.usage.cacheCreation5m).toBe(700);
    expect(p.result.requests[0]!.usage.cacheCreation1h).toBe(0);
  });

  it("compact_boundary をイベントとトランスクリプトに記録する", () => {
    const p = parse([
      JSON.stringify({
        type: "system",
        subtype: "compact_boundary",
        uuid: "c1",
        timestamp: "2026-06-01T01:00:00.000Z",
        compactMetadata: { trigger: "auto", preTokens: 150000, postTokens: 8000 },
      }),
    ]);
    expect(p.result.compactions).toEqual([
      { uuid: "c1", timestamp: "2026-06-01T01:00:00.000Z", preTokens: 150000, postTokens: 8000, trigger: "auto" },
    ]);
    expect(p.result.transcript[0]!.type).toBe("compact");
  });

  it("sidechain フラグを保持する", () => {
    const p = parse([assistantLine({ requestId: "r", uuid: "u", isSidechain: true })]);
    expect(p.result.requests[0]!.isSidechain).toBe(true);
    expect(p.result.transcript[0]!.isSidechain).toBe(true);
  });

  it("user レコード: 文字列 content と tool_result を区別する", () => {
    const p = parse([
      JSON.stringify({
        type: "user",
        uuid: "u1",
        timestamp: "2026-06-01T00:00:00.000Z",
        message: { role: "user", content: "こんにちは" },
      }),
      JSON.stringify({
        type: "user",
        uuid: "u2",
        timestamp: "2026-06-01T00:00:01.000Z",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t1", content: "result text" }],
        },
      }),
      JSON.stringify({
        type: "user",
        uuid: "u3",
        isMeta: true,
        timestamp: "2026-06-01T00:00:02.000Z",
        message: { role: "user", content: "meta は無視" },
      }),
    ]);
    expect(p.result.transcript.map((t) => t.type)).toEqual(["user", "tool_result"]);
    expect(p.result.firstUserText).toBe("こんにちは");
  });

  it("assistant の tool_use をプレビューに含める", () => {
    const p = parse([
      assistantLine({
        requestId: "r",
        uuid: "u",
        content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls -la" } }],
      }),
    ]);
    expect(p.result.transcript[0]!.toolUses).toEqual([{ name: "Bash", detail: "ls -la" }]);
  });

  it("タイトルは aiTitle 優先、無ければ summary", () => {
    const p = parse([
      JSON.stringify({ type: "summary", summary: "サマリ", leafUuid: "x" }),
      JSON.stringify({ type: "ai-title", aiTitle: "AI タイトル", sessionId: "s" }),
    ]);
    expect(p.result.title).toBe("AI タイトル");
  });

  it("turn_duration を直前のアイテムに付与する", () => {
    const p = parse([
      assistantLine({ requestId: "r", uuid: "u" }),
      JSON.stringify({ type: "system", subtype: "turn_duration", uuid: "d", durationMs: 1234, timestamp: "2026-06-01T00:01:00.000Z" }),
    ]);
    expect(p.result.transcript[0]!.durationMs).toBe(1234);
  });

  it("壊れた行はスキップする", () => {
    const p = parse(['{"type":"assistant", BROKEN', assistantLine({ requestId: "r", uuid: "u" })]);
    expect(p.result.requests).toHaveLength(1);
  });
});

describe("LineFeeder", () => {
  it("チャンク境界をまたぐ行を正しく結合し、消費バイト数は完全な行のみ数える", () => {
    const p = new SessionParser("s");
    const feeder = new LineFeeder(p);
    const line1 = assistantLine({ requestId: "r1", uuid: "u1" });
    const line2 = assistantLine({ requestId: "r2", uuid: "u2" });
    const all = `${line1}\n${line2}\n`;
    const cut = line1.length + 5; // line2 の途中で分割
    feeder.feed(all.slice(0, cut));
    expect(p.result.requests).toHaveLength(1);
    expect(feeder.consumedBytes).toBe(Buffer.byteLength(line1, "utf8") + 1);
    feeder.feed(all.slice(cut));
    expect(p.result.requests).toHaveLength(2);
    expect(feeder.consumedBytes).toBe(Buffer.byteLength(all, "utf8"));
  });

  it("resetRemainder 後に同じ行を先頭から再供給しても dedupe で二重計上されない", () => {
    const p = new SessionParser("s");
    const feeder = new LineFeeder(p);
    const line = assistantLine({ requestId: "r1", uuid: "u1" });
    feeder.feed(line.slice(0, 10)); // 端数だけ供給（改行なし）
    feeder.resetRemainder();
    feeder.feed(`${line}\n`); // consumedBytes 位置から再読込された想定
    expect(p.result.requests).toHaveLength(1);
  });
});

describe("CostCalculator / aggregate", () => {
  it("cache write/read の倍率を含めてコストを計算する", () => {
    const p = parse([
      assistantLine({
        requestId: "r",
        uuid: "u",
        model: "claude-opus-4-7",
        input: 1_000_000,
        output: 1_000_000,
        cacheRead: 1_000_000,
        cache5m: 1_000_000,
        cache1h: 1_000_000,
      }),
    ]);
    const { requests, totals } = buildRequests(p.result, calc);
    // input 5 + output 25 + read 0.5 + 5m write 6.25 + 1h write 10 = 46.75
    expect(requests[0]!.costUsd).toBeCloseTo(46.75, 6);
    expect(totals.costUsd).toBeCloseTo(46.75, 6);
  });

  it("日付サフィックス付きモデル ID を前方一致で解決する", () => {
    const p = parse([
      assistantLine({ requestId: "r", uuid: "u", model: "claude-haiku-4-5-20251001", output: 1_000_000 }),
    ]);
    const { requests } = buildRequests(p.result, calc);
    expect(requests[0]!.costUsd).toBeCloseTo(5, 6);
  });

  it("未知モデルはコスト 0 で unknownModels に記録する", () => {
    const p = parse([
      assistantLine({ requestId: "r", uuid: "u", model: "claude-future-9", input: 1000 }),
    ]);
    const { totals } = buildRequests(p.result, calc);
    expect(totals.costUsd).toBe(0);
    expect(totals.unknownModels).toEqual(["claude-future-9"]);
  });

  it("maxContextTokens は sidechain を除外する", () => {
    const p = parse([
      assistantLine({ requestId: "r1", uuid: "u1", input: 100 }),
      assistantLine({ requestId: "r2", uuid: "u2", input: 999_999, isSidechain: true }),
    ]);
    const { totals } = buildRequests(p.result, calc);
    expect(totals.maxContextTokens).toBe(100);
  });

  it("buildDailyStats が (日付, モデル) で集計する", () => {
    const p1 = parse([
      assistantLine({ requestId: "a", uuid: "u1", output: 10, timestamp: "2026-06-01T12:00:00.000Z" }),
      assistantLine({ requestId: "b", uuid: "u2", output: 20, timestamp: "2026-06-01T13:00:00.000Z" }),
      assistantLine({ requestId: "c", uuid: "u3", output: 30, timestamp: "2026-06-02T12:00:00.000Z" }),
    ]);
    const daily = buildDailyStats([p1.result], calc);
    expect(daily).toHaveLength(2);
    expect(daily[0]!.outputTokens).toBe(30);
    expect(daily[1]!.outputTokens).toBe(30);
  });

  it("buildSessionSummary がタイトルのフォールバックを行う", () => {
    const p = parse([
      JSON.stringify({
        type: "user",
        uuid: "u1",
        timestamp: "2026-06-01T00:00:00.000Z",
        message: { role: "user", content: "最初の発言から作るタイトル" },
      }),
    ]);
    const s = buildSessionSummary(p.result, "proj", calc);
    expect(s.title).toBe("最初の発言から作るタイトル");
  });
});
