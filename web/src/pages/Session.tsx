import { useCallback, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ContextChart } from "../components/ContextChart";
import { Transcript } from "../components/Transcript";
import { TurnChart } from "../components/TurnChart";
import { formatCost, formatDateTime, formatTokens, modelColor, shortModel } from "../format";
import { useLiveSession } from "../hooks/useLiveSession";

export function Session() {
  const { projectId = "", sessionId = "" } = useParams();
  const { detail, error, loading, connected } = useLiveSession(sessionId);
  const [includeSidechain, setIncludeSidechain] = useState(false);
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());
  const handleVisibleChange = useCallback((keys: Set<string>) => setVisibleKeys(keys), []);

  const hasSidechain = useMemo(
    () => detail?.requests.some((r) => r.isSidechain) ?? false,
    [detail],
  );

  // リクエスト key → そのターンを開始したユーザープロンプト（直前の user 発言）のプレビュー
  const promptByKey = useMemo(() => {
    const map = new Map<string, string>();
    if (!detail) return map;
    let lastUserText = "";
    for (const item of detail.transcript) {
      if (item.type === "user" && !item.isSidechain) lastUserText = item.text;
      else if (item.requestKey && !map.has(item.requestKey) && lastUserText) {
        map.set(item.requestKey, lastUserText.slice(0, 160));
      }
    }
    return map;
  }, [detail]);

  if (loading) return <div className="loading">読み込み中…</div>;
  if (error) return <div className="error">{error}</div>;
  if (!detail) return null;

  const u = detail.totals.usage;

  return (
    <div className="session-layout">
      <div className="breadcrumbs">
        <Link to="/">ダッシュボード</Link> /{" "}
        <Link to={`/projects/${encodeURIComponent(projectId)}`}>{detail.projectPath ?? projectId}</Link> /{" "}
        {detail.title}
      </div>

      <div className="stat-cards">
        <div className="stat-card">
          <div className="label">概算コスト</div>
          <div className="value">{formatCost(detail.totals.costUsd)}</div>
        </div>
        <div className="stat-card">
          <div className="label">API リクエスト</div>
          <div className="value">{detail.totals.requestCount}</div>
        </div>
        <div className="stat-card">
          <div className="label">最大コンテキスト</div>
          <div className="value">{formatTokens(detail.totals.maxContextTokens)}</div>
        </div>
        <div className="stat-card">
          <div className="label">入力 / 出力</div>
          <div className="value">
            {formatTokens(u.input)} / {formatTokens(u.output)}
          </div>
          <div className="sub">非キャッシュ入力 / 出力</div>
        </div>
        <div className="stat-card">
          <div className="label">キャッシュ読込 / 書込</div>
          <div className="value">
            {formatTokens(u.cacheRead)} / {formatTokens(u.cacheCreation5m + u.cacheCreation1h)}
          </div>
          <div className="sub">
            書込内訳 5m: {formatTokens(u.cacheCreation5m)} / 1h: {formatTokens(u.cacheCreation1h)}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">期間</div>
          <div className="value" style={{ fontSize: 13 }}>
            {formatDateTime(detail.startTime)}
            <br />〜 {formatDateTime(detail.endTime)}
          </div>
        </div>
      </div>

      {detail.totals.unknownModels.length > 0 && (
        <div className="error">
          料金表に無いモデルをコスト 0 として扱っています: {detail.totals.unknownModels.join(", ")}（pricing.json
          に追記してください）
        </div>
      )}

      <div className="panel">
        <h2>コンテキストウインドウの推移</h2>
        <div className="toolbar">
          {detail.models.map((m) => (
            <span key={m} className="badge" style={{ background: modelColor(m) }}>
              {shortModel(m)}
            </span>
          ))}
          {hasSidechain && (
            <label>
              <input
                type="checkbox"
                checked={includeSidechain}
                onChange={(e) => setIncludeSidechain(e.target.checked)}
              />
              サブエージェントを含める
            </label>
          )}
          <span className={`live-indicator${connected ? " connected" : ""}`}>
            <span className="dot" />
            {connected ? "ライブ更新中" : "未接続"}
          </span>
        </div>
        <ContextChart
          requests={detail.requests}
          compactions={detail.compactions}
          includeSidechain={includeSidechain}
          onSelectRequest={setHighlightedKey}
        />
      </div>

      <div className="session-bottom">
        <div className="panel transcript-panel">
          <h2>トランスクリプト ({detail.transcript.length})</h2>
          <Transcript
            items={detail.transcript}
            requests={detail.requests}
            includeSidechain={includeSidechain}
            highlightedRequestKey={highlightedKey}
            onSelectRequest={setHighlightedKey}
            onVisibleChange={handleVisibleChange}
          />
        </div>
        <div className="panel turnchart-panel">
          <h2>ターン毎の状況（スクロール連動）</h2>
          <div className="turnchart-body">
            <TurnChart
              requests={detail.requests}
              compactions={detail.compactions}
              includeSidechain={includeSidechain}
              visibleKeys={visibleKeys}
              promptByKey={promptByKey}
              onSelectRequest={setHighlightedKey}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
