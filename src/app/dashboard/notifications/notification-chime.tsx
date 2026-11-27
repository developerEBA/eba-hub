"use client";
import { useEffect } from "react";
let context: AudioContext | null = null;

export function playNotificationTone(audio: AudioContext) {
  [659.25, 880, 659.25, 1046.5].forEach((frequency, index) => {
    const oscillator = audio.createOscillator(),
      gain = audio.createGain(),
      at = audio.currentTime + index * 0.16;
    oscillator.type = "triangle";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.48, at + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.48);
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start(at);
    oscillator.stop(at + 0.5);
  });
}
export function NotificationChime({ latestUnreadId }: { latestUnreadId?: number }) {
  useEffect(() => {
    const unlock = () => {
      try {
        context ??= new AudioContext();
        void context.resume().catch(() => undefined);
      } catch {
        context = null;
      }
    };
    document.addEventListener("pointerdown", unlock);
    document.addEventListener("keydown", unlock);
    return () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
    };
  }, []);
  useEffect(() => {
    if (latestUnreadId === undefined) return;
    try {
      const key = "eba-notification-last-sound",
        previous = sessionStorage.getItem(key);
      const prior = Number(previous ?? latestUnreadId);
      if (latestUnreadId > prior || previous === null)
        sessionStorage.setItem(key, String(latestUnreadId));

      if (previous !== null && latestUnreadId > prior) {
        if (context?.state === "running") playNotificationTone(context);
        if ("vibrate" in navigator) navigator.vibrate([220, 100, 220]);
      }
    } catch {
      return;
    }
  }, [latestUnreadId]);
  return null;
}
