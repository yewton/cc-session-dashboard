import { useMemo, useRef } from "react";
import type { EChartsOption } from "echarts";
import type { ApiRequestInfo, CompactEvent } from "../api";
import { CHART_COLORS, escapeHtml, requestTooltipRows } from "./chartShared";
import { formatTokens } from "../format";
import { useECharts } from "../hooks/useECharts";

interface Props {
  requests: ApiRequestInfo[];
  compactions: CompactEvent[];
  includeSidechain: boolean;
  /** トランスクリプトで現在表示中のリクエスト key 群（スクロール連動ハイライト） */
  visibleKeys: Set<string>;
  /** リクエスト key → そのターンを開始したユーザープロンプトのプレビュー */
  promptByKey: Map<string, string>;
  onSelectRequest?: (key: string) => void;
}

/**
 * トランスクリプトの横に並べる 90 度回転したチャート。上部チャートの二段構成を
 * 横に倒したレイアウト（左 = コンテキスト内訳、右 = 出力）で、系列・色も共通。
 * Y 軸 = リクエスト順（上から下 = 時間順、トランスクリプトと同じ向き）。
 * 表示中のターンを帯でハイライトする。
 */
export function TurnChart({
  requests,
  compactions,
  includeSidechain,
  visibleKeys,
  promptByKey,
  onSelectRequest,
}: Props) {
  const filtered = useMemo(
    () => (includeSidechain ? requests : requests.filter((r) => !r.isSidechain)),
    [requests, includeSidechain],
  );

  const filteredRef = useRef(filtered);
  filteredRef.current = filtered;
  const onSelectRef = useRef(onSelectRequest);
  onSelectRef.current = onSelectRequest;

  // 可視範囲を [開始, 終了] のインデックスに変換。範囲が変わった時だけ option を作り直す。
  const visibleRange = useMemo<[number, number] | null>(() => {
    let min = Infinity;
    let max = -Infinity;
    filtered.forEach((r, i) => {
      if (visibleKeys.has(r.key)) {
        if (i < min) min = i;
        if (i > max) max = i;
      }
    });
    return min <= max ? [min, max] : null;
  }, [filtered, visibleKeys]);
  const rangeKey = visibleRange ? `${visibleRange[0]}-${visibleRange[1]}` : "";

  const option = useMemo<EChartsOption | null>(() => {
    if (filtered.length === 0) return null;

    const compactIndices: { index: number; ev: CompactEvent }[] = [];
    for (const ev of compactions) {
      const idx = filtered.findIndex((r) => r.timestamp >= ev.timestamp);
      if (idx >= 0) compactIndices.push({ index: idx, ev });
    }

    const labels = filtered.map((_, i) => String(i + 1));
    const yLabelInterval = Math.max(0, Math.ceil(filtered.length / 30) - 1);
    const markArea = visibleRange
      ? {
          silent: true as const,
          itemStyle: { color: "rgba(37, 99, 235, 0.10)" },
          data: [
            [{ yAxis: String(visibleRange[0] + 1) }, { yAxis: String(visibleRange[1] + 1) }],
          ] as [{ yAxis: string }, { yAxis: string }][],
        }
      : undefined;
    const compactMarkLine =
      compactIndices.length > 0
        ? {
            symbol: "none" as const,
            label: { show: false },
            lineStyle: { color: CHART_COLORS.compact, type: "dashed" as const, width: 1.5 },
            data: compactIndices.map((c) => ({ yAxis: String(c.index + 1) })),
          }
        : undefined;

    return {
      animation: false,
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        confine: true,
        formatter: (params: unknown) => {
          const list = params as { dataIndex: number }[];
          const first = list[0];
          const r = first ? filtered[first.dataIndex] : undefined;
          if (!r) return "";
          const rows = requestTooltipRows(r, (first?.dataIndex ?? 0) + 1);
          const prompt = promptByKey.get(r.key);
          if (prompt) {
            rows.push(
              `<div style="max-width:280px;white-space:normal;border-top:1px solid #e5e7eb;margin-top:4px;padding-top:4px;color:#6b7280">` +
                `プロンプト: ${escapeHtml(prompt)}</div>`,
            );
          }
          return rows.join("<br/>");
        },
      },
      axisPointer: { link: [{ yAxisIndex: "all" }] },
      legend: { top: 0, itemWidth: 9, itemGap: 4, itemHeight: 9, textStyle: { fontSize: 9 } },
      grid: [
        { left: 34, right: "33%", top: 52, bottom: 8 },
        { left: "73%", right: 8, top: 52, bottom: 8 },
      ],
      xAxis: [
        {
          type: "value",
          gridIndex: 0,
          position: "top",
          splitNumber: 3,
          axisLabel: { formatter: (v: number) => formatTokens(v), fontSize: 8, hideOverlap: true },
          splitLine: { lineStyle: { color: "#eef0f3" } },
        },
        {
          type: "value",
          gridIndex: 1,
          position: "top",
          splitNumber: 2,
          axisLabel: { formatter: (v: number) => formatTokens(v), fontSize: 8, hideOverlap: true },
          splitLine: { lineStyle: { color: "#eef0f3" } },
        },
      ],
      yAxis: [
        {
          type: "category",
          gridIndex: 0,
          data: labels,
          inverse: true, // #1 を上に: トランスクリプトと同じ向きに時間が流れる
          axisLabel: { fontSize: 9, interval: yLabelInterval },
          axisTick: { show: false },
        },
        {
          type: "category",
          gridIndex: 1,
          data: labels,
          inverse: true,
          axisLabel: { show: false },
          axisTick: { show: false },
        },
      ],
      series: [
        {
          name: "キャッシュ読込",
          type: "bar",
          stack: "ctx",
          xAxisIndex: 0,
          yAxisIndex: 0,
          color: CHART_COLORS.cacheRead,
          barCategoryGap: "20%",
          data: filtered.map((r) => r.usage.cacheRead),
          markArea,
          markLine: compactMarkLine,
        },
        {
          name: "キャッシュ書込",
          type: "bar",
          stack: "ctx",
          xAxisIndex: 0,
          yAxisIndex: 0,
          color: CHART_COLORS.cacheWrite,
          data: filtered.map((r) => r.usage.cacheCreation5m + r.usage.cacheCreation1h),
        },
        {
          name: "非キャッシュ入力",
          type: "bar",
          stack: "ctx",
          xAxisIndex: 0,
          yAxisIndex: 0,
          color: CHART_COLORS.input,
          data: filtered.map((r) => r.usage.input),
        },
        {
          name: "出力",
          type: "bar",
          xAxisIndex: 1,
          yAxisIndex: 1,
          color: CHART_COLORS.output,
          data: filtered.map((r) => r.usage.output),
          markArea,
          markLine: compactMarkLine,
        },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, compactions, promptByKey, rangeKey]);

  const containerRef = useECharts(option, (chart) => {
    chart.getZr().on("click", (event) => {
      const point: [number, number] = [event.offsetX, event.offsetY];
      for (const seriesIndex of [0, 3]) {
        if (!chart.containPixel({ seriesIndex }, point)) continue;
        const converted = chart.convertFromPixel({ seriesIndex }, point) as [number, number];
        const r = filteredRef.current[Math.round(converted[1])];
        if (r) onSelectRef.current?.(r.key);
        return;
      }
    });
  });

  if (filtered.length === 0) return null;
  return <div ref={containerRef} className="chart" style={{ height: "100%" }} />;
}
