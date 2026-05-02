import { chartConfigs } from "../lib/replay.js";
import { TimeSeriesChart } from "./ChartsPanel.jsx";

function DetailChart({ config, replay, meta, anchors, hidden }) {
  return (
    <article className={`${config.className}${hidden ? " panel-hidden" : ""}`} id={`${config.id.replace("chart-", "")}ChartPanel`}>
      <div className="chart-title">
        <h3>{config.title}</h3>
        <span>{config.subtitle}</span>
      </div>
      <TimeSeriesChart config={config} replay={replay} meta={meta} anchors={anchors} />
    </article>
  );
}

function qualityClassName(value) {
  if (value.includes("原始观测")) return "observed";
  if (value.includes("插值")) return "interpolated";
  if (value.includes("派生")) return "derived";
  if (value.includes("占位") || value.includes("伪影")) return "placeholder";
  return "missing";
}

function MetricTable({ rows, valueRenderer }) {
  return (
    <table className="info-table">
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <th scope="row">{label}</th>
            <td>{valueRenderer ? valueRenderer(value) : value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DetailPanels({ meta, replay, anchors, snapshotItems, currentQuality }) {
  const detailCharts = chartConfigs.filter((item) => ["chart-engines", "chart-fuel"].includes(item.id));

  return (
    <details className="data-collapse" open={!replay.inPureAds} id="dataCollapse">
      <summary>展开双发细节曲线、当前状态和数据质量</summary>
      <div className="data-collapse-grid">
        {detailCharts.map((config) => (
          <DetailChart key={config.id} config={config} replay={replay} meta={meta} anchors={anchors} hidden={replay.inPureAds} />
        ))}
        <section className="state-panel">
          <h3>当前状态摘要</h3>
          <MetricTable rows={snapshotItems} />
        </section>
        <section className="state-panel">
          <h3>数据质量</h3>
          <MetricTable
            rows={currentQuality}
            valueRenderer={(value) => <span className={`quality-badge ${qualityClassName(value)}`}>{value}</span>}
          />
          <div className="quality-legend">
            <div>
              <span className="dot observed" />
              原始观测
            </div>
            <div>
              <span className="dot interpolated" />
              短缺口插值
            </div>
            <div>
              <span className="dot derived" />
              仅视觉派生
            </div>
            <div>
              <span className="dot placeholder" />
              修复/占位伪影
            </div>
          </div>
        </section>
        <section className="state-panel">
          <h3>方法说明</h3>
          <ul className="method-notes">
            {meta.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      </div>
    </details>
  );
}
