import { useEffect, useState } from "react";
import { fetchSession, type SessionDetail } from "../api";

export interface LiveSessionState {
  detail: SessionDetail | null;
  error: string | null;
  loading: boolean;
  /** SSE 接続中（= ライブ更新が有効） */
  connected: boolean;
}

/**
 * セッション詳細を取得しつつ SSE を購読する。
 * サーバから "update" イベントが届いたら詳細を再取得する（サーバ側は増分パース済みなので軽い）。
 */
export function useLiveSession(sessionId: string): LiveSessionState {
  const [state, setState] = useState<LiveSessionState>({
    detail: null,
    error: null,
    loading: true,
    connected: false,
  });
  useEffect(() => {
    let cancelled = false;
    // 多重リフェッチ防止フラグ。StrictMode の二重マウントで固着しないよう
    // useRef ではなくエフェクトローカルに持つ。
    let inflight = false;

    const load = async (initial: boolean) => {
      if (inflight) return;
      inflight = true;
      try {
        const detail = await fetchSession(sessionId);
        if (!cancelled) setState((s) => ({ ...s, detail, error: null, loading: false }));
      } catch (err) {
        if (!cancelled && initial) {
          setState((s) => ({ ...s, error: String(err), loading: false }));
        }
      } finally {
        inflight = false;
      }
    };

    setState({ detail: null, error: null, loading: true, connected: false });
    load(true);

    const es = new EventSource(`/api/sessions/${encodeURIComponent(sessionId)}/live`);
    es.onopen = () => {
      if (!cancelled) setState((s) => ({ ...s, connected: true }));
    };
    es.onerror = () => {
      if (!cancelled) setState((s) => ({ ...s, connected: false }));
      // EventSource は自動再接続する
    };
    es.addEventListener("update", () => {
      if (!cancelled) load(false);
    });

    return () => {
      cancelled = true;
      es.close();
    };
  }, [sessionId]);

  return state;
}
