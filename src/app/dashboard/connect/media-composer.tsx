"use client";

import { useEffect, useRef, useState, useTransition, type MouseEvent } from "react";
import { DashboardIcon } from "../navigation";
import { AttachmentComposer } from "./attachments/attachment-composer";
import { sendConnectMessage } from "./actions";
import { audioTypes, emojis, maxAudioBytes, stickers } from "./media";
import { ConnectComposer } from "./chat-controls";
import { EditComposer, useChatEditing } from "./chat-editing";
import type { ConnectProfile } from "./model";

const maxDuration = 30000;
const mic = "M9 6a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0zM5 11a7 7 0 0 0 14 0m-7 7v4m-3 0h6";
const stickerIcon = "M4 4h16v10l-6 6H4zM14 20v-6h6M8 9h.01M15 9h.01M8 13c1 2 3 2 4 0";
const trash = "M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 3v6m4-6v6";
const arrow = "m3 4 18 8-18 8 4-8-4-8zm4 8h14";

function durationLabel(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function MediaComposer({ conversation, members, canSend }: {
  conversation: string;
  members: ConnectProfile[];
  canSend: boolean;
}) {
  const [body, setBody] = useState("");
  const { edit, setEdit } = useChatEditing();
  const [recording, setRecording] = useState(false);
  const [asking, setAsking] = useState(false);
  const [clip, setClip] = useState<{ blob: Blob; url: string; id: string; seconds: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [emojiTab, setEmojiTab] = useState(false);
  const [failedSticker, setFailedSticker] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, startTransition] = useTransition();
  const recorder = useRef<MediaRecorder | null>(null);
  const tracks = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ticker = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const stickerRetry = useRef<{ key: string; id: string } | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
      clearInterval(ticker.current);
      if (recorder.current) recorder.current.onstop = null;
      tracks.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (clip) return () => URL.revokeObjectURL(clip.url);
  }, [clip]);

  function stopRecording() {
    clearTimeout(timer.current);
    clearInterval(ticker.current);
    if (recorder.current?.state === "recording") recorder.current.stop();
  }

  function discard() {
    if (recorder.current) recorder.current.onstop = null;
    stopRecording();
    tracks.current?.getTracks().forEach((track) => track.stop());
    setRecording(false);
    setClip(null);
    setError(null);
  }

  async function record() {
    setError(null);
    setFailedSticker(null);
    setPickerOpen(false);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Microphone recording is unavailable. Use a supported browser over HTTPS.");
      return;
    }
    const mimeType = audioTypes.find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) {
      setError("This browser does not support a compatible recording format.");
      return;
    }

    setAsking(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      tracks.current = stream;
      const active = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 48000 });
      recorder.current = active;
      const chunks: Blob[] = [];
      const started = performance.now();
      active.ondataavailable = (event) => chunks.push(event.data);
      active.onstop = () => {
        clearTimeout(timer.current);
        clearInterval(ticker.current);
        stream.getTracks().forEach((track) => track.stop());
        if (!mounted.current) return;
        setRecording(false);
        const blob = new Blob(chunks, { type: mimeType });
        if (!blob.size || blob.size > maxAudioBytes) {
          setError("The recording is empty or too large. Try a shorter voice note.");
          return;
        }
        setClip({ blob, url: URL.createObjectURL(blob), id: crypto.randomUUID(),
          seconds: Math.max(1, Math.round((performance.now() - started) / 1000)) });
      };
      active.onerror = () => {
        active.onstop = null;
        stream.getTracks().forEach((track) => track.stop());
        clearTimeout(timer.current);
        clearInterval(ticker.current);
        if (mounted.current) {
          setRecording(false);
          setError("Recording failed. Try again.");
        }
      };
      active.start();
      setElapsed(0);
      setRecording(true);
      ticker.current = setInterval(() => setElapsed(Math.floor((performance.now() - started) / 1000)), 250);
      timer.current = setTimeout(stopRecording, maxDuration);
    } catch {
      tracks.current?.getTracks().forEach((track) => track.stop());
      if (mounted.current) setError("Could not access the microphone. Check browser permissions and try again.");
    } finally {
      if (mounted.current) setAsking(false);
    }
  }

  function send(kind: "voice" | "sticker", sticker?: string) {
    if (inFlight.current) return;
    const form = new FormData();
    form.set("conversation", conversation);
    form.set("kind", kind);
    if (kind === "voice" && clip) {
      form.set("clientId", clip.id);
      form.set("audio", clip.blob, "voice-note");
    } else if (kind === "sticker" && sticker) {
      if (stickerRetry.current?.key !== sticker) stickerRetry.current = { key: sticker, id: crypto.randomUUID() };
      form.set("clientId", stickerRetry.current.id);
      form.set("body", sticker);
    } else return;

    inFlight.current = true;
    setPickerOpen(false);
    setFailedSticker(null);
    setError(null);
    startTransition(async () => {
      try {
        const result = await sendConnectMessage(null, form);
        setError(result);
        if (result && kind === "sticker" && sticker) setFailedSticker(sticker);
        if (!result && kind === "voice") setClip(null);
        if (!result && kind === "sticker") stickerRetry.current = null;
      } catch {
        setError("Message could not be sent. Try again.");
        if (kind === "sticker" && sticker) setFailedSticker(sticker);
      } finally {
        inFlight.current = false;
      }
    });
  }

  function sendSticker(event: MouseEvent<HTMLButtonElement>) {
    send("sticker", event.currentTarget.dataset.sticker);
  }

  if (!canSend && !edit) return null;

  return (
    <div className="eba-connect__compose-box" data-announcement-block={asking || recording || Boolean(clip) || sending || undefined}>
      {edit && <EditComposer key={edit.id} edit={edit} cancel={() => setEdit(null)} />}
      <div hidden={Boolean(edit) || !canSend}>
        <div hidden={recording || Boolean(clip)}>
          <AttachmentComposer conversation={conversation}>
            <div className="eba-connect__text-slot">
              <ConnectComposer conversation={conversation} body={body} setBody={setBody} members={members} />
            </div>
            <button type="button" className="eba-connect__icon-button" aria-label="Record voice note"
              disabled={asking || sending} onClick={record}><DashboardIcon path={mic} /></button>
            <div className="eba-connect__picker">
              <button type="button" className="eba-connect__icon-button" aria-label="Stickers"
                aria-expanded={pickerOpen} disabled={sending || asking} onClick={() => setPickerOpen(!pickerOpen)}>
                <DashboardIcon path={stickerIcon} />
              </button>
              {pickerOpen && (
                <div className="eba-connect__reactions" aria-label="Stickers and emojis">
                  <div className="eba-connect__reaction-tabs">
                    <button type="button" aria-pressed={!emojiTab} onClick={() => setEmojiTab(false)}>Stickers</button>
                    <button type="button" aria-pressed={emojiTab} onClick={() => setEmojiTab(true)}>Emoji</button>
                  </div>
                  <div className="eba-connect__reaction-grid">
                    {emojiTab ? emojis.map((emoji) => (
                      <button type="button" key={emoji} onClick={() => {
                        setBody((value) => value.length + emoji.length <= 4000 ? value + emoji : value);
                        setPickerOpen(false);
                      }}>{emoji}</button>
                    )) : Object.entries(stickers).map(([key, sticker]) => (
                      <button type="button" key={key} aria-label={sticker.label} data-sticker={key} onClick={sendSticker}>
                        {sticker.glyph}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </AttachmentComposer>
        </div>
        {recording ? (
          <div className="eba-connect__record-bar">
            <span className="eba-connect__record-indicator">Recording <time>{durationLabel(elapsed)}</time></span>
            <button type="button" onClick={stopRecording}>Stop</button>
            <button type="button" onClick={discard}>Discard</button>
          </div>
        ) : clip ? (
          <div className="eba-connect__record-bar">
            <audio controls src={clip.url} aria-label="Voice note preview" />
            <time>{durationLabel(clip.seconds)}</time>
            <button type="button" className="eba-connect__icon-button" aria-label="Discard voice note"
              disabled={sending} onClick={discard}><DashboardIcon path={trash} /></button>
            <button type="button" className="eba-connect__voice-send" aria-label={error ? "Retry voice note" : "Send voice note"}
              disabled={sending} onClick={() => send("voice")}>
              {sending ? "Sending…" : error ? "Retry" : <DashboardIcon path={arrow} />}
            </button>
          </div>
        ) : null}
        {asking && <p role="status">Requesting microphone access…</p>}
        {sending && !clip && <p role="status">Sending sticker…</p>}
        {error && <p role="alert">{error}</p>}
        {failedSticker && <button type="button" onClick={() => send("sticker", failedSticker)}>Retry sticker</button>}
      </div>
    </div>
  );
}
