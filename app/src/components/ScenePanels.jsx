import { useEffect, useRef, useState } from "react";
import { formatNumber, rangeFor } from "../lib/replay.js";

function resizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.round(rect.width * ratio);
  const height = Math.round(rect.height * ratio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { ctx: canvas.getContext("2d"), width, height, ratio };
}

function drawContinuousPath(ctx, points, xFn, yFn, stroke, dashed) {
  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2.5;
  if (dashed) ctx.setLineDash([6, 6]);
  ctx.beginPath();
  let started = false;
  points.forEach((point) => {
    const x = xFn(point);
    const y = yFn(point);
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();
  ctx.restore();
}

function drawEvidencePath(ctx, points, color) {
  let segment = [];
  const flush = (dashed) => {
    if (segment.length < 2) {
      segment = [];
      return;
    }
    drawContinuousPath(ctx, segment, (point) => point.x, (point) => point.y, color, dashed);
    segment = [];
  };

  let currentDash = false;
  points.forEach((point) => {
    if (!point) {
      flush(currentDash);
      return;
    }
    if (!segment.length) {
      currentDash = point.dashed;
      segment.push(point);
      return;
    }
    if (point.dashed !== currentDash) {
      flush(currentDash);
      currentDash = point.dashed;
    }
    segment.push(point);
  });
  flush(currentDash);
}

function drawUnavailableState(ctx, w, h, label, secondary = []) {
  ctx.fillStyle = "rgba(255,255,255,0.035)";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.setLineDash([8, 8]);
  ctx.beginPath();
  ctx.moveTo(24, 24);
  ctx.lineTo(w - 24, h - 24);
  ctx.moveTo(w - 24, 24);
  ctx.lineTo(24, h - 24);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(255,255,255,0.78)";
  ctx.font = "15px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(label, w / 2, h / 2 - (secondary.length ? 12 : 0));
  if (secondary.length) {
    ctx.font = "12px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.64)";
    secondary.forEach((line, index) => {
      ctx.fillText(line, w / 2, h / 2 + 12 + index * 16);
    });
  }
}

function drawMiniUnavailable(ctx, w, h, label) {
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(label, w - 14, h - 14);
}

function HorizonCanvas({ replay, resizeTick }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const frame = replay.currentFrame;
    const { ctx, width, height, ratio } = resizeCanvas(canvas);
    const w = width / ratio;
    const h = height / ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#0d1823";
    ctx.fillRect(0, 0, w, h);

    const pitch = frame.values["Pitch Angle"];
    const roll = frame.values["Roll Angle"];
    if (pitch === null || roll === null) {
      const proxy = [];
      if (frame.derived.flightPathAngleDeg !== null && frame.derived.flightPathAngleDeg !== undefined) {
        proxy.push(`ADS 轨迹角 ${formatNumber(frame.derived.flightPathAngleDeg, 1, "°")}`);
      }
      if (frame.derived.headingRateDps !== null && frame.derived.headingRateDps !== undefined) {
        proxy.push(`ADS 航向变化率 ${formatNumber(frame.derived.headingRateDps, 1, "°/s")}`);
      }
      drawUnavailableState(ctx, w, h, "无 FDR 姿态记录", proxy.length ? proxy : ["该时段只能看到 ADS 外部轨迹"]);
      return;
    }

    const centerX = w / 2;
    const centerY = h / 2;
    const pitchShift = pitch * 5.2;
    ctx.save();
    ctx.translate(centerX, centerY + pitchShift);
    ctx.rotate((-roll * Math.PI) / 180);
    ctx.fillStyle = "rgba(77,155,200,0.82)";
    ctx.fillRect(-w, -h * 2, w * 2, h * 2);
    ctx.fillStyle = "rgba(139,105,58,0.82)";
    ctx.fillRect(-w, 0, w * 2, h * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.65)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-w, 0);
    ctx.lineTo(w, 0);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 1;
    for (let i = -4; i <= 4; i += 1) {
      if (i === 0) continue;
      const y = i * 26;
      ctx.beginPath();
      ctx.moveTo(-40, y);
      ctx.lineTo(40, y);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = "rgba(255,255,255,0.92)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(centerX - 34, centerY);
    ctx.lineTo(centerX - 8, centerY);
    ctx.moveTo(centerX + 8, centerY);
    ctx.lineTo(centerX + 34, centerY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(centerX, centerY - 10);
    ctx.lineTo(centerX, centerY + 10);
    ctx.stroke();
  }, [replay, resizeTick]);

  return <canvas ref={ref} className="scene-canvas" />;
}

function EngineEvidenceCanvas({ replay, meta, resizeTick }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const { ctx, width, height, ratio } = resizeCanvas(canvas);
    const w = width / ratio;
    const h = height / ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.03)";
    ctx.fillRect(0, 0, w, h);
    const pad = 16;
    const innerW = w - pad * 2;
    const innerH = h - pad * 2;
    const domainEnd = replay.fdrTimelineEnd;
    const series = [
      { field: "Eng1 N2 Actual", color: "#7dd3fc", label: "N2-1", max: 110 },
      { field: "Eng2 N2 Actual", color: "#f5b248", label: "N2-2", max: 110 },
      { field: "Eng1 Fuel Flow", color: "#79d0d3", label: "FF-1", max: rangeFor(meta, "Eng1 Fuel Flow").max || 1 },
      { field: "Eng2 Fuel Flow", color: "#ef6f51", label: "FF-2", max: rangeFor(meta, "Eng2 Fuel Flow").max || 1 }
    ];
    let hasAny = false;
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    for (let i = 0; i < 4; i += 1) {
      const y = pad + (innerH / 3) * i;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(w - pad, y);
      ctx.stroke();
    }
    series.forEach((spec, index) => {
      const points = replay.frames
        .filter((item) => item.t <= domainEnd + 1e-9)
        .map((item) => {
          const value = item.values[spec.field];
          const q = item.quality[spec.field];
          if (value === null || q === "missing" || q === "placeholder") return null;
          return {
          x: pad + (item.t / domainEnd) * innerW,
          y: pad + innerH - (value / spec.max) * innerH,
          dashed: q !== "observed"
          };
        });
      if (points.some((item) => item)) hasAny = true;
      drawEvidencePath(ctx, points, spec.color);
      ctx.fillStyle = spec.color;
      ctx.font = "11px sans-serif";
      ctx.fillText(spec.label, pad + 8 + index * 54, pad + 14);
    });

    const markers = [
      { t: replay.engineEvents.bothCutoffTime, label: "SW→CUTOFF", color: "#ffffff" },
      { t: replay.engineEvents.eng1FuelZeroTime, label: "FF1=0", color: "#79d0d3" },
      { t: replay.engineEvents.eng2FuelZeroTime, label: "FF2=0", color: "#ef6f51" }
    ].filter((item) => item.t !== null && item.t !== undefined);

    markers.forEach((marker, index) => {
      if (marker.t > domainEnd) return;
      const x = pad + (marker.t / domainEnd) * innerW;
      ctx.strokeStyle = marker.color;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(x, pad);
      ctx.lineTo(x, h - pad);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = marker.color;
      ctx.font = "10px sans-serif";
      ctx.fillText(marker.label, Math.min(x + 4, w - 70), pad + 26 + index * 12);
    });

    const currentX = pad + (Math.min(replay.currentTime, domainEnd) / domainEnd) * innerW;
    ctx.strokeStyle = "rgba(245, 178, 72, 0.95)";
    ctx.beginPath();
    ctx.moveTo(currentX, pad);
    ctx.lineTo(currentX, h - pad);
    ctx.stroke();

    if (!hasAny) {
      drawUnavailableState(ctx, w, h, "本窗口无 FDR 发动机记录", ["ADS-B 不提供 N1/N2/燃油流量"]);
      return;
    }
    drawMiniUnavailable(ctx, w, h, "归一化叠加: N2 与燃油流量");
  }, [replay, meta, resizeTick]);

  return <canvas ref={ref} className="mini-canvas evidence-canvas" />;
}

function useResizeTick() {
  const [resizeTick, setResizeTick] = useState(0);

  useEffect(() => {
    function onResize() {
      setResizeTick((value) => value + 1);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return resizeTick;
}

export function ScenePanels({ replay }) {
  const resizeTick = useResizeTick();

  const frame = replay.currentFrame;
  return (
    <section className={`scene-section${replay.inPureAds ? " panel-hidden" : ""}`} id="sceneSection">
      <div className="section-head">
        <h2>姿态与场景</h2>
        <p>主画布展示姿态变化与即时外部参数</p>
      </div>
      <div className="scene-stage">
        <HorizonCanvas replay={replay} resizeTick={resizeTick} />
        <div className="scene-overlay">
          <div className="overlay-tag">
            <span>俯仰</span>
            <strong>{formatNumber(frame.values["Pitch Angle"], 2, "°")}</strong>
          </div>
          <div className="overlay-tag">
            <span>横滚</span>
            <strong>{formatNumber(frame.values["Roll Angle"], 2, "°")}</strong>
          </div>
          <div className="overlay-tag">
            <span>航向</span>
            <strong>{formatNumber(frame.values["Heading"], 2, "°")}</strong>
          </div>
          <div className="overlay-tag">
            <span>高度</span>
            <strong>{formatNumber(frame.values["Altitude Press"], 0, " ft")}</strong>
          </div>
          <div className="overlay-tag">
            <span>地速</span>
            <strong>{formatNumber(frame.values["Ground Spd"], 1, " kt")}</strong>
          </div>
          <div className="overlay-tag">
            <span>下沉率</span>
            <strong>{formatNumber(frame.derived.verticalSpeedFpm, 0, " fpm")}</strong>
          </div>
        </div>
      </div>
    </section>
  );
}

export function EngineEvidencePanel({ meta, replay }) {
  const resizeTick = useResizeTick();

  return (
    <section className={`evidence-strip${replay.inPureAds ? " panel-hidden" : ""}`} id="engineEvidencePanel">
      <div className="evidence-head">
        <h3>事故链证据图</h3>
        <span>Cutoff SW / Fuel Flow / N2</span>
      </div>
      <EngineEvidenceCanvas replay={replay} meta={meta} resizeTick={resizeTick} />
    </section>
  );
}
