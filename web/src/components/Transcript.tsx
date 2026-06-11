import { memo, useEffect, useMemo, useRef } from "react";
import type { ApiRequestInfo, TranscriptItem } from "../api";
import { formatCost, formatDuration, formatTime, formatTokens, shortModel } from "../format";

interface Props {
  items: TranscriptItem[];
  requests: ApiRequestInfo[];
  includeSidechain: boolean;
  /** チャートで選択されたリクエストの key。該当アイテムへスクロールしてハイライトする */
  highlightedRequestKey: string | null;
  onSelectRequest?: (key: string) => void;
  /** ビューポートに表示中のリクエスト key 群の変化を通知する（スクロール連動チャート用） */
  onVisibleChange?: (keys: Set<string>) => void;
}

const ROLE_LABEL: Record<TranscriptItem["type"], string> = {
  user: "User",
  assistant: "Assistant",
  tool_result: "Tool Result",
  compact: "Compaction",
};

export const Transcript = memo(function Transcript({
  items,
  requests,
  includeSidechain,
  highlightedRequestKey,
  onSelectRequest,
  onVisibleChange,
}: Props) {
  const requestByKey = useMemo(() => new Map(requests.map((r) => [r.key, r])), [requests]);
  const filtered = useMemo(
    () => (includeSidechain ? items : items.filter((i) => !i.isSidechain)),
    [items, includeSidechain],
  );
  const containerRef = useRef<HTMLDivElement | null>(null);

  // ビューポート内に見えているリクエストを IntersectionObserver で追跡する
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !onVisibleChange) return;
    const visible = new Set<string>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const key = (e.target as HTMLElement).dataset.requestKey;
        if (!key) continue;
        if (e.isIntersecting) visible.add(key);
        else visible.delete(key);
      }
      onVisibleChange(new Set(visible));
    });
    container.querySelectorAll("[data-request-key]").forEach((el) => io.observe(el));
    return () => {
      io.disconnect();
      onVisibleChange(new Set());
    };
  }, [filtered, onVisibleChange]);

  useEffect(() => {
    if (!highlightedRequestKey || !containerRef.current) return;
    const el = containerRef.current.querySelector(`[data-request-key="${CSS.escape(highlightedRequestKey)}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightedRequestKey]);

  return (
    <div className="transcript" ref={containerRef}>
      {filtered.map((item) => {
        const req = item.requestKey ? requestByKey.get(item.requestKey) : undefined;
        const highlighted = item.requestKey != null && item.requestKey === highlightedRequestKey;
        const classes = [
          "transcript-item",
          item.type,
          item.isSidechain ? "sidechain" : "",
          highlighted ? "highlighted" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <div key={item.uuid} className={classes} data-request-key={item.requestKey ?? undefined}>
            <div className="meta">
              <span className="role">{ROLE_LABEL[item.type]}</span>
              {item.isSidechain && <span>(subagent)</span>}
              <span>{formatTime(item.timestamp)}</span>
              {req && (
                <button
                  type="button"
                  className="usage-badge"
                  style={{ border: "none", cursor: "pointer" }}
                  title="チャート上で位置を表示"
                  onClick={() => onSelectRequest?.(req.key)}
                >
                  {shortModel(req.model)} | ctx {formatTokens(req.contextTokens)} | out{" "}
                  {formatTokens(req.usage.output)} | {formatCost(req.costUsd)}
                </button>
              )}
              {item.durationMs != null && <span>ターン所要 {formatDuration(item.durationMs)}</span>}
            </div>
            {item.text && <div className="text">{item.text}</div>}
            {item.toolUses && item.toolUses.length > 0 && (
              <div className="tools">
                {item.toolUses.map((t, i) => (
                  <div key={i} className="tool-use">
                    <b>{t.name}</b> {t.detail}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});
