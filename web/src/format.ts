export function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function formatCost(usd: number): string {
  if (usd >= 100) return `$${usd.toFixed(0)}`;
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(4)}`;
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function formatDuration(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}分`;
  return `${(ms / 1000).toFixed(1)}秒`;
}

/** モデル ID から表示用の短い名前を作る (claude-opus-4-7 → opus-4-7) */
export function shortModel(model: string): string {
  return model.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}

const MODEL_COLORS: [string, string][] = [
  ["fable", "#8b5cf6"],
  ["mythos", "#7c3aed"],
  ["opus", "#d97706"],
  ["sonnet", "#2563eb"],
  ["haiku", "#059669"],
];

export function modelColor(model: string): string {
  const m = shortModel(model);
  for (const [prefix, color] of MODEL_COLORS) {
    if (m.startsWith(prefix)) return color;
  }
  return "#6b7280";
}
