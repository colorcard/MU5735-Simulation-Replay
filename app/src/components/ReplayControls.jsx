import { formatTime } from "../lib/replay.js";

export function ReplayControls({ replay }) {
  const { playing, speed, currentTime, currentFrame, duration, step } = replay;

  return (
    <section className="player-strip">
      <div className="player-row">
        <div className="player-actions">
          <button className="primary-btn" onClick={replay.togglePlay}>
            {playing ? "暂停" : "播放"}
          </button>
          <button className="ghost-btn" onClick={replay.back}>
            后退 1 帧
          </button>
          <button className="ghost-btn" onClick={replay.forward}>
            前进 1 帧
          </button>
          <button className="ghost-btn" onClick={replay.reset}>
            重置
          </button>
        </div>
        <div className="player-meta">
          <label htmlFor="speedSelect">倍速</label>
          <select id="speedSelect" value={speed} onChange={(event) => replay.setSpeed(Number(event.target.value))}>
            <option value="0.25">0.25×</option>
            <option value="0.5">0.5×</option>
            <option value="1">1×</option>
            <option value="2">2×</option>
            <option value="4">4×</option>
          </select>
          <span className="time-readout">{formatTime(currentTime)}</span>
          <span className="abs-readout">{currentFrame.absLabel || currentFrame.absTime?.toFixed(4)}</span>
        </div>
      </div>
      <input
        id="timelineSlider"
        className="timeline-slider"
        type="range"
        min="0"
        max={duration}
        step={step}
        value={currentTime}
        onInput={(event) => replay.setCurrentTime(Number(event.currentTarget.value))}
      />
    </section>
  );
}
