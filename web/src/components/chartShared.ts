import type { ApiRequestInfo } from "../api";
import { formatCost, formatTime, formatTokens, shortModel } from "../format";

/** 上部チャートとサイドチャートで共通の系列色 */
export const CHART_COLORS = {
  cacheRead: "#60a5fa",
  cacheWrite: "#fbbf24",
  input: "#f87171",
  output: "#34d399",
  compact: "#ea580c",
} as const;

/** リクエスト 1 件分のツールチップ行（両チャート共通） */
export function requestTooltipRows(r: ApiRequestInfo, seq: number): string[] {
  const u = r.usage;
  return [
    `<b>#${seq}</b> ${formatTime(r.timestamp)} — ${shortModel(r.model)}${r.isSidechain ? " (subagent)" : ""}`,
    `コンテキスト合計: <b>${formatTokens(r.contextTokens)}</b>`,
    `├ キャッシュ読込: ${formatTokens(u.cacheRead)}`,
    `├ キャッシュ書込: ${formatTokens(u.cacheCreation5m + u.cacheCreation1h)}`,
    `└ 非キャッシュ入力: ${formatTokens(u.input)}`,
    `出力: ${formatTokens(u.output)}`,
    `概算コスト: ${formatCost(r.costUsd)}`,
  ];
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
