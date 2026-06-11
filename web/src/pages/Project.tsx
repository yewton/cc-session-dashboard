import { Link, useParams } from "react-router-dom";
import { fetchSessions } from "../api";
import { formatCost, formatDateTime, formatTokens, modelColor, shortModel } from "../format";
import { useFetch } from "../hooks/useFetch";

export function Project() {
  const { projectId = "" } = useParams();
  const { data, error, loading } = useFetch(() => fetchSessions(projectId), [projectId]);

  if (loading) return <div className="loading">読み込み中…</div>;
  if (error) return <div className="error">{error}</div>;
  if (!data) return null;

  return (
    <>
      <div className="breadcrumbs">
        <Link to="/">ダッシュボード</Link> / {projectId}
      </div>
      <div className="panel">
        <h2>セッション ({data.length})</h2>
        <table className="data">
          <thead>
            <tr>
              <th>タイトル</th>
              <th>モデル</th>
              <th>開始</th>
              <th>リクエスト数</th>
              <th>最大コンテキスト</th>
              <th>出力</th>
              <th>概算コスト</th>
            </tr>
          </thead>
          <tbody>
            {data.map((s) => (
              <tr key={s.sessionId}>
                <td className="title-cell">
                  <Link to={`/projects/${encodeURIComponent(projectId)}/sessions/${s.sessionId}`}>
                    {s.title}
                  </Link>
                </td>
                <td>
                  {s.models.map((m) => (
                    <span key={m} className="badge" style={{ background: modelColor(m) }}>
                      {shortModel(m)}
                    </span>
                  ))}
                </td>
                <td>{formatDateTime(s.startTime)}</td>
                <td>{s.totals.requestCount}</td>
                <td>{formatTokens(s.totals.maxContextTokens)}</td>
                <td>{formatTokens(s.totals.usage.output)}</td>
                <td>{formatCost(s.totals.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
