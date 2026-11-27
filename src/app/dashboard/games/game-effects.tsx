"use client";

import { useEffect, useRef, useState } from "react";
import type { RoomView } from "./catalog";

function note(
  context: AudioContext,
  frequency: number,
  at: number,
  duration: number,
  volume = 0.035,
) {
  const oscillator = context.createOscillator(),
    gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(volume, at + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(at);
  oscillator.stop(at + duration + 0.05);
  oscillator.onended = () => {
    oscillator.disconnect();
    gain.disconnect();
  };
}

export function GameEffects({ view }: { view: RoomView }) {
  const [muted, setMuted] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const celebrated = useRef<string | null>(null);
  const result = view.room.result;
  const winner = view.players.find((player) => player.seat === result?.winner);
  const outcome = result ? `${view.room.round}:${result.winner ?? "draw"}` : null;

  useEffect(() => {
    let step = 0;
    const melody = [261.63, 329.63, 392, 440, 392, 329.63, 293.66, 329.63];
    const play = () => {
      const context = audio.current;
      if (muted || document.hidden || context?.state !== "running" || view.room.status !== "active")
        return;
      const at = context.currentTime;
      note(context, melody[step++ % melody.length], at, 1.6);
      note(context, 130.81, at, 1.8, 0.012);
    };
    const unlock = () => {
      if (muted || document.hidden) return;
      try {
        audio.current ??= new AudioContext();
        void audio.current
          .resume()
          .then(play)
          .catch(() => undefined);
      } catch {
        audio.current = null;
      }
    };
    const visibility = () => {
      if (document.hidden) void audio.current?.suspend();
      else if (!muted) void audio.current?.resume().catch(() => undefined);
    };
    document.addEventListener("pointerdown", unlock, { once: true });
    document.addEventListener("keydown", unlock, { once: true });
    document.addEventListener("visibilitychange", visibility);
    if (muted) void audio.current?.suspend();
    else if (audio.current)
      void audio.current
        .resume()
        .then(play)
        .catch(() => undefined);
    const timer = window.setInterval(play, 1800);
    return () => {
      clearInterval(timer);
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [muted, view.room.status]);

  useEffect(
    () => () => {
      void audio.current?.close();
      audio.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!outcome || celebrated.current === outcome) return;
    celebrated.current = outcome;
    const context = audio.current;
    if (!muted && result?.winner !== undefined && context?.state === "running") {
      [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) =>
        note(context, frequency, context.currentTime + index * 0.16, 1.3, 0.09),
      );
    }
  }, [outcome, muted, result?.winner]);

  return (
    <>
      <button
        type="button"
        className="lounge-music"
        aria-pressed={!muted}
        onClick={() => setMuted((value) => !value)}
      >
        {muted ? "♫ Sound off" : "♫ Sound on"}
      </button>
      {outcome && (
        <div key={outcome} className="lounge-celebration" role="status" aria-live="polite">
          <span className="lounge-celebration__spark" aria-hidden="true">
            ✦
          </span>
          <strong>
            {result?.winner === undefined
              ? "A perfect match"
              : winner?.user_id === view.self
                ? "You win!"
                : `${winner?.display_name ?? "Your opponent"} wins!`}
          </strong>
          <span>
            {result?.winner === undefined
              ? "It’s a draw. One more round?"
              : "Three cheers for a beautiful game."}
          </span>
        </div>
      )}
    </>
  );
}
