import { formatNumber, physicalControlNormalized, qualityText, baselineNormalized } from "../lib/replay.js";

function MeterRow({ label, value, field, meta }) {
  const norm = baselineNormalized(meta, value, field);
  return (
    <div className="surface-row">
      <label>{label}</label>
      <div className="meter-track">
        <span className="meter-needle" style={{ left: `calc(${norm * 100}% - 8px)` }} />
      </div>
      <strong>{formatNumber(value, 2, "°")}</strong>
    </div>
  );
}

export function OpsWorkbench({ meta, replay, cutoff1, cutoff2, cutoffDetail }) {
  const { currentFrame, qualityFrame, inPureAds, showControls, showEngines } = replay;
  const columnMissing =
    currentFrame.values["Ctrl Col Pos-L"] === null || ["missing", "placeholder"].includes(qualityFrame.quality["Ctrl Col Pos-L"]);
  const wheelMissing =
    currentFrame.values["Ctrl Whl Pos-L"] === null || ["missing", "placeholder"].includes(qualityFrame.quality["Ctrl Whl Pos-L"]);
  const columnNorm = physicalControlNormalized(meta, currentFrame.values["Ctrl Col Pos-L"], "Ctrl Col Pos-L");
  const wheelNorm = physicalControlNormalized(meta, currentFrame.values["Ctrl Whl Pos-L"], "Ctrl Whl Pos-L");
  const wheelDisplay = (wheelNorm - 0.5) * 180;

  return (
    <aside className={`ops-panel${inPureAds ? " panel-hidden" : ""}`} id="opsPanel">
      <div className="ops-head">
        <h2>实体操作台</h2>
        <p>围绕巡航基准位校准，优先看操纵件与关断开关</p>
      </div>

      <section className={`ops-section${inPureAds ? " panel-hidden" : ""}`} id="cutoffSection">
        <div className="ops-title">
          <span>Cutoff 开关</span>
        </div>
        <div className="switch-column">
          <div className="switch-card">
            <span>Eng1 Cutoff SW</span>
            <strong>{cutoff1}</strong>
            <small>{cutoffDetail}</small>
          </div>
          <div className="switch-card">
            <span>Eng2 Cutoff SW</span>
            <strong>{cutoff2}</strong>
            <small>{cutoffDetail}</small>
          </div>
        </div>
      </section>

      <section className={`ops-section${inPureAds ? " panel-hidden" : ""}`} id="controlsSection">
        <div className="ops-title">
          <span>操纵件</span>
        </div>
        <div className="control-stack">
          <div className="control-block">
            <div className="control-header">
              <span>操纵杆纵向</span>
              <strong>{formatNumber(currentFrame.values["Ctrl Col Pos-L"], 2, "°")}</strong>
            </div>
            <div className={`column-widget${columnMissing ? " control-missing" : ""}`}>
              <div className="column-scale-label top">抬头</div>
              <div className="column-rail" />
              <div className="column-handle" style={{ top: `${11 + (1 - columnNorm) * 116}px` }} />
              <div className="column-scale-label bottom">低头</div>
            </div>
          </div>

          <div className="control-block">
            <div className="control-header">
              <span>操纵盘横向</span>
              <strong>{formatNumber(currentFrame.values["Ctrl Whl Pos-L"], 2, "°")}</strong>
            </div>
            <div className={`wheel-widget${wheelMissing ? " control-missing" : ""}`}>
              <div className="wheel-label left">左滚</div>
              <div className="wheel-yoke" style={{ transform: `rotate(${wheelDisplay.toFixed(2)}deg)` }}>
                <span className="yoke-bar left" />
                <span className="yoke-bar right" />
                <span className="yoke-hub" />
              </div>
              <div className="wheel-label right">右滚</div>
            </div>
          </div>
        </div>
      </section>

      <section className={`ops-section${inPureAds ? " panel-hidden" : ""}`} id="surfacesSection">
        <div className="ops-title">
          <span>舵面反馈</span>
          <strong>
            杆 {qualityText(qualityFrame.quality["Ctrl Col Pos-L"])} / 盘 {qualityText(qualityFrame.quality["Ctrl Whl Pos-L"])} / 升降{" "}
            {qualityText(qualityFrame.quality["Elevator-L"])}
          </strong>
        </div>
        <div className="surface-meters">
          <MeterRow label="升降舵" value={currentFrame.values["Elevator-L"]} field="Elevator-L" meta={meta} />
          <MeterRow label="副翼" value={currentFrame.values["Aileron-R"]} field="Aileron-R" meta={meta} />
          <MeterRow label="方向舵" value={currentFrame.values["Rudder"]} field="Rudder" meta={meta} />
        </div>
      </section>

      <details className={`ops-collapse${inPureAds ? " panel-hidden" : ""}`} open>
        <summary>发动机即时状态</summary>
        <div className="engine-grid">
          <div className="engine-card">
            <div className="engine-head">
              <span>发动机 1</span>
              <strong>{formatNumber(currentFrame.values["Eng1 N2 Actual"], 2, "%")}</strong>
            </div>
            <div className="engine-bar">
              <span style={{ width: `${Math.max(0, Math.min(1, (currentFrame.values["Eng1 N2 Actual"] ?? 0) / 110)) * 100}%` }} />
            </div>
            <small>
              N1 {formatNumber(currentFrame.values["Eng1 N1"], 2, "%")} / FF {formatNumber(currentFrame.values["Eng1 Fuel Flow"], 0, "")}
            </small>
          </div>
          <div className="engine-card">
            <div className="engine-head">
              <span>发动机 2</span>
              <strong>{formatNumber(currentFrame.values["Eng2 N2 Actual"], 2, "%")}</strong>
            </div>
            <div className="engine-bar">
              <span style={{ width: `${Math.max(0, Math.min(1, (currentFrame.values["Eng2 N2 Actual"] ?? 0) / 110)) * 100}%` }} />
            </div>
            <small>
              N1 {formatNumber(currentFrame.values["Eng2 N1"], 2, "%")} / FF {formatNumber(currentFrame.values["Eng2 Fuel Flow"], 0, "")}
            </small>
          </div>
        </div>
      </details>
    </aside>
  );
}
