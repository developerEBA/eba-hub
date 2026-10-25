"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { registerUploadedFile, getFileLink } from "./files-actions";
import { OperationForm } from "./operation-form";
import type { FileRecord } from "./types";
export async function uploadWorkspaceFile(file: File, conversationId?: string) {
  if (!file.size || file.size > 4194304)
    throw new Error("Choose a file between 1 byte and 4 MB.");
  const db = createClient();
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) throw new Error("Sign in before uploading.");
  const path = `${data.user.id}/${crypto.randomUUID()}`;
  const mime = file.type.split(";")[0];
  const { error: uploadError } = await db.storage
    .from("workspace-files")
    .upload(path, file, { contentType: mime, upsert: false });
  if (uploadError)
    throw new Error(
      "Upload failed. Check file type, bucket configuration and membership.",
    );
  const registered = await registerUploadedFile({
    path,
    name: file.name.slice(0, 180),
    conversationId,
  });
  if (!registered.ok) {
    await db.storage.from("workspace-files").remove([path]);
    throw new Error(registered.message);
  }
  return registered.id;
}
export function FileUpload({ conversationId }: { conversationId?: string }) {
  const [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState(""),
    [id, setId] = useState("");
  return (
    <section className="op-card">
      <h3>Upload a private file</h3>
      <p>
        Approved images, PDFs, text or audio; up to 4 MB. Conversation
        attachments are shared only with current conversation members.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!file) return;
          setBusy(true);
          setId("");
          try {
            const saved = await uploadWorkspaceFile(file, conversationId);
            setId(saved);
            setStatus("Uploaded and recorded in Storage and PostgreSQL.");
          } catch (error) {
            setStatus(
              error instanceof Error ? error.message : "Upload failed.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <input
          aria-label="Choose file"
          type="file"
          required
          accept="image/png,image/jpeg,image/webp,application/pdf,text/plain,audio/webm,audio/ogg,audio/mp4"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setId("");
          }}
        />
        <button disabled={busy || !file}>
          {busy ? "Uploading…" : "Upload file"}
        </button>
      </form>
      <p role="status">{status}</p>
      {id && conversationId && (
        <OperationForm operation="message.send" label="Send uploaded file">
          <input type="hidden" name="conversation_id" value={conversationId} />
          <input type="hidden" name="attachment_id" value={id} />
          <input type="hidden" name="kind" value="file" />
          <input type="hidden" name="body" value={file?.name ?? "Attachment"} />
        </OperationForm>
      )}
    </section>
  );
}
export function FileDownload({
  file,
  audio = false,
}: {
  file: Pick<FileRecord, "id" | "name">;
  audio?: boolean;
}) {
  const [url, setUrl] = useState(""),
    [message, setMessage] = useState(""),
    [pending, setPending] = useState(false);
  return (
    <div>
      <button
        disabled={pending}
        onClick={async () => {
          setPending(true);
          try {
            const result = await getFileLink(file.id, audio);
            if (result.ok) {
              setUrl(result.url);
              setMessage("Private link ready; expires in 60 seconds.");
            } else setMessage(result.message);
          } catch {
            setMessage("File is unavailable. Sign in and try again.");
          } finally {
            setPending(false);
          }
        }}
      >
        {pending
          ? "Authorizing…"
          : audio
            ? "Load voice note"
            : "Get download link"}
      </button>
      {url && audio && (
        <audio controls src={url} aria-label="Voice note playback" />
      )}
      {url && !audio && (
        <a href={url} target="_blank" rel="noopener noreferrer">
          Download {file.name}
        </a>
      )}
      <p role="status">{message}</p>
    </div>
  );
}
