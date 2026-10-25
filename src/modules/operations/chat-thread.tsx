"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { OperationForm } from "./operation-form";
import { FileUpload, FileDownload, uploadWorkspaceFile } from "./files-ui";
import { mutateWorkspace } from "./actions";
import type { Conversation, Message, Employee } from "./types";
export function ChatThread({
  conversation,
  messages,
  employees,
  userId,
}: {
  conversation: Conversation;
  messages: Message[];
  employees: Employee[];
  userId: string;
}) {
  const router = useRouter();
  const [connection, setConnection] = useState("Connecting to Realtime…");
  useEffect(() => {
    const db = createClient();
    const channel = db
      .channel(`conversation:${conversation.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversation.id}`,
        },
        () => router.refresh(),
      )
      .subscribe((status) =>
        setConnection(
          status === "SUBSCRIBED"
            ? "Realtime connected."
            : status === "CHANNEL_ERROR" || status === "TIMED_OUT"
              ? "Realtime unavailable. Use Refresh messages."
              : "Connecting to Realtime…",
        ),
      );
    return () => {
      void db.removeChannel(channel);
    };
  }, [conversation.id, router]);
  return (
    <section className="op-card">
      <h2>{conversation.title}</h2>
      <p role="status">{connection}</p>
      <button onClick={() => router.refresh()}>Refresh messages</button>
      <OperationForm
        operation="conversation.read"
        label="Mark conversation read"
      >
        <input type="hidden" name="id" value={conversation.id} />
      </OperationForm>
      <ol className="op-messages">
        {messages.map((message) => (
          <li
            key={message.id}
            className={message.sender_id === userId ? "own" : ""}
          >
            <strong>
              {employees.find((e) => e.id === message.sender_id)
                ?.display_name ?? "Employee"}
            </strong>
            <p>{message.body}</p>
            <small>
              {new Date(message.created_at).toLocaleString("en-GB", {
                timeZone: "Africa/Lagos",
              })}{" "}
              WAT
            </small>
            {message.attachment_id && (
              <FileDownload
                audio={message.kind === "voice"}
                file={{
                  id: message.attachment_id,
                  name: message.kind === "voice" ? "Voice note" : message.body,
                }}
              />
            )}
          </li>
        ))}
      </ol>
      {!messages.length && (
        <p>
          No messages yet. Messages appear only after a successful database
          insert.
        </p>
      )}
      <OperationForm operation="message.send" label="Send message">
        <input type="hidden" name="conversation_id" value={conversation.id} />
        <input type="hidden" name="kind" value="text" />
        <label>
          Message
          <textarea name="body" required maxLength={10000} />
        </label>
      </OperationForm>
      <div className="op-tabs">
        {["👍", "🎉", "💚", "👏"].map((emoji) => (
          <OperationForm key={emoji} operation="message.send" label={emoji}>
            <input
              type="hidden"
              name="conversation_id"
              value={conversation.id}
            />
            <input type="hidden" name="body" value={emoji} />
            <input type="hidden" name="kind" value="sticker" />
          </OperationForm>
        ))}
      </div>
      <details>
        <summary>Attachments</summary>
        <FileUpload conversationId={conversation.id} />
      </details>
      <VoiceRecorder conversationId={conversation.id} />
      <p className="op-note">
        Latest 100 persisted messages. Emoji stickers are persisted messages; an
        uploaded custom sticker library is not implemented.
      </p>
    </section>
  );
}
function VoiceRecorder({ conversationId }: { conversationId: string }) {
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    chunks = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false),
    [status, setStatus] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  useEffect(
    () => () => {
      if (recorder.current?.state === "recording") {
        recorder.current.onstop = null;
        recorder.current.stop();
      }
      stream.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );
  return (
    <div className="op-card">
      <h3>Voice note</h3>
      <button
        disabled={pending}
        onClick={async () => {
          if (recording) {
            recorder.current?.stop();
            setRecording(false);
            return;
          }
          try {
            if (!navigator.mediaDevices || !window.MediaRecorder) {
              setStatus(
                "Voice recording requires a supported browser and HTTPS or localhost.",
              );
              return;
            }
            stream.current = await navigator.mediaDevices.getUserMedia({
              audio: true,
            });
            const mime = ["audio/webm", "audio/ogg", "audio/mp4"].find((type) =>
              MediaRecorder.isTypeSupported(type),
            );
            if (!mime) {
              stream.current.getTracks().forEach((track) => track.stop());
              setStatus("No supported audio format available.");
              return;
            }
            const media = new MediaRecorder(stream.current, { mimeType: mime });
            recorder.current = media;
            chunks.current = [];
            let bytes = 0;
            media.ondataavailable = (e) => {
              chunks.current.push(e.data);
              bytes += e.data.size;
              if (bytes > 3500000 && media.state === "recording") {
                media.stop();
                setRecording(false);
              }
            };
            media.onstop = () => {
              stream.current?.getTracks().forEach((track) => track.stop());
              startTransition(async () => {
                try {
                  setStatus("Uploading voice note…");
                  const file = new File(chunks.current, "voice-note.webm", {
                    type: mime,
                  });
                  const id = await uploadWorkspaceFile(file, conversationId);
                  const form = new FormData();
                  for (const [key, value] of Object.entries({
                    operation: "message.send",
                    conversation_id: conversationId,
                    body: "Voice note",
                    kind: "voice",
                    attachment_id: id,
                  }))
                    form.set(key, value);
                  const result = await mutateWorkspace(
                    { ok: false, message: "" },
                    form,
                  );
                  setStatus(
                    result.ok
                      ? "Voice note stored and sent."
                      : `Audio uploaded, but message not sent: ${result.message}`,
                  );
                  if (result.ok) router.refresh();
                } catch (error) {
                  setStatus(
                    error instanceof Error
                      ? error.message
                      : "Voice note failed.",
                  );
                }
              });
            };
            media.start(1000);
            setRecording(true);
            setStatus("Recording. Stop to upload and send.");
          } catch {
            stream.current?.getTracks().forEach((track) => track.stop());
            setStatus("Microphone access failed. No voice note was sent.");
          }
        }}
      >
        {recording
          ? "Stop and send recording"
          : pending
            ? "Sending…"
            : "Record voice note"}
      </button>
      <p role="status">{status}</p>
    </div>
  );
}
