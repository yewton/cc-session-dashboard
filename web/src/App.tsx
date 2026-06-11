import { Link, Outlet } from "react-router-dom";

export function App() {
  return (
    <>
      <header className="app-header">
        <h1>
          <Link to="/">Claude Code セッションダッシュボード</Link>
        </h1>
        <span className="note">コストは API 料金換算の概算（サブスクリプション利用時の実費ではありません）</span>
      </header>
      <main className="container">
        <Outlet />
      </main>
    </>
  );
}
