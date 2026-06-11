// API レスポンスとパース結果の共有型。
// web 側 (web/src/api.ts) にも同じ形の型があるため、変更時は両方を更新すること。

export interface UsageBreakdown {
  /** 非キャッシュ入力トークン */
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation5m: number;
  cacheCreation1h: number;
}

export interface ApiRequestInfo {
  /** 重複排除キー（requestId → message.id → uuid の順でフォールバック） */
  key: string;
  /** この API リクエストに対応する最初の assistant レコードの uuid */
  uuid: string;
  timestamp: string;
  model: string;
  isSidechain: boolean;
  usage: UsageBreakdown;
  /** リクエスト時点の実効コンテキストサイズ = input + cacheRead + cacheCreation */
  contextTokens: number;
  costUsd: number;
}

export interface CompactEvent {
  uuid: string;
  timestamp: string;
  preTokens: number;
  postTokens: number;
  trigger: string;
}

export type TranscriptItemType = "user" | "assistant" | "tool_result" | "compact";

export interface ToolUsePreview {
  name: string;
  detail: string;
}

export interface TranscriptItem {
  uuid: string;
  type: TranscriptItemType;
  timestamp: string;
  isSidechain: boolean;
  text: string;
  toolUses?: ToolUsePreview[];
  /** assistant アイテムのみ: 対応する ApiRequestInfo.key */
  requestKey?: string;
  /** turn_duration レコードから直前のアイテムに付与される */
  durationMs?: number;
}

export interface SessionTotals {
  usage: UsageBreakdown;
  costUsd: number;
  requestCount: number;
  maxContextTokens: number;
  /** 料金表に無くコスト 0 として扱ったモデル */
  unknownModels: string[];
}

export interface SessionSummary {
  sessionId: string;
  projectId: string;
  title: string;
  startTime: string | null;
  endTime: string | null;
  models: string[];
  totals: SessionTotals;
}

export interface SessionDetail extends SessionSummary {
  projectPath: string | null;
  requests: ApiRequestInfo[];
  compactions: CompactEvent[];
  transcript: TranscriptItem[];
}

export interface ProjectSummary {
  projectId: string;
  projectPath: string | null;
  sessionCount: number;
  lastActivity: string | null;
  totals: SessionTotals;
}

export interface DailyStat {
  /** ローカルタイムゾーンでの YYYY-MM-DD */
  date: string;
  model: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface ProjectsResponse {
  projects: ProjectSummary[];
  daily: DailyStat[];
}
