import { readFileSync } from "node:fs";
import type { UsageBreakdown } from "./types.js";

export interface ModelPricing {
  match: string;
  input: number;
  output: number;
}

export interface PricingTable {
  models: ModelPricing[];
  cacheWrite5mMultiplier: number;
  cacheWrite1hMultiplier: number;
  cacheReadMultiplier: number;
}

export function loadPricing(): PricingTable {
  const url = new URL("../../pricing.json", import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as PricingTable;
}

export class CostCalculator {
  constructor(private readonly pricing: PricingTable) {}

  /** モデル ID を前方一致で解決する（日付サフィックス付き ID 対応） */
  findModel(model: string): ModelPricing | null {
    return this.pricing.models.find((m) => model.startsWith(m.match)) ?? null;
  }

  /** @returns コスト (USD)。モデル未知の場合は null */
  requestCost(model: string, usage: UsageBreakdown): number | null {
    const p = this.findModel(model);
    if (!p) return null;
    const t = this.pricing;
    return (
      (usage.input * p.input +
        usage.output * p.output +
        usage.cacheCreation5m * p.input * t.cacheWrite5mMultiplier +
        usage.cacheCreation1h * p.input * t.cacheWrite1hMultiplier +
        usage.cacheRead * p.input * t.cacheReadMultiplier) /
      1_000_000
    );
  }
}
