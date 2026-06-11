import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchProjects, type ProjectSummary } from "../api";
import { DailyChart } from "../components/DailyChart";
import { formatCost, formatDateTime, formatTokens } from "../format";
import { useFetch } from "../hooks/useFetch";

type SortKey = "cost" | "sessions" | "lastActivity" | "output";

function projectName(p: ProjectSummary): string {
  return p.projectPath ?? p.projectId;
}

export function Dashboard() {
  const { data, error, loading } = useFetch(fetchProjects, []);
  const [sortKey, setSortKey] = useState<SortKey>("lastActivity");

  const projects = useMemo(() => {
    if (!data) return [];
    const list = [...data.projects];
    const cmp: Record<SortKey, (a: ProjectSummary, b: ProjectSummary) => number> = {
      cost: (a, b) => b.totals.costUsd - a.totals.costUsd,
      sessions: (a, b) => b.sessionCount - a.sessionCount,
      output: (a, b) => b.totals.usage.output - a.totals.usage.output,
      lastActivity: (a, b) => ((a.lastActivity ?? "") < (b.lastActivity ?? "") ? 1 : -1),
    };
    return list.sort(cmp[sortKey]);
  }, [data, sortKey]);

  if (loading) return <div className="loading">読み込み中…</div>;
  if (error) return <div className="error">{error}</div>;
  if (!data) return null;

  const total = data.projects.reduce(
    (acc, p) => {
      acc.cost += p.totals.costUsd;
      acc.sessions += p.sessionCount;
      acc.input += p.totals.usage.input;
      acc.output += p.totals.usage.output;
      acc.cacheRead += p.totals.usage.cacheRead;
      acc.cacheWrite += p.totals.usage.cacheCreation5m + p.totals.usage.cacheCreation1h;
      return acc;
    },
    { cost: 0, sessions: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  );

  return (
    <>
      <div className="stat-cards">
        <div className="stat-card">
          <div className="label">概算コスト合計</div>
          <div className="value">{formatCost(total.cost)}</div>
        </div>
        <div className="stat-card">
          <div className="label">セッション数</div>
          <div className="value">{total.sessions}</div>
        </div>
        <div className="stat-card">
          <div className="label">入力 / 出力トークン</div>
          <div className="value">
            {formatTokens(total.input)} / {formatTokens(total.output)}
          </div>
          <div className="sub">非キャッシュ入力 / 出力</div>
        </div>
        <div className="stat-card">
          <div className="label">キャッシュ読込 / 書込</div>
          <div className="value">
            {formatTokens(total.cacheRead)} / {formatTokens(total.cacheWrite)}
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>日次コスト（モデル別）</h2>
        <DailyChart daily={data.daily} />
      </div>

      <div className="panel">
        <h2>プロジェクト</h2>
        <table className="data">
          <thead>
            <tr>
              <th>プロジェクト</th>
              <th onClick={() => setSortKey("sessions")}>セッション{sortKey === "sessions" && " ▼"}</th>
              <th onClick={() => setSortKey("cost")}>概算コスト{sortKey === "cost" && " ▼"}</th>
              <th>入力</th>
              <th onClick={() => setSortKey("output")}>出力{sortKey === "output" && " ▼"}</th>
              <th>キャッシュ読込</th>
              <th>キャッシュ書込</th>
              <th onClick={() => setSortKey("lastActivity")}>最終更新{sortKey === "lastActivity" && " ▼"}</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.projectId}>
                <td className="title-cell">
                  <Link to={`/projects/${encodeURIComponent(p.projectId)}`}>{projectName(p)}</Link>
                </td>
                <td>{p.sessionCount}</td>
                <td>{formatCost(p.totals.costUsd)}</td>
                <td>{formatTokens(p.totals.usage.input)}</td>
                <td>{formatTokens(p.totals.usage.output)}</td>
                <td>{formatTokens(p.totals.usage.cacheRead)}</td>
                <td>{formatTokens(p.totals.usage.cacheCreation5m + p.totals.usage.cacheCreation1h)}</td>
                <td>{formatDateTime(p.lastActivity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
