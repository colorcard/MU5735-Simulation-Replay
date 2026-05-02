import { timeOrDash } from "../lib/replay.js";

export function SummaryHeader({ meta, anchors, engineEvents }) {
  const firstEvent = anchors.find((item) => item.id === "both_cutoff") || anchors.find((item) => item.id === "n2_drop") || anchors[0];
  const fuelTimes = [engineEvents.eng1FuelZeroTime, engineEvents.eng2FuelZeroTime].filter((value) => value !== null && value !== undefined);

  return (
    <header className="hero">
      <div className="hero-copy">
        <p className="eyebrow">{meta.eyebrow || "MU5735 末段数据回放"}</p>
        <h1>{meta.title || "MU5735 回放"}</h1>
        <p className="subtitle">{meta.subtitle}</p>
      </div>
      <div className="hero-meta">
        <div className="meta-line">
          <span>回放范围</span>
          <strong>{meta.rangeLabel || `${meta.startTime} — ${meta.endTime}`}</strong>
        </div>
        <div className="meta-line">
          <span>关断开关</span>
          <strong>{meta.primaryEventText || (firstEvent ? `${firstEvent.title} @ T+${firstEvent.t.toFixed(2)}s` : "未识别")}</strong>
        </div>
        <div className="meta-line">
          <span>燃油归零</span>
          <strong>
            {meta.summaryFuelText ||
              (fuelTimes.length ? `发1 ${timeOrDash(engineEvents.eng1FuelZeroTime)} / 发2 ${timeOrDash(engineEvents.eng2FuelZeroTime)}` : "未识别")}
          </strong>
        </div>
        <div className="meta-line">
          <span>窗口说明</span>
          <strong>{meta.windowSummary}</strong>
        </div>
      </div>
    </header>
  );
}
