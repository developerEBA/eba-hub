"use client";

import { useRef, useState } from "react";
import { DashboardIcon } from "../navigation";

const play = "m8 5 12 7-12 7z";
const pause = "M9 5v14m6-14v14";

function timeLabel(seconds: number) {
  const elapsed = Math.floor(seconds);
  return Math.floor(elapsed / 60) + ":" + String(elapsed % 60).padStart(2, "0");
}

export function VoiceNote({ src }: { src: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState(false);

  async function toggle() {
    const player = audio.current;
    if (!player) return;
    if (!player.paused) {
      player.pause();
      return;
    }
    setError(false);
    try {
      await player.play();
    } catch {
      setError(true);
    }
  }

  return (
    <div className="eba-connect__voice-player">
      <audio ref={audio} preload="none" src={src}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
        onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
        onDurationChange={(event) => {
          const length = event.currentTarget.duration;
          setDuration(Number.isFinite(length) ? length : 0);
        }}
        onError={() => setError(true)} />
      <button type="button" aria-label={playing ? "Pause voice note" : "Play voice note"} onClick={toggle}>
        <DashboardIcon path={playing ? pause : play} />
      </button>
      <div>
        {duration > 0 ? (
          <input type="range" aria-label="Voice note position" min={0} max={duration} step={0.1}
            value={Math.min(position, duration)} onChange={(event) => {
              if (audio.current) audio.current.currentTime = Number(event.target.value);
              setPosition(Number(event.target.value));
            }} />
        ) : <span className="eba-connect__voice-wave" aria-hidden="true" />}
        <small>{error ? "Playback unavailable" : position ? timeLabel(position) : duration ? timeLabel(duration) : "Voice note"}</small>
      </div>
    </div>
  );
}
