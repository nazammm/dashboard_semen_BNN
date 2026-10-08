import { useEffect, useRef } from 'react';
import { Chart, registerables, type ChartConfiguration } from 'chart.js';
import { fmt } from './format';

Chart.register(...registerables);

let defaultsApplied = false;
export function applyChartDefaults() {
  if (defaultsApplied) return;
  defaultsApplied = true;
  const d = Chart.defaults;
  d.font.family = "'IBM Plex Mono', monospace";
  d.font.size = 11;
  d.color = '#645E52';
  d.borderColor = '#C6BFAF';
  d.plugins.legend.display = false;
  d.plugins.tooltip.backgroundColor = '#211E19';
  d.plugins.tooltip.titleFont = { family: "'IBM Plex Mono', monospace", size: 11, weight: 600 };
  d.plugins.tooltip.bodyFont = { family: "'IBM Plex Mono', monospace", size: 11 };
  d.plugins.tooltip.padding = 10;
  d.plugins.tooltip.cornerRadius = 3;
  d.plugins.tooltip.displayColors = true;
  d.plugins.tooltip.boxPadding = 4;
  (d.elements.bar as any).borderRadius = 3;
}

/**
 * Pasang satu Chart.js ke <canvas>. `build` dipanggil ulang setiap `deps` berubah
 * (chart lama dihancurkan). Kembalikan null dari build kalau belum ada data.
 */
export function useChart(build: () => ChartConfiguration | null, deps: unknown[]) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    applyChartDefaults();
    const canvas = ref.current;
    if (!canvas) return;
    const cfg = build();
    if (!cfg) return;
    const chart = new Chart(canvas, cfg);
    return () => chart.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

/** Plugin legend+tooltip donut yang menampilkan persentase. */
export function donutPercentPlugins(unitLabel = 'ton', valueFmt?: (v: number) => string) {
  const fv = valueFmt || ((v: number) => `${fmt(v)} ${unitLabel}`);
  return {
    legend: {
      display: true, position: 'bottom' as const,
      labels: {
        boxWidth: 10, font: { size: 10.5, family: "'IBM Plex Mono', monospace" }, color: '#645E52',
        generateLabels(chart: Chart) {
          const ds: any = chart.data.datasets[0];
          const total = (ds.data as number[]).reduce((a, b) => a + Number(b || 0), 0);
          return (chart.data.labels as string[]).map((label, i) => {
            const v = Number(ds.data[i] || 0);
            const p = total > 0 ? (v / total) * 100 : 0;
            return { text: `${label} (${p.toFixed(1)}%)`, fillStyle: ds.backgroundColor[i], strokeStyle: ds.borderColor || '#F8F6F0', lineWidth: 1, index: i };
          });
        },
      },
    },
    tooltip: {
      callbacks: {
        label(c: any) {
          const total = (c.dataset.data as number[]).reduce((a, b) => a + Number(b || 0), 0);
          const p = total > 0 ? (c.parsed / total) * 100 : 0;
          return ` ${c.label}: ${fv(c.parsed)} (${p.toFixed(1)}%)`;
        },
      },
    },
  };
}
