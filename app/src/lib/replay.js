export const chartConfigs = [
  {
    id: "chart-energy",
    title: "高度 / 地速",
    subtitle: "末段能量变化",
    className: "chart-panel chart-panel-large",
    svgClassName: "chart-svg chart-svg-large",
    timelineMode: "full",
    axes: [
      { id: "left", unit: "ft", color: "#7dd3fc", tickCount: 6 },
      { id: "right", unit: "kt", color: "#f5b248", orientation: "right", tickCount: 6 }
    ],
    series: [
      { field: "Altitude Press", label: "高度", color: "#7dd3fc", yAxisId: "left" },
      { field: "Ground Spd", label: "地速", color: "#f5b248", yAxisId: "right" }
    ]
  },
  {
    id: "chart-attitude",
    title: "俯仰 / 横滚 / 滚转率",
    subtitle: "姿态变化",
    className: "chart-panel chart-panel-large",
    svgClassName: "chart-svg chart-svg-large",
    timelineMode: "fdr",
    axes: [
      { id: "left", unit: "deg", color: "#f5b248", symmetric: true, tickCount: 7 },
      { id: "right", unit: "deg/s", color: "#ef6f51", orientation: "right", symmetric: true, tickCount: 6 }
    ],
    series: [
      { field: "Pitch Angle", label: "俯仰", color: "#f5b248", yAxisId: "left" },
      { field: "Roll Angle", label: "横滚", color: "#7dd3fc", yAxisId: "left" },
      { field: "Roll Rate", label: "滚率", color: "#ef6f51", yAxisId: "right" }
    ]
  },
  {
    id: "chart-controls",
    title: "操纵输入",
    subtitle: "操纵杆 / 操纵盘 / 升降舵 / 副翼",
    className: "chart-panel chart-panel-wide",
    svgClassName: "chart-svg chart-svg-medium",
    timelineMode: "fdr",
    axes: [
      { id: "left", unit: "deg", color: "#7dd3fc", symmetric: true, tickCount: 7 }
    ],
    series: [
      { field: "Ctrl Col Pos-L", label: "操纵杆", color: "#7dd3fc", yAxisId: "left" },
      { field: "Ctrl Whl Pos-L", label: "操纵盘", color: "#f5b248", yAxisId: "left" },
      { field: "Elevator-L", label: "升降舵", color: "#79d0d3", yAxisId: "left" },
      { field: "Aileron-R", label: "副翼", color: "#ef6f51", yAxisId: "left" }
    ]
  },
  {
    id: "chart-engines",
    title: "双发 N2",
    subtitle: "记录值与短时插值",
    className: "chart-panel",
    svgClassName: "chart-svg",
    timelineMode: "fdr",
    axes: [
      { id: "left", unit: "%", color: "#7dd3fc", includeZero: true, tickCount: 6 }
    ],
    series: [
      { field: "Eng1 N2 Actual", label: "发1 N2", color: "#7dd3fc", yAxisId: "left" },
      { field: "Eng2 N2 Actual", label: "发2 N2", color: "#f5b248", yAxisId: "left" }
    ]
  },
  {
    id: "chart-fuel",
    title: "双发燃油流量",
    subtitle: "末段燃油流量变化",
    className: "chart-panel",
    svgClassName: "chart-svg",
    timelineMode: "fdr",
    axes: [
      { id: "left", unit: "pph", color: "#79d0d3", includeZero: true, tickCount: 6 }
    ],
    series: [
      { field: "Eng1 Fuel Flow", label: "发1 FF", color: "#79d0d3", yAxisId: "left" },
      { field: "Eng2 Fuel Flow", label: "发2 FF", color: "#ef6f51", yAxisId: "left" }
    ]
  }
];

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function formatNumber(value, digits = 2, suffix = "") {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value.toFixed(digits)}${suffix}`;
}

export function formatTime(value) {
  return `T+${value.toFixed(2)}s`;
}

export function timeOrDash(value) {
  return value === null || value === undefined ? "—" : `T+${value.toFixed(2)}s`;
}

export function qualityText(quality) {
  switch (quality) {
    case "observed":
      return "原始观测";
    case "interpolated":
      return "插值";
    case "missing":
      return "缺失";
    case "placeholder":
      return "异常/占位";
    case "derived":
      return "派生";
    default:
      return "缺失";
  }
}

export function fieldAvailable(frame, field) {
  const quality = frame.quality?.[field];
  const value = frame.values?.[field];
  return value !== null && value !== undefined && quality !== "missing" && quality !== "placeholder";
}

export function frameAt(frames, time) {
  let left = 0;
  let right = frames.length - 1;
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (frames[mid].t < time) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }
  const hi = clamp(left, 0, frames.length - 1);
  const lo = clamp(hi - 1, 0, frames.length - 1);
  return Math.abs(frames[hi].t - time) < Math.abs(frames[lo].t - time) ? frames[hi] : frames[lo];
}

function canBlendValue(a, b, qa, qb) {
  return (
    a !== null &&
    a !== undefined &&
    b !== null &&
    b !== undefined &&
    !Number.isNaN(a) &&
    !Number.isNaN(b) &&
    qa !== "missing" &&
    qa !== "placeholder" &&
    qb !== "missing" &&
    qb !== "placeholder"
  );
}

export function displayFrameAt(frames, time) {
  let left = 0;
  let right = frames.length - 1;
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (frames[mid].t < time) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }

  const hi = clamp(left, 0, frames.length - 1);
  const lo = clamp(hi - 1, 0, frames.length - 1);
  const hiFrame = frames[hi];
  const loFrame = frames[lo];
  if (hi === lo || Math.abs(hiFrame.t - loFrame.t) < 1e-9) return hiFrame;
  if (time <= loFrame.t) return loFrame;
  if (time >= hiFrame.t) return hiFrame;

  const localT = clamp((time - loFrame.t) / (hiFrame.t - loFrame.t), 0, 1);
  const preferHi = localT >= 0.5;
  const refFrame = preferHi ? hiFrame : loFrame;
  const altFrame = preferHi ? loFrame : hiFrame;

  const values = {};
  const derived = {};
  const valueFields = new Set([...Object.keys(loFrame.values), ...Object.keys(hiFrame.values)]);
  valueFields.forEach((field) => {
    const a = loFrame.values[field];
    const b = hiFrame.values[field];
    const qa = loFrame.quality[field];
    const qb = hiFrame.quality[field];
    values[field] = canBlendValue(a, b, qa, qb) ? lerp(a, b, localT) : refFrame.values[field] ?? altFrame.values[field] ?? null;
  });

  const derivedFields = new Set([...Object.keys(loFrame.derived || {}), ...Object.keys(hiFrame.derived || {})]);
  derivedFields.forEach((field) => {
    const a = loFrame.derived[field];
    const b = hiFrame.derived[field];
    const qa = (loFrame.derivedQuality || {})[field];
    const qb = (hiFrame.derivedQuality || {})[field];
    derived[field] = canBlendValue(a, b, qa, qb) ? lerp(a, b, localT) : refFrame.derived[field] ?? altFrame.derived[field] ?? null;
  });

  return {
    ...refFrame,
    t: time,
    absTime:
      loFrame.absTime !== null && loFrame.absTime !== undefined && hiFrame.absTime !== null && hiFrame.absTime !== undefined
        ? lerp(loFrame.absTime, hiFrame.absTime, localT)
        : refFrame.absTime,
    absLabel: refFrame.absLabel,
    values,
    derived
  };
}

export function rangeFor(meta, field) {
  const range = meta.ranges?.[field];
  if (!range) return { min: -1, max: 1 };
  if (range.min === range.max) return { min: range.min - 1, max: range.max + 1 };
  return range;
}

export function normalized(meta, value, field) {
  const range = rangeFor(meta, field);
  return clamp((value - range.min) / (range.max - range.min), 0, 1);
}

export function baselineNormalized(meta, value, field) {
  if (value === null || value === undefined) return 0.5;
  const spec = meta.baseline?.[field];
  if (!spec) return normalized(meta, value, field);
  const center = spec.mean;
  const radius = Math.max(
    Math.abs((spec.max ?? center) - center),
    Math.abs((spec.min ?? center) - center),
    (spec.std ?? 0) * 4,
    0.25
  );
  return clamp(0.5 + (value - center) / (radius * 2), 0, 1);
}

export function physicalControlNormalized(meta, value, field) {
  if (value === null || value === undefined) return 0.5;
  const range = rangeFor(meta, field);
  const maxAbs = Math.max(Math.abs(range.min ?? 0), Math.abs(range.max ?? 0), 0.001);
  return clamp(0.5 + value / (maxAbs * 2), 0, 1);
}

export function buildCutoffDetail(currentTime, phaseTransitions, engineEvents) {
  const fdrEndTime = phaseTransitions.fdrEndTime ?? Number.POSITIVE_INFINITY;
  return currentTime > fdrEndTime
    ? `FDR 终止后无更新，最后已知切换 ${timeOrDash(engineEvents.bothCutoffTime)}`
    : `切换时刻 ${timeOrDash(engineEvents.bothCutoffTime)}`;
}

export function makePath(points, color, dashed) {
  const segments = [];
  let current = [];
  points.forEach((point) => {
    if (point) {
      current.push(point);
    } else if (current.length) {
      segments.push(current);
      current = [];
    }
  });
  if (current.length) segments.push(current);
  return segments
    .map((segment) => {
      const d = segment.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
      return `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" ${
        dashed ? 'stroke-dasharray="8 8"' : ""
      }></path>`;
    })
    .join("");
}
