import { watch, type FSWatcher } from "node:fs";
import { sep } from "node:path";
import type { LogStore } from "./store.js";

const DEBOUNCE_MS = 300;

/**
 * ~/.claude/projects を再帰監視し、変更のあった jsonl をデバウンス付きで増分パースさせる。
 * 変更通知は LogStore の subscribe 機構経由で SSE に伝わる。
 */
export function startWatcher(store: LogStore): FSWatcher | null {
  const timers = new Map<string, NodeJS.Timeout>();

  let watcher: FSWatcher;
  try {
    watcher = watch(store.projectsDir, { recursive: true }, (_event, filename) => {
      if (!filename || !filename.endsWith(".jsonl")) return;
      const key = filename;
      clearTimeout(timers.get(key));
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key);
          const target = resolveSession(filename);
          if (target) {
            store.refreshSession(target.projectId, target.sessionId).catch(() => {});
          }
        }, DEBOUNCE_MS),
      );
    });
  } catch (err) {
    console.warn("ファイル監視を開始できませんでした（ライブ更新は無効）:", err);
    return null;
  }
  return watcher;
}

/**
 * projects ディレクトリからの相対パスをセッションに解決する。
 *  - <projectId>/<sessionId>.jsonl
 *  - <projectId>/<sessionId>/subagents/agent-*.jsonl
 */
function resolveSession(relPath: string): { projectId: string; sessionId: string } | null {
  const parts = relPath.split(sep);
  if (parts.length === 2 && parts[1]!.endsWith(".jsonl")) {
    return { projectId: parts[0]!, sessionId: parts[1]!.slice(0, -".jsonl".length) };
  }
  if (parts.length === 4 && parts[2] === "subagents") {
    return { projectId: parts[0]!, sessionId: parts[1]! };
  }
  return null;
}
