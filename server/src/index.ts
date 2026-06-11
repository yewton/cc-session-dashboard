import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { createApi } from "./routes.js";
import { LogStore } from "./store.js";
import { startWatcher } from "./watcher.js";

const store = new LogStore(process.env.CLAUDE_PROJECTS_DIR || undefined);
const app = new Hono();

app.route("/api", createApi(store));

// 本番モード: web のビルド成果物を配信（開発時は vite dev server が 5173 で担当）
const webDist = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web", "dist");
if (existsSync(webDist)) {
  const root = relative(process.cwd(), webDist);
  app.use("*", serveStatic({ root }));
  app.get("*", serveStatic({ root, path: "index.html" }));
}

const port = Number(process.env.PORT ?? 3000);

console.log(`ログディレクトリ: ${store.projectsDir}`);
console.time("初回スキャン");
await store.scan();
console.timeEnd("初回スキャン");

startWatcher(store);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`http://localhost:${info.port} で待ち受け中`);
});
