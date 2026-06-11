import { useMemo, useRef } from "react";
import type { EChartsOption } from "echarts";
import type { ApiRequestInfo, CompactEvent } from "../api";
import { CHART_COLORS, requestTooltipRows } from "./chartShared";
import { formatTokens } from "../format";
import { useECharts } from "../hooks/useECharts";

interface Props {
  requests: ApiRequestInfo[];
  compactions: CompactEvent[];
  includeSidechain: boolean;
  onSelectRequest?: (key: string) => void;
}

/**
 * リクエスト毎のトークン推移チャート（上下二段・X 軸共有）。
 * 上段: コンテキストウインドウ内訳（cache read / cache write / input）の積み上げバー。
 * 下段: 出力トークンのバー。出力はコンテキストの構成要素ではないため積み上げず独立表示する。
 * コンパクション境界は破線の縦線（markLine）で示す。
 */
export function ContextChart({ requests, compactions, includeSidechain, onSelectRequest }: Props) {
  const filtered = useMemo(
    () => (includeSidechain ? requests : requests.filter((r) => !r.isSidechain)),
    [requests, includeSidechain],
  );

  // ECharts のイベントハンドラは init 時の closure に固定されるため、最新値を ref で参照する
  const filteredRef = useRef(filtered);
  filteredRef.current = filtered;
  const onSelectRef = useRef(onSelectRequest);
  onSelectRef.current = onSelectRequest;

  const option = useMemo<EChartsOption | null>(() => {
    if (filtered.length === 0) return null;

    // コンパクション境界: 直後のリクエストの位置に縦線を引く
    const compactIndices: { index: number; ev: CompactEvent }[] = [];
    for (const ev of compactions) {
      const idx = filtered.findIndex((r) => r.timestamp >= ev.timestamp);
      if (idx >= 0) compactIndices.push({ index: idx, ev });
    }
    const compactLabel = new Map(
      compactIndices.map((c) => [
        c.index + 1,
        `compact\n${formatTokens(c.ev.preTokens)}→${formatTokens(c.ev.postTokens)}`,
      ]),
    );

    const labels = filtered.map((_, i) => String(i + 1));

    return {
      animation: false,
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params: unknown) => {
          const list = params as { dataIndex: number }[];
          const first = list[0];
          const r = first ? filtered[first.dataIndex] : undefined;
          if (!r) return "";
          return requestTooltipRows(r, (first?.dataIndex ?? 0) + 1).join("<br/>");
        },
      },
      axisPointer: { link: [{ xAxisIndex: "all" }] },
      legend: { top: 0, textStyle: { fontSize: 11 } },
      grid: [
        { left: 70, right: 24, top: 32, height: "48%" },
        { left: 70, right: 24, top: "66%", bottom: 64 },
      ],
      xAxis: [
        {
          type: "category",
          gridIndex: 0,
          data: labels,
          axisLabel: { show: false },
          axisTick: { show: false },
        },
        {
          type: "category",
          gridIndex: 1,
          data: labels,
          name: "リクエスト",
          nameLocation: "middle",
          nameGap: 24,
          axisLabel: { fontSize: 10 },
        },
      ],
      yAxis: [
        {
          type: "value",
          gridIndex: 0,
          name: "コンテキスト (tokens)",
          axisLabel: { formatter: (v: number) => formatTokens(v), fontSize: 10 },
        },
        {
          type: "value",
          gridIndex: 1,
          name: "出力 (tokens)",
          axisLabel: { formatter: (v: number) => formatTokens(v), fontSize: 10 },
        },
      ],
      dataZoom: [
        { type: "inside", xAxisIndex: [0, 1] },
        { type: "slider", xAxisIndex: [0, 1], height: 16, bottom: 8 },
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
          large: true,
          data: filtered.map((r) => r.usage.cacheRead),
          markLine:
            compactIndices.length > 0
              ? {
                  symbol: "none",
                  label: {
                    position: "insideEndTop",
                    formatter: (p) =>
                      compactLabel.get(Number((p.data as { xAxis?: unknown }).xAxis)) ??
                      compactLabel.get(Number(p.value)) ??
                      "compact",
                    fontSize: 10,
                  },
                  lineStyle: { color: CHART_COLORS.compact, type: "dashed", width: 1.5 },
                  data: compactIndices.map((c) => ({ xAxis: String(c.index + 1) })),
                }
              : undefined,
        },
        {
          name: "キャッシュ書込",
          type: "bar",
          stack: "ctx",
          xAxisIndex: 0,
          yAxisIndex: 0,
          color: CHART_COLORS.cacheWrite,
          large: true,
          data: filtered.map((r) => r.usage.cacheCreation5m + r.usage.cacheCreation1h),
        },
        {
          name: "非キャッシュ入力",
          type: "bar",
          stack: "ctx",
          xAxisIndex: 0,
          yAxisIndex: 0,
          color: CHART_COLORS.input,
          large: true,
          data: filtered.map((r) => r.usage.input),
        },
        {
          name: "出力",
          type: "bar",
          xAxisIndex: 1,
          yAxisIndex: 1,
          color: CHART_COLORS.output,
          large: true,
          data: filtered.map((r) => r.usage.output),
        },
      ],
    };
  }, [filtered, compactions]);

  const containerRef = useECharts(option, (chart) => {
    // 系列上に限らずグリッド内のどこをクリックしても最寄りのリクエストを選択できるようにする
    chart.getZr().on("click", (event) => {
      const point: [number, number] = [event.offsetX, event.offsetY];
      for (const seriesIndex of [0, 3]) {
        if (!chart.containPixel({ seriesIndex }, point)) continue;
        const converted = chart.convertFromPixel({ seriesIndex }, point) as [number, number];
        const r = filteredRef.current[Math.round(converted[0])];
        if (r) onSelectRef.current?.(r.key);
        return;
      }
    });
  });

  if (filtered.length === 0) {
    return <div className="loading">表示できるリクエストがありません</div>;
  }
  return <div ref={containerRef} className="chart" style={{ height: 440 }} />;
}
