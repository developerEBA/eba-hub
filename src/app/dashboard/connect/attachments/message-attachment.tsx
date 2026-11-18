"use client";

import Image from "next/image";
import { useRef } from "react";
import type { ConnectMessage } from "../model";
import { formatAttachmentSize } from "./config";
import { DashboardIcon } from "../../navigation";

export function MessageAttachment({ message }: { message: ConnectMessage }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const url = "/dashboard/connect/attachments/" + message.id;
  const filename = message.attachment_name ?? "Attachment";

  return (
    <div className="eba-connect__attachment-message">
      {message.kind === "photo" ? (
        <>
          <button type="button" className="eba-connect__photo" onClick={() => dialog.current?.showModal()}
            aria-label={`Enlarge ${filename}`}>
            <Image src={url} alt={filename} width={360} height={220} unoptimized />
          </button>
          <dialog ref={dialog} className="eba-connect__photo-dialog" aria-label={filename}>
            <form method="dialog"><button type="submit">Close preview</button></form>
            <Image src={url} alt={filename} width={900} height={560} unoptimized loading="lazy" />
          </dialog>
        </>
      ) : (
        <div className="eba-connect__document">
          <span className="eba-connect__document-icon"><DashboardIcon path="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6" /></span>
          <span><strong>{filename}</strong>
            {message.attachment_size !== null && <small>PDF · {formatAttachmentSize(message.attachment_size)}</small>}
          </span>
          <a href={url + "?download=1"}>Download</a>
        </div>
      )}
      {message.attachment_caption && <p>{message.attachment_caption}</p>}
    </div>
  );
}
