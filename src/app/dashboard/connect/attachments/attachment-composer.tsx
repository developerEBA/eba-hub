"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { DashboardIcon } from "../../navigation";
import { attachmentLimit, captionLimit, documentType, formatAttachmentSize, photoTypes } from "./config";

const paperclip = "m8 13 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9m-7 11 8-8";
const arrow = "m3 4 18 8-18 8 4-8-4-8zm4 8h14";

export function AttachmentComposer({ conversation, children }: { conversation: string; children: ReactNode }) {
  const router = useRouter();
  const [picker, setPicker] = useState(false);
  const [draft, setDraft] = useState<{ file: File; url: string | null; id: string } | null>(null);
  const [caption, setCaption] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const photos = useRef<HTMLInputElement>(null);
  const documents = useRef<HTMLInputElement>(null);
  const request = useRef<XMLHttpRequest | null>(null);

  useEffect(() => () => {
    const pending = request.current;
    request.current = null;
    pending?.abort();
  }, []);
  useEffect(() => {
    const url = draft?.url;
    if (url) return () => URL.revokeObjectURL(url);
  }, [draft]);

  function selectFile(event: ChangeEvent<HTMLInputElement>, types: string[]) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPicker(false);
    if (!types.includes(file.type) || !file.size || file.size > attachmentLimit) {
      setError("Choose a JPEG, PNG, WebP, or PDF up to 4 MB.");
      return;
    }
    setError(null);
    setCaption("");
    setDraft({ file, url: photoTypes.includes(file.type) ? URL.createObjectURL(file) : null, id: crypto.randomUUID() });
  }

  function send() {
    if (!draft || request.current) return;
    const form = new FormData();
    form.set("conversation", conversation);
    form.set("clientId", draft.id);
    form.set("file", draft.file);
    form.set("caption", caption);
    const xhr = new XMLHttpRequest();
    request.current = xhr;
    setProgress(0);
    setError(null);
    const finish = (message?: string) => {
      if (request.current !== xhr) return;
      request.current = null;
      setProgress(null);
      if (message) setError(message);
      else {
        setDraft(null);
        setCaption("");
        router.refresh();
      }
    };

    xhr.upload.onprogress = (event) => {
      if (request.current === xhr && event.lengthComputable) setProgress(Math.round(event.loaded / event.total * 100));
    };
    xhr.onload = () => {
      if (xhr.status === 204) finish();
      else finish(xhr.response?.message ?? "Attachment could not be sent. Try again.");
    };
    xhr.onerror = xhr.ontimeout = () => finish("Upload interrupted. Try again.");
    xhr.open("POST", "/dashboard/connect/attachments");
    xhr.responseType = "json";
    xhr.timeout = 60000;
    try {
      xhr.send(form);
    } catch {
      finish("Upload could not start. Try again.");
    }
  }

  return (
    <>
      <div className="eba-connect__compose-row" hidden={Boolean(draft)}>
        {children}
        <div className="eba-connect__picker">
          <button type="button" className="eba-connect__icon-button" aria-label="Attach a file"
            aria-expanded={picker} onClick={() => setPicker(!picker)}><DashboardIcon path={paperclip} /></button>
          {picker && (
            <div className="eba-connect__attachment-picker">
              <button type="button" onClick={() => photos.current?.click()}>Photos</button>
              <button type="button" onClick={() => documents.current?.click()}>Documents</button>
              <small>JPEG, PNG, WebP, or PDF · 4 MB max</small>
            </div>
          )}
          <input type="file" ref={photos} hidden accept={photoTypes.join(",")} onChange={(event) => selectFile(event, photoTypes)} />
          <input type="file" ref={documents} hidden accept={documentType} onChange={(event) => selectFile(event, [documentType])} />
        </div>
      </div>
      {draft && (
        <div className="eba-connect__attachment-draft">
          <div className="eba-connect__draft-heading">
            <strong>{draft.url ? "Photo preview" : "Document preview"}</strong>
            <button type="button" aria-label="Remove attachment" disabled={progress !== null}
              onClick={() => { setDraft(null); setCaption(""); setError(null); }}>×</button>
          </div>
          {draft.url && <Image src={draft.url} alt="Photo preview" width={320} height={180} unoptimized />}
          <p><strong>{draft.file.name}</strong> · {formatAttachmentSize(draft.file.size)}</p>
          <label>Caption (optional)
            <textarea rows={2} value={caption} maxLength={captionLimit} readOnly={progress !== null}
              onChange={(event) => setCaption(event.target.value)} />
          </label>
          {progress !== null && (
            <div role="status">
              <progress value={progress} max={100} aria-label="Attachment upload progress" />
              <span>{progress === 100 ? "Sending attachment…" : `Uploading… ${progress}%`}</span>
            </div>
          )}
          <div className="eba-connect__record-bar">
            <button type="button" disabled={progress !== null} onClick={() => { setDraft(null); setCaption(""); setError(null); }}>
              Remove
            </button>
            <button type="button" className="eba-connect__voice-send" disabled={progress !== null}
              aria-label={error ? "Retry attachment" : "Send attachment"} onClick={send}>
              {error ? "Retry" : <>Send <DashboardIcon path={arrow} /></>}
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
