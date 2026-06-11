import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import {
  buildDailyStats,
  buildProjectSummary,
  buildSessionDetail,
  buildSessionSummary,
} from "./aggregate.js";
import { CostCalculator, loadPricing } from "./cost.js";
import { createParseState, feedFile, type ParsedSession, type ParseState } from "./parser.js";
import type { ProjectsResponse, SessionDetail, SessionSummary } from "./types.js";

interface FileEntry {
  filePath: string;
  state: ParseState;
  offset: number;
  mtimeMs: number;
  size: number;
}

interface SessionEntry {
  sessionId: string;
  projectId: string;
  /** メインの transcript ファイル */
  main: FileEntry;
  /** <sessionId>/subagents/agent-*.jsonl （新形式のサブエージェントログ） */
  subagents: Map<string, FileEntry>;
}

export class LogStore {
  private readonly calc = new CostCalculator(loadPricing());
  private sessions = new Map<string, SessionEntry>(); // key: `${projectId}/${sessionId}`
  private bySessionId = new Map<string, SessionEntry>();
  private listeners = new Map<string, Set<() => void>>(); // key: sessionId

  constructor(readonly projectsDir: string = join(homedir(), ".claude", "projects")) {}

  /**
   * projects ディレクトリ全体を走査し、変更のあったファイルだけ（増分）パースする。
   * 変更が無ければ stat のみで終わるため、リクエスト毎に呼んでも軽い。
   */
  async scan(): Promise<void> {
    let projectDirs: string[];
    try {
      projectDirs = (await readdir(this.projectsDir, { withFileTypes: true }))
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      return; // ~/.claude/projects が無い環境
    }

    const seen = new Set<string>();
    const jobs: Promise<unknown>[] = [];
    for (const projectId of projectDirs) {
      const dir = join(this.projectsDir, projectId);
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (e.isFile() && e.name.endsWith(".jsonl")) {
          const sessionId = basename(e.name, ".jsonl");
          seen.add(`${projectId}/${sessionId}`);
          jobs.push(this.refreshSession(projectId, sessionId));
        }
      }
    }
    // 並列数を絞って I/O を平滑化
    const POOL = 8;
    for (let i = 0; i < jobs.length; i += POOL) {
      await Promise.all(jobs.slice(i, i + POOL));
    }
    // 消えたセッションを破棄
    for (const key of [...this.sessions.keys()]) {
      if (!seen.has(key)) {
        const entry = this.sessions.get(key)!;
        this.sessions.delete(key);
        if (this.bySessionId.get(entry.sessionId) === entry) {
          this.bySessionId.delete(entry.sessionId);
        }
      }
    }
  }

  /** 1 セッション分（メイン + subagents）を必要に応じて再/増分パースする。変更有無を返す。 */
  async refreshSession(projectId: string, sessionId: string): Promise<boolean> {
    const key = `${projectId}/${sessionId}`;
    const mainPath = join(this.projectsDir, projectId, `${sessionId}.jsonl`);
    let entry = this.sessions.get(key);
    if (!entry) {
      entry = {
        sessionId,
        projectId,
        main: this.newFileEntry(mainPath, sessionId),
        subagents: new Map(),
      };
      this.sessions.set(key, entry);
      this.bySessionId.set(sessionId, entry);
    }

    let changed = await this.refreshFile(entry.main, sessionId);

    // subagents ディレクトリ（存在すれば）
    const subDir = join(this.projectsDir, projectId, sessionId, "subagents");
    let subFiles: string[] = [];
    try {
      subFiles = (await readdir(subDir)).filter((n) => n.endsWith(".jsonl"));
    } catch {
      // ディレクトリ無し = サブエージェントログ無し
    }
    for (const name of subFiles) {
      const p = join(subDir, name);
      let fe = entry.subagents.get(p);
      if (!fe) {
        fe = this.newFileEntry(p, sessionId);
        entry.subagents.set(p, fe);
      }
      if (await this.refreshFile(fe, sessionId)) changed = true;
    }

    if (changed) this.notify(sessionId);
    return changed;
  }

  private newFileEntry(filePath: string, sessionId: string): FileEntry {
    return { filePath, state: createParseState(sessionId), offset: 0, mtimeMs: -1, size: -1 };
  }

  private async refreshFile(fe: FileEntry, sessionId: string): Promise<boolean> {
    let st;
    try {
      st = await stat(fe.filePath);
    } catch {
      return false; // 消えたファイルは現状維持（scan 側で破棄される）
    }
    if (st.mtimeMs === fe.mtimeMs && st.size === fe.size) return false;
    if (st.size < fe.offset) {
      // 縮んだ = 書き換えられた。最初からパースし直す。
      fe.state = createParseState(sessionId);
      fe.offset = 0;
    }
    fe.offset = await feedFile(fe.state, fe.filePath, fe.offset);
    fe.mtimeMs = st.mtimeMs;
    fe.size = st.size;
    return true;
  }

  /** メイン + subagents のパース結果を 1 つの ParsedSession にマージする */
  private mergedParsed(entry: SessionEntry): ParsedSession {
    const main = entry.main.state.parser.result;
    if (entry.subagents.size === 0) return main;
    const subs = [...entry.subagents.values()].map((f) => f.state.parser.result);
    const merged: ParsedSession = {
      ...main,
      requests: [...main.requests],
      transcript: [...main.transcript],
      models: [...new Set([...main.models, ...subs.flatMap((s) => s.models)])],
    };
    for (const s of subs) {
      merged.requests.push(...s.requests);
      merged.transcript.push(...s.transcript);
      if (s.startTime && (!merged.startTime || s.startTime < merged.startTime)) merged.startTime = s.startTime;
      if (s.endTime && (!merged.endTime || s.endTime > merged.endTime)) merged.endTime = s.endTime;
    }
    const byTime = (a: { timestamp: string }, b: { timestamp: string }) =>
      a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0;
    merged.requests.sort(byTime);
    merged.transcript.sort(byTime);
    return merged;
  }

  getProjects(): ProjectsResponse {
    const byProject = new Map<string, { parsed: ParsedSession; summary: SessionSummary }[]>();
    const allParsed: ParsedSession[] = [];
    for (const entry of this.sessions.values()) {
      const parsed = this.mergedParsed(entry);
      allParsed.push(parsed);
      const summary = buildSessionSummary(parsed, entry.projectId, this.calc);
      let list = byProject.get(entry.projectId);
      if (!list) {
        list = [];
        byProject.set(entry.projectId, list);
      }
      list.push({ parsed, summary });
    }
    const projects = [...byProject.entries()]
      .map(([projectId, sessions]) => buildProjectSummary(projectId, sessions))
      .sort((a, b) => ((a.lastActivity ?? "") < (b.lastActivity ?? "") ? 1 : -1));
    return { projects, daily: buildDailyStats(allParsed, this.calc) };
  }

  getSessions(projectId: string): SessionSummary[] {
    const result: SessionSummary[] = [];
    for (const entry of this.sessions.values()) {
      if (entry.projectId !== projectId) continue;
      result.push(buildSessionSummary(this.mergedParsed(entry), entry.projectId, this.calc));
    }
    return result.sort((a, b) => ((a.startTime ?? "") < (b.startTime ?? "") ? 1 : -1));
  }

  getSession(sessionId: string): SessionDetail | null {
    const entry = this.bySessionId.get(sessionId);
    if (!entry) return null;
    return buildSessionDetail(this.mergedParsed(entry), entry.projectId, this.calc);
  }

  findSessionEntry(sessionId: string): { projectId: string } | null {
    const entry = this.bySessionId.get(sessionId);
    return entry ? { projectId: entry.projectId } : null;
  }

  subscribe(sessionId: string, listener: () => void): () => void {
    let set = this.listeners.get(sessionId);
    if (!set) {
      set = new Set();
      this.listeners.set(sessionId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(sessionId);
    };
  }

  private notify(sessionId: string): void {
    for (const l of this.listeners.get(sessionId) ?? []) l();
  }
}
