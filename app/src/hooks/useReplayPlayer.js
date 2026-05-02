import { useEffect, useMemo, useRef, useState } from "react";
import { clamp, displayFrameAt, fieldAvailable, frameAt } from "../lib/replay.js";

export function useReplayPlayer(data) {
  const frames = data?.frames ?? [];
  const meta = data?.meta ?? null;
  const duration = meta?.duration ?? 0;
  const step = meta?.step ?? 0.05;
  const phaseTransitions = meta?.phaseTransitions ?? {};

  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const lastFrameTsRef = useRef(0);

  useEffect(() => {
    setCurrentTime(0);
    setPlaying(false);
    setSpeed(1);
    lastFrameTsRef.current = 0;
  }, [data]);

  useEffect(() => {
    let raf = 0;
    function tick(ts) {
      if (!lastFrameTsRef.current) lastFrameTsRef.current = ts;
      const dt = (ts - lastFrameTsRef.current) / 1000;
      lastFrameTsRef.current = ts;
      if (playing) {
        setCurrentTime((prev) => {
          const next = prev + dt * speed;
          if (next >= duration) {
            setPlaying(false);
            return duration;
          }
          return next;
        });
      }
      raf = window.requestAnimationFrame(tick);
    }
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [playing, speed, duration]);

  const qualityFrame = useMemo(() => (frames.length ? frameAt(frames, currentTime) : null), [frames, currentTime]);
  const currentFrame = useMemo(() => (frames.length ? displayFrameAt(frames, currentTime) : null), [frames, currentTime]);

  const inPureAds = useMemo(() => {
    const start = phaseTransitions.pureAdsStartTime;
    return start !== null && start !== undefined && currentTime >= start;
  }, [phaseTransitions, currentTime]);

  const fdrTimelineEnd = useMemo(() => {
    const end = phaseTransitions.pureAdsStartTime;
    return end !== null && end !== undefined ? end : duration;
  }, [phaseTransitions, duration]);

  const showAttitude = useMemo(
    () => !!qualityFrame && (fieldAvailable(qualityFrame, "Pitch Angle") || fieldAvailable(qualityFrame, "Roll Angle") || fieldAvailable(qualityFrame, "Roll Rate")),
    [qualityFrame]
  );
  const showControls = useMemo(
    () =>
      !!qualityFrame &&
      (fieldAvailable(qualityFrame, "Ctrl Col Pos-L") ||
        fieldAvailable(qualityFrame, "Ctrl Whl Pos-L") ||
        fieldAvailable(qualityFrame, "Elevator-L") ||
        fieldAvailable(qualityFrame, "Aileron-R")),
    [qualityFrame]
  );
  const showEngines = useMemo(
    () =>
      !!qualityFrame &&
      (fieldAvailable(qualityFrame, "Eng1 N2 Actual") ||
        fieldAvailable(qualityFrame, "Eng2 N2 Actual") ||
        fieldAvailable(qualityFrame, "Eng1 Fuel Flow") ||
        fieldAvailable(qualityFrame, "Eng2 Fuel Flow")),
    [qualityFrame]
  );

  if (!data || !qualityFrame || !currentFrame) return null;

  return {
    frames,
    meta,
    anchors: data.anchors,
    engineEvents: meta.engineEvents || {},
    phaseTransitions,
    duration,
    step,
    currentTime,
    currentFrame,
    qualityFrame,
    playing,
    speed,
    inPureAds,
    fdrTimelineEnd,
    showAttitude,
    showControls,
    showEngines,
    setCurrentTime: (value) => {
      setPlaying(false);
      setCurrentTime(clamp(value, 0, duration));
    },
    setSpeed,
    togglePlay: () => setPlaying((prev) => !prev),
    back: () => {
      setPlaying(false);
      setCurrentTime((prev) => clamp(prev - step, 0, duration));
    },
    forward: () => {
      setPlaying(false);
      setCurrentTime((prev) => clamp(prev + step, 0, duration));
    },
    reset: () => {
      setPlaying(false);
      setCurrentTime(0);
    }
  };
}
