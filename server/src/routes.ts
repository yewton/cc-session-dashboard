import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { LogStore } from "./store.js";

export function createApi(store: LogStore): Hono {
  const api = new Hono();

  api.get("/projects", async (c) => {
    await store.scan();
    return c.json(store.getProjects());
  });

  api.get("/projects/:projectId/sessions", async (c) => {
    await store.scan();
    return c.json(store.getSessions(c.req.param("projectId")));
  });

  api.get("/sessions/:sessionId", async (c) => {
    await store.scan();
    const detail = store.getSession(c.req.param("sessionId"));
    if (!detail) return c.json({ error: "session not found" }, 404);
    return c.json(detail);
  });

  // セッション更新通知。クライアントは "update" イベントを受けたら詳細 API を再取得する。
  api.get("/sessions/:sessionId/live", async (c) => {
    const sessionId = c.req.param("sessionId");
    await store.scan();
    if (!store.findSessionEntry(sessionId)) return c.json({ error: "session not found" }, 404);

    return streamSSE(c, async (stream) => {
      let seq = 0;
      let closed = false;
      const unsubscribe = store.subscribe(sessionId, () => {
        if (closed) return;
        stream.writeSSE({ event: "update", data: String(Date.now()), id: String(seq++) }).catch(() => {});
      });
      stream.onAbort(() => {
        closed = true;
        unsubscribe();
      });
      // 接続維持の heartbeat。abort まで戻らないことで接続を保つ。
      while (!closed) {
        await stream.writeSSE({ event: "ping", data: "" }).catch(() => {});
        await new Promise((r) => setTimeout(r, 15_000));
      }
    });
  });

  return api;
}
