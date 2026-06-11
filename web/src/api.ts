// server/src/types.ts と同じ形の型。変更時は両方を更新すること。

export interface UsageBreakdown {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation5m: number;
  cacheCreation1h: number;
}

export interface ApiRequestInfo {
  key: string;
  uuid: string;
  timestamp: string;
  model: string;
  isSidechain: boolean;
  usage: UsageBreakdown;
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
  requestKey?: string;
  durationMs?: number;
}

export interface SessionTotals {
  usage: UsageBreakdown;
  costUsd: number;
  requestCount: number;
  maxContextTokens: number;
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

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return (await res.json()) as T;
}

export const fetchProjects = () => getJson<ProjectsResponse>("/api/projects");
export const fetchSessions = (projectId: string) =>
  getJson<SessionSummary[]>(`/api/projects/${encodeURIComponent(projectId)}/sessions`);
export const fetchSession = (sessionId: string) =>
  getJson<SessionDetail>(`/api/sessions/${encodeURIComponent(sessionId)}`);
