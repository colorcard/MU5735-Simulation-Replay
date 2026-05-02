import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { chartConfigs, formatNumber, qualityText, rangeFor } from "../lib/replay.js";

const EVENT_LABELS = {
  both_cutoff: "Cutoff",
  n2_drop: "N2下降",
  fuel_zero: "燃油近零",
  fdr_end: "FDR终止",
  high_descent: "高下沉率",
  gs_400: "GS<400",
  alt_10000: "Alt<10000",
  alt_5000: "Alt<5000"
};

const EVENT_LABELS_BY_CHART = {
  "chart-energy": ["both_cutoff", "n2_drop", "fuel_zero", "fdr_end", "gs_400", "alt_10000", "alt_5000"],
  "chart-attitude": ["both_cutoff", "n2_drop", "fuel_zero", "fdr_end"],
  "chart-controls": ["both_cutoff", "n2_drop", "fuel_zero", "fdr_end"],
  "chart-engines": ["both_cutoff", "n2_drop", "fuel_zero", "fdr_end"],
  "chart-fuel": ["both_cutoff", "fuel_zero", "fdr_end"]
};

function buildChartData(config, replay) {
  const domainEnd = config.timelineMode === "fdr" ? replay.fdrTimelineEnd : replay.duration;
  const frames = replay.frames.filter((frame) => frame.t <= domainEnd + 1e-9);
  return frames.map((frame) => {
    const row = { t: frame.t };
    config.series.forEach((series) => {
      const value = frame.values[series.field];
      const quality = frame.quality[series.field];
      row[`${series.field}__observed`] = value !== null && quality === "observed" ? value : null;
      row[`${series.field}__interpolated`] =
        value !== null && quality !== "observed" && quality !== "missing" && quality !== "placeholder" ? value : null;
      row[`${series.field}__quality`] = quality;
    });
    return row;
  });
}

function keyFromDataKey(dataKey) {
  return String(dataKey || "").replace(/__(observed|interpolated)$/, "");
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((item) => item.value !== null && item.value !== undefined);
  if (!rows.length) return null;

  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-time">T+{Number(label).toFixed(2)}s</div>
      {rows.map((row) => (
        <div key={`${row.dataKey}-${row.name}`} className="chart-tooltip-row">
          <span style={{ color: row.color }}>{row.name}</span>
          <strong>
            {formatNumber(Number(row.value), 2, row.unit ? ` ${row.unit}` : "")}
            {row.payload?.[`${keyFromDataKey(row.dataKey)}__quality`]
              ? ` · ${qualityText(row.payload[`${keyFromDataKey(row.dataKey)}__quality`])}`
              : ""}
          </strong>
        </div>
      ))}
    </div>
  );
}

function NoDataOverlay({ text }) {
  return (
    <div className="chart-empty">
      <strong>{text}</strong>
      <span>该时段缺少可直接支持的记录</span>
    </div>
  );
}

function buildEventLines(config, replay, anchors) {
  const domainEnd = config.timelineMode === "fdr" ? replay.fdrTimelineEnd : replay.duration;
  const allowed = EVENT_LABELS_BY_CHART[config.id] || Object.keys(EVENT_LABELS);
  return anchors
    .filter((anchor) => allowed.includes(anchor.id) && EVENT_LABELS[anchor.id] && anchor.t >= 0 && anchor.t <= domainEnd + 1e-9)
    .map((anchor) => ({
      ...anchor,
      shortLabel: EVENT_LABELS[anchor.id]
    }));
}

function buildPlaceholderAreas(meta, domainEnd, chartId) {
  return meta.placeholderIntervals
    .map((interval) => ({
      key: `placeholder-${chartId}-${interval.start}-${interval.end}`,
      x1: Math.max(0, interval.start),
      x2: Math.min(interval.end, domainEnd)
    }))
    .filter((interval) => interval.x2 > interval.x1 + 1e-9);
}

function buildAxisDomain(meta, config, axis) {
  const axisSeries = config.series.filter((series) => (series.yAxisId || "left") === axis.id);
  if (!axisSeries.length) return ["auto", "auto"];

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  axisSeries.forEach((series) => {
    const range = rangeFor(meta, series.field);
    min = Math.min(min, range.min);
    max = Math.max(max, range.max);
  });

  if (!Number.isFinite(min) || !Number.isFinite(max)) return ["auto", "auto"];

  if (axis.includeZero) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }

  if (axis.symmetric) {
    const maxAbs = Math.max(Math.abs(min), Math.abs(max), 1);
    return [-maxAbs, maxAbs];
  }

  const span = Math.max(max - min, 1);
  const pad = span * 0.08;
  return [min - pad, max + pad];
}

function CompactSeriesKey({ config }) {
  return (
    <div className="chart-series-key">
      {config.series.map((series) => (
        <span key={`${config.id}-${series.field}`} className="chart-series-chip">
          <i style={{ background: series.color }} />
          {series.label}
        </span>
      ))}
    </div>
  );
}

function TimeSeriesChart({ config, replay, meta, anchors }) {
  const domainEnd = config.timelineMode === "fdr" ? replay.fdrTimelineEnd : replay.duration;
  const chartData = buildChartData(config, replay);
  const eventLines = buildEventLines(config, replay, anchors);
  const placeholderAreas = buildPlaceholderAreas(meta, domainEnd, config.id);
  const primaryAxisId = config.axes[0]?.id || "left";
  const hasAnyPoint = chartData.some((row) =>
    config.series.some((series) => row[`${series.field}__observed`] !== null || row[`${series.field}__interpolated`] !== null)
  );

  return (
    <div className={`${config.svgClassName} recharts-shell`}>
      {hasAnyPoint ? null : <NoDataOverlay text={(meta.noDataMessages && meta.noDataMessages[config.id]) || "该窗口无可用记录"} />}
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 6 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="4 4" vertical={false} />
          {placeholderAreas.map((interval) => (
            <ReferenceArea
              key={interval.key}
              x1={interval.x1}
              x2={interval.x2}
              fill="rgba(116, 128, 145, 0.14)"
              ifOverflow="hidden"
            />
          ))}
          {config.timelineMode === "full" &&
          replay.phaseTransitions.pureAdsStartTime !== null &&
          replay.phaseTransitions.pureAdsStartTime !== undefined &&
          replay.phaseTransitions.pureAdsStartTime < domainEnd - 1e-9 ? (
            <ReferenceArea
              x1={replay.phaseTransitions.pureAdsStartTime}
              x2={domainEnd}
              fill="rgba(121, 208, 211, 0.08)"
              ifOverflow="hidden"
            />
          ) : null}
          <XAxis
            dataKey="t"
            type="number"
            domain={[0, domainEnd]}
            allowDataOverflow
            tickCount={7}
            tick={{ fill: "rgba(255,255,255,0.68)", fontSize: 11 }}
            tickFormatter={(value) => `T+${Number(value).toFixed(0)}s`}
            stroke="rgba(255,255,255,0.16)"
          />
          {config.axes.map((axis) => (
            <YAxis
              key={axis.id}
              yAxisId={axis.id}
              domain={buildAxisDomain(meta, config, axis)}
              orientation={axis.orientation || "left"}
              width={48}
              allowDataOverflow
              tickCount={axis.tickCount || 6}
              tick={{ fill: axis.color || "rgba(255,255,255,0.68)", fontSize: 11 }}
              stroke="rgba(255,255,255,0.16)"
              unit={axis.unit ? ` ${axis.unit}` : ""}
            />
          ))}
          <Tooltip content={<ChartTooltip />} />
          {eventLines.map((anchor) => (
            <ReferenceLine
              key={`${config.id}-${anchor.id}`}
              x={anchor.t}
              yAxisId={primaryAxisId}
              stroke="rgba(255,255,255,0.22)"
              strokeDasharray="5 5"
              ifOverflow="hidden"
              label={{
                value: anchor.shortLabel,
                position: "top",
                fill: "rgba(255,255,255,0.66)",
                fontSize: 10
              }}
            />
          ))}
          <ReferenceLine
            x={Math.min(replay.currentTime, domainEnd)}
            yAxisId={primaryAxisId}
            stroke="rgba(245,178,72,0.95)"
            strokeWidth={2}
          />
          {config.series.map((series) => (
            <Line
              key={`${series.field}-obs`}
              type="linear"
              yAxisId={series.yAxisId || "left"}
              dataKey={`${series.field}__observed`}
              name={series.label}
              unit={config.axes.find((axis) => axis.id === (series.yAxisId || "left"))?.unit || ""}
              stroke={series.color}
              strokeWidth={2.4}
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
              strokeLinecap="round"
            />
          ))}
          {config.series.map((series) => (
            <Line
              key={`${series.field}-int`}
              type="linear"
              yAxisId={series.yAxisId || "left"}
              dataKey={`${series.field}__interpolated`}
              name={`${series.label}·插值`}
              unit={config.axes.find((axis) => axis.id === (series.yAxisId || "left"))?.unit || ""}
              stroke={series.color}
              strokeWidth={2}
              strokeDasharray="8 6"
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
              legendType="none"
              strokeLinecap="round"
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ChartsPanel({ meta, replay, anchors }) {
  const energyChart = chartConfigs.find((item) => item.id === "chart-energy");

  return (
    <section className={`charts-section${replay.inPureAds ? " energy-focus" : ""}`} id="chartsSection">
      <div className="section-head">
        <h2>核心图表</h2>
        <p>集中展示末段能量、姿态和操纵变化</p>
      </div>
      <div className="chart-legend-note">实线为原始记录，虚线为短时插值；灰带表示异常记录区，青带表示纯 ADS 段。</div>
      <div className="chart-grid-main">
        {energyChart ? (
          <article
            className={`chart-panel chart-panel-hero${replay.inPureAds ? " chart-panel-focus" : ""}`}
            id={`${energyChart.id.replace("chart-", "")}ChartPanel`}
          >
            <div className="chart-title">
              <h3>{energyChart.title}</h3>
              <span>{energyChart.subtitle}</span>
            </div>
            <CompactSeriesKey config={energyChart} />
            <TimeSeriesChart config={energyChart} replay={replay} meta={meta} anchors={anchors} />
          </article>
        ) : null}
      </div>
    </section>
  );
}

export function SecondaryChartsPanel({ meta, replay, anchors }) {
  const attitudeChart = chartConfigs.find((item) => item.id === "chart-attitude");
  const controlsChart = chartConfigs.find((item) => item.id === "chart-controls");

  return (
    <section className={`chart-secondary-row${replay.inPureAds ? " panel-hidden" : ""}`} id="secondaryChartsRow">
      {attitudeChart ? (
        <article className="chart-panel chart-panel-secondary" id={`${attitudeChart.id.replace("chart-", "")}ChartPanel`}>
          <div className="chart-title">
            <h3>{attitudeChart.title}</h3>
            <span>{attitudeChart.subtitle}</span>
          </div>
          <CompactSeriesKey config={attitudeChart} />
          <TimeSeriesChart config={attitudeChart} replay={replay} meta={meta} anchors={anchors} />
        </article>
      ) : null}

      {controlsChart ? (
        <article className="chart-panel chart-panel-secondary" id={`${controlsChart.id.replace("chart-", "")}ChartPanel`}>
          <div className="chart-title">
            <h3>{controlsChart.title}</h3>
            <span>{controlsChart.subtitle}</span>
          </div>
          <CompactSeriesKey config={controlsChart} />
          <TimeSeriesChart config={controlsChart} replay={replay} meta={meta} anchors={anchors} />
        </article>
      ) : null}
    </section>
  );
}

export { TimeSeriesChart };
