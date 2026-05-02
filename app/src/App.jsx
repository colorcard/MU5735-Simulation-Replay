import { useEffect, useMemo, useState } from "react";
import { SummaryHeader } from "./components/SummaryHeader.jsx";
import { ReplayControls } from "./components/ReplayControls.jsx";
import { TimelineTrack } from "./components/TimelineTrack.jsx";
import { OpsWorkbench } from "./components/OpsWorkbench.jsx";
import { EngineEvidencePanel, ScenePanels } from "./components/ScenePanels.jsx";
import { ChartsPanel, SecondaryChartsPanel } from "./components/ChartsPanel.jsx";
import { DetailPanels } from "./components/DetailPanels.jsx";
import { useReplayPlayer } from "./hooks/useReplayPlayer.js";
import { buildCutoffDetail, formatNumber, qualityText } from "./lib/replay.js";
import "./styles.css";

function LoadingState({ message, detail }) {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#071118",
        color: "#edf2f7",
        fontFamily: '"Avenir Next","Helvetica Neue","Trebuchet MS",Arial,sans-serif',
        padding: "24px"
      }}
    >
      <div style={{ textAlign: "center" }}>
        <h1 style={{ margin: 0, fontSize: "28px" }}>{message}</h1>
        {detail ? <p style={{ marginTop: "12px", color: "#98a8b7" }}>{detail}</p> : null}
      </div>
    </main>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const dataUrl = useMemo(() => `${import.meta.env.BASE_URL}data/mu5735_last2min_fused.json`, []);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const response = await fetch(dataUrl, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
        if (!alive) return;
        setData(payload);
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, [dataUrl]);

  const replay = useReplayPlayer(data);

  useEffect(() => {
    if (!data) return;
    document.title = data.meta?.title || "MU5735 回放";
  }, [data]);

  useEffect(() => {
    document.body.classList.toggle("pure-ads-mode", replay?.inPureAds ?? false);
    return () => {
      document.body.classList.remove("pure-ads-mode");
    };
  }, [replay?.inPureAds]);

  if (error) {
    return <LoadingState message="数据加载失败" detail={`${error}；读取路径：${dataUrl}`} />;
  }

  if (!data || !replay) {
    return <LoadingState message="加载 MU5735 回放数据" detail="正在初始化回放页面。" />;
  }

  const { meta, anchors } = data;
  const { currentTime, currentFrame, qualityFrame, engineEvents, phaseTransitions } = replay;

  const cutoffDetail = buildCutoffDetail(currentTime, phaseTransitions, engineEvents);
  const cutoff1 = currentTime >= (engineEvents.bothCutoffTime ?? Number.POSITIVE_INFINITY) ? "CUTOFF" : (engineEvents.eng1CutoffInitial || "RUN");
  const cutoff2 = currentTime >= (engineEvents.bothCutoffTime ?? Number.POSITIVE_INFINITY) ? "CUTOFF" : (engineEvents.eng2CutoffInitial || "RUN");

  const currentQuality = [
    ["姿态", qualityText(qualityFrame.quality["Pitch Angle"])],
    ["高度/速度", qualityText(qualityFrame.quality["Altitude Press"])],
    ["操纵杆/盘", `${qualityText(qualityFrame.quality["Ctrl Col Pos-L"])} / ${qualityText(qualityFrame.quality["Ctrl Whl Pos-L"])}`],
    ["舵面", qualityText(qualityFrame.quality["Elevator-L"])],
    ["发动机", qualityText(qualityFrame.quality["Eng1 N2 Actual"])]
  ];

  const useAdsSnapshot =
    meta.snapshotMode === "ads_only" ||
    (currentFrame.values["Ctrl Col Pos-L"] === null && currentFrame.values["Pitch Angle"] === null && currentFrame.values["Eng1 N2 Actual"] === null);

  const snapshotItems = useAdsSnapshot
    ? [
        ["高度", formatNumber(currentFrame.values["Altitude Press"], 0, " ft")],
        ["地速", formatNumber(currentFrame.values["Ground Spd"], 1, " kt")],
        ["下沉率", formatNumber(currentFrame.derived.verticalSpeedFpm, 0, " fpm")],
        ["航向", formatNumber(currentFrame.values["Heading"], 2, "°")],
        ["轨迹角", formatNumber(currentFrame.derived.flightPathAngleDeg, 1, "°")],
        ["航向变化率", formatNumber(currentFrame.derived.headingRateDps, 1, "°/s")],
        ["经度", formatNumber(currentFrame.derived.longitude, 5, "")],
        ["纬度", formatNumber(currentFrame.derived.latitude, 5, "")]
      ]
    : [
        ["操纵杆", formatNumber(currentFrame.values["Ctrl Col Pos-L"], 2, "°")],
        ["操纵盘", formatNumber(currentFrame.values["Ctrl Whl Pos-L"], 2, "°")],
        ["升降舵", formatNumber(currentFrame.values["Elevator-L"], 2, "°")],
        ["副翼", formatNumber(currentFrame.values["Aileron-R"], 2, "°")],
        ["方向舵", formatNumber(currentFrame.values["Rudder"], 2, "°")],
        ["Cutoff SW", `${cutoff1} / ${cutoff2}`],
        ["发1 N2", formatNumber(currentFrame.values["Eng1 N2 Actual"], 2, "%")],
        ["发2 N2", formatNumber(currentFrame.values["Eng2 N2 Actual"], 2, "%")],
        ["地速", formatNumber(currentFrame.values["Ground Spd"], 1, " kt")]
      ];

  return (
    <div className="app-shell">
      <SummaryHeader meta={meta} anchors={anchors} engineEvents={engineEvents} />
      <ReplayControls replay={replay} />
      <TimelineTrack meta={meta} anchors={anchors} replay={replay} />

      <main className={`workbench${replay.inPureAds ? " pure-ads-layout" : ""}`} id="workbench">
        <OpsWorkbench
          meta={meta}
          replay={replay}
          cutoff1={cutoff1}
          cutoff2={cutoff2}
          cutoffDetail={cutoffDetail}
        />

        <section className="data-panel">
          <ScenePanels replay={replay} />
          <ChartsPanel meta={meta} replay={replay} anchors={anchors} />
          <SecondaryChartsPanel meta={meta} replay={replay} anchors={anchors} />
          <EngineEvidencePanel meta={meta} replay={replay} />
          <DetailPanels
            meta={meta}
            replay={replay}
            anchors={anchors}
            snapshotItems={snapshotItems}
            currentQuality={currentQuality}
          />
        </section>
      </main>
    </div>
  );
}
