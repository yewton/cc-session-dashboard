import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import type { DailyStat } from "../api";
import { formatCost, modelColor, shortModel } from "../format";
import { useECharts } from "../hooks/useECharts";

/** 日次コストのモデル別積み上げバーチャート */
export function DailyChart({ daily }: { daily: DailyStat[] }) {
  const option = useMemo<EChartsOption | null>(() => {
    if (daily.length === 0) return null;
    const dates = [...new Set(daily.map((d) => d.date))].sort();
    const models = [...new Set(daily.map((d) => d.model))].sort();
    const byKey = new Map(daily.map((d) => [`${d.date} ${d.model}`, d]));
    return {
      tooltip: {
        trigger: "axis",
        valueFormatter: (v) => formatCost(Number(v ?? 0)),
      },
      legend: { type: "scroll", top: 0, textStyle: { fontSize: 11 } },
      grid: { left: 60, right: 20, top: 36, bottom: 50 },
      xAxis: { type: "category", data: dates, axisLabel: { fontSize: 11 } },
      yAxis: { type: "value", axisLabel: { formatter: (v: number) => `$${v}`, fontSize: 11 } },
      dataZoom: [{ type: "slider", height: 16, bottom: 8 }],
      series: models.map((model) => ({
        name: shortModel(model),
        type: "bar" as const,
        stack: "cost",
        itemStyle: { color: modelColor(model) },
        data: dates.map((date) => {
          const stat = byKey.get(`${date} ${model}`);
          return stat ? Number(stat.costUsd.toFixed(4)) : 0;
        }),
      })),
    };
  }, [daily]);

  const ref = useECharts(option);
  if (!option) return null;
  return <div ref={ref} className="chart" style={{ height: 260 }} />;
}
