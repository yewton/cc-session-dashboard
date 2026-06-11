import { useEffect, useRef } from "react";
import * as echarts from "echarts";

/** ECharts インスタンスのライフサイクル（init / resize / dispose / setOption）を管理する */
export function useECharts(
  option: echarts.EChartsOption | null,
  onInit?: (chart: echarts.ECharts) => void,
): React.RefObject<HTMLDivElement | null> {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const onInitRef = useRef(onInit);
  onInitRef.current = onInit;

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = echarts.init(containerRef.current);
    chartRef.current = chart;
    onInitRef.current?.(chart);
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (option && chartRef.current) {
      chartRef.current.setOption(option, { notMerge: true });
    }
  }, [option]);

  return containerRef;
}
