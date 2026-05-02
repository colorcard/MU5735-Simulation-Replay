import { formatTime, timeOrDash } from "../lib/replay.js";

function TrackAnchor({ anchor, index, duration, active, onJump }) {
  return (
    <button
      className={`track-anchor${active ? " active" : ""}`}
      data-time={anchor.t}
      style={{ left: `${(anchor.t / duration) * 100}%`, top: `${index % 2 === 0 ? 4 : 26}px` }}
      title={`${anchor.title} ${timeOrDash(anchor.t)}\n${anchor.detail}`}
      onClick={() => onJump(anchor.t)}
    >
      <span>{anchor.title}</span>
    </button>
  );
}

export function TimelineTrack({ meta, anchors, replay }) {
  const { duration, currentTime, phaseTransitions } = replay;
  const orderedAnchors = [...anchors].sort((a, b) => a.t - b.t);

  return (
    <div className="timeline-inline">
      <div className="quality-track">
        {meta.placeholderIntervals.map((interval) => (
          <div
            key={`placeholder-${interval.start}-${interval.end}`}
            className="quality-segment placeholder-band"
            style={{
              left: `${(interval.start / duration) * 100}%`,
              width: `${((interval.end - interval.start) / duration) * 100}%`
            }}
            title={`伪影/占位 ${timeOrDash(interval.start)} - ${timeOrDash(interval.end)}`}
          >
            {interval.end - interval.start >= 0.6 ? <span className="quality-band-label">残影/占位区</span> : null}
          </div>
        ))}

        {phaseTransitions.pureAdsStartTime !== null && phaseTransitions.pureAdsStartTime !== undefined ? (
          <>
            <div
              className="quality-segment pure-ads-band"
              style={{
                left: `${(phaseTransitions.pureAdsStartTime / duration) * 100}%`,
                width: `${((duration - phaseTransitions.pureAdsStartTime) / duration) * 100}%`
              }}
              title={`纯 ADS 段 ${timeOrDash(phaseTransitions.pureAdsStartTime)} - ${timeOrDash(duration)}`}
            >
              <span className="quality-band-label">纯 ADS 段</span>
            </div>
            <div className="quality-boundary" style={{ left: `${(phaseTransitions.pureAdsStartTime / duration) * 100}%` }}>
              <span>FDR 终止</span>
            </div>
          </>
        ) : null}

        {orderedAnchors.map((anchor, index) => (
          <TrackAnchor
            key={anchor.id}
            anchor={anchor}
            index={index}
            duration={duration}
            active={Math.abs(anchor.t - currentTime) < 0.45}
            onJump={replay.setCurrentTime}
          />
        ))}

        <div className="quality-marker" style={{ left: `${(currentTime / duration) * 100}%` }} />
      </div>

      <div className="timeline-inline-head">
        <strong>事故时间轴</strong>
        <span>关键节点已直接嵌入主时间轴，下方继续保留完整说明与跳转入口</span>
      </div>
      <div className="anchor-row anchor-row-inline">
        {orderedAnchors.map((anchor) => (
          <button
            key={anchor.id}
            className={`anchor-item${Math.abs(anchor.t - currentTime) < 0.45 ? " active" : ""}`}
            data-time={anchor.t}
            onClick={() => replay.setCurrentTime(anchor.t)}
          >
            <span className="anchor-time">{formatTime(anchor.t)}</span>
            <strong>{anchor.title}</strong>
            <p>{anchor.detail}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
