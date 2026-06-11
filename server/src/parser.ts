import { createReadStream } from "node:fs";
import type {
  ApiRequestInfo,
  CompactEvent,
  ToolUsePreview,
  TranscriptItem,
  UsageBreakdown,
} from "./types.js";

const TEXT_PREVIEW_LIMIT = 500;
const TOOL_DETAIL_LIMIT = 200;

export interface ParsedSession {
  sessionId: string;
  title: string | null;
  cwd: string | null;
  startTime: string | null;
  endTime: string | null;
  models: string[];
  requests: Omit<ApiRequestInfo, "costUsd">[];
  compactions: CompactEvent[];
  transcript: TranscriptItem[];
  firstUserText: string | null;
}

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function usageFromRecord(usage: any): UsageBreakdown {
  const total = usage.cache_creation_input_tokens ?? 0;
  const cc = usage.cache_creation;
  // 5m/1h の内訳が無い古いレコードは全量 5m TTL として扱う（料金は安全側でなく実勢側）
  const c5m = cc ? (cc.ephemeral_5m_input_tokens ?? 0) : total;
  const c1h = cc ? (cc.ephemeral_1h_input_tokens ?? 0) : 0;
  return {
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheCreation5m: c5m,
    cacheCreation1h: c1h,
  };
}

function toolUseDetail(input: unknown): string {
  if (input == null || typeof input !== "object") return "";
  const o = input as Record<string, unknown>;
  // 代表的なツールの主要フィールドを優先して 1 行プレビューを作る
  for (const k of ["description", "command", "file_path", "pattern", "prompt", "query", "url", "skill"]) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return truncate(v.trim(), TOOL_DETAIL_LIMIT);
  }
  try {
    return truncate(JSON.stringify(o), TOOL_DETAIL_LIMIT);
  } catch {
    return "";
  }
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b: any) => b?.type === "text" && typeof b.text === "string")
    .map((b: any) => b.text)
    .join("\n");
}

/**
 * 1 セッション分の JSONL レコードを逐次受け取って集計するステートフルなパーサ。
 * ライブ更新時は同一インスタンスに追記行だけを流し込めば dedupe 状態が維持される。
 */
export class SessionParser {
  private requestIndex = new Map<string, number>();
  private modelSet = new Set<string>();
  private aiTitle: string | null = null;
  private summaryTitle: string | null = null;

  readonly result: ParsedSession;

  constructor(sessionId: string) {
    this.result = {
      sessionId,
      title: null,
      cwd: null,
      startTime: null,
      endTime: null,
      models: [],
      requests: [],
      compactions: [],
      transcript: [],
      firstUserText: null,
    };
  }

  pushLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let rec: any;
    try {
      rec = JSON.parse(trimmed);
    } catch {
      return; // 壊れた行（書き込み途中など）は無視
    }
    this.pushRecord(rec);
  }

  private pushRecord(rec: any): void {
    const r = this.result;
    if (typeof rec.timestamp === "string") {
      if (!r.startTime || rec.timestamp < r.startTime) r.startTime = rec.timestamp;
      if (!r.endTime || rec.timestamp > r.endTime) r.endTime = rec.timestamp;
    }
    if (!r.cwd && typeof rec.cwd === "string") r.cwd = rec.cwd;

    switch (rec.type) {
      case "assistant":
        this.pushAssistant(rec);
        break;
      case "user":
        this.pushUser(rec);
        break;
      case "system":
        if (rec.subtype === "compact_boundary") this.pushCompact(rec);
        else if (rec.subtype === "turn_duration") this.pushTurnDuration(rec);
        break;
      case "ai-title":
        if (typeof rec.aiTitle === "string") this.aiTitle = rec.aiTitle;
        break;
      case "summary":
        if (typeof rec.summary === "string") this.summaryTitle = rec.summary;
        break;
      default:
        break;
    }
    r.title = this.aiTitle ?? this.summaryTitle;
    r.models = [...this.modelSet];
  }

  private pushAssistant(rec: any): void {
    const msg = rec.message;
    if (!msg) return;
    const isSidechain = rec.isSidechain === true;
    const model: string = typeof msg.model === "string" ? msg.model : "unknown";

    if (msg.usage) {
      const key: string = rec.requestId ?? msg.id ?? rec.uuid;
      const usage = usageFromRecord(msg.usage);
      const contextTokens = usage.input + usage.cacheRead + usage.cacheCreation5m + usage.cacheCreation1h;
      const existing = this.requestIndex.get(key);
      if (existing !== undefined) {
        // ストリーミング中は同一リクエストのスナップショットが複数行書かれる。
        // 後続行ほど usage が確定値に近いため最新値で上書きする。
        const req = this.result.requests[existing]!;
        req.usage = usage;
        req.contextTokens = contextTokens;
      } else {
        this.requestIndex.set(key, this.result.requests.length);
        this.modelSet.add(model);
        this.result.requests.push({
          key,
          uuid: rec.uuid,
          timestamp: rec.timestamp,
          model,
          isSidechain,
          usage,
          contextTokens,
        });
      }
    }

    const text = textFromContent(msg.content);
    const toolUses: ToolUsePreview[] = Array.isArray(msg.content)
      ? msg.content
          .filter((b: any) => b?.type === "tool_use")
          .map((b: any) => ({ name: String(b.name ?? "?"), detail: toolUseDetail(b.input) }))
      : [];
    if (text.trim() || toolUses.length > 0) {
      this.result.transcript.push({
        uuid: rec.uuid,
        type: "assistant",
        timestamp: rec.timestamp,
        isSidechain,
        text: truncate(text.trim(), TEXT_PREVIEW_LIMIT),
        ...(toolUses.length > 0 ? { toolUses } : {}),
        ...(msg.usage ? { requestKey: rec.requestId ?? msg.id ?? rec.uuid } : {}),
      });
    }
  }

  private pushUser(rec: any): void {
    if (rec.isMeta === true) return;
    const content = rec.message?.content;
    if (content == null) return;
    const isSidechain = rec.isSidechain === true;

    const text = textFromContent(content);
    const toolResults: string[] = Array.isArray(content)
      ? content
          .filter((b: any) => b?.type === "tool_result")
          .map((b: any) => textFromContent(b.content) || (typeof b.content === "string" ? b.content : ""))
      : [];

    if (text.trim()) {
      if (!this.result.firstUserText && !isSidechain) {
        this.result.firstUserText = truncate(text.trim(), 120);
      }
      this.result.transcript.push({
        uuid: rec.uuid,
        type: "user",
        timestamp: rec.timestamp,
        isSidechain,
        text: truncate(text.trim(), TEXT_PREVIEW_LIMIT),
      });
    } else if (toolResults.length > 0) {
      this.result.transcript.push({
        uuid: rec.uuid,
        type: "tool_result",
        timestamp: rec.timestamp,
        isSidechain,
        text: truncate(toolResults.join("\n").trim(), TEXT_PREVIEW_LIMIT),
      });
    }
  }

  private pushCompact(rec: any): void {
    const meta = rec.compactMetadata ?? {};
    const ev: CompactEvent = {
      uuid: rec.uuid,
      timestamp: rec.timestamp,
      preTokens: meta.preTokens ?? 0,
      postTokens: meta.postTokens ?? 0,
      trigger: meta.trigger ?? "unknown",
    };
    this.result.compactions.push(ev);
    this.result.transcript.push({
      uuid: rec.uuid,
      type: "compact",
      timestamp: rec.timestamp,
      isSidechain: false,
      text: `コンテキストをコンパクション (${ev.trigger}): ${ev.preTokens.toLocaleString()} → ${ev.postTokens.toLocaleString()} tokens`,
    });
  }

  private pushTurnDuration(rec: any): void {
    const last = this.result.transcript.at(-1);
    if (last && typeof rec.durationMs === "number") last.durationMs = rec.durationMs;
  }
}

/**
 * テキストチャンクを完全な行単位で parser に流し込むフィーダ。
 * 末尾の不完全な行は保持し、消費済みバイト数（完全な行のみ）を数える。
 */
export class LineFeeder {
  private remainder = "";

  /** consumedBytes からの再読込前に呼ぶ。読み残しの端数は再読込で全量届くため破棄する。 */
  resetRemainder(): void {
    this.remainder = "";
  }
  /** 完全な行として消費したバイト数（次回の読み出し開始オフセット） */
  consumedBytes = 0;

  constructor(private readonly parser: SessionParser) {}

  feed(chunk: string): void {
    this.remainder += chunk;
    let nl: number;
    while ((nl = this.remainder.indexOf("\n")) !== -1) {
      const line = this.remainder.slice(0, nl);
      this.remainder = this.remainder.slice(nl + 1);
      this.consumedBytes += Buffer.byteLength(line, "utf8") + 1;
      this.parser.pushLine(line);
    }
  }

}

export interface ParseState {
  parser: SessionParser;
  feeder: LineFeeder;
}

export function createParseState(sessionId: string): ParseState {
  const parser = new SessionParser(sessionId);
  return { parser, feeder: new LineFeeder(parser) };
}

/**
 * filePath を offset から末尾まで読み、state に流し込む。次回開始オフセットを返す。
 * offset には前回この state で返した値（= feeder.consumedBytes）を渡すこと。
 * ログは追記専用かつ各レコードが改行終端なので、改行未満の端数はファイル書き込み途中とみなし
 * 次回の読み出しに持ち越される（feeder.remainder に保持）。
 */
export async function feedFile(state: ParseState, filePath: string, offset: number): Promise<number> {
  state.feeder.resetRemainder();
  const stream = createReadStream(filePath, { start: offset, encoding: "utf8" });
  for await (const chunk of stream) {
    state.feeder.feed(chunk as string);
  }
  return state.feeder.consumedBytes;
}
