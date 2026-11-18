"use client";

import { useState, useTransition } from "react";
import { changeConnectMessage } from "./actions";
import { mentionId, mentionParts } from "./mentions";
import { useChatEditing } from "./chat-editing";
import type { ConnectMessage, ConnectProfile } from "./model";

export function MessageActions({ message, profiles, onChange }: {
  message: ConnectMessage;
  profiles: Map<string, ConnectProfile>;
  onChange: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { setEdit } = useChatEditing();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function mentionNames() {
    const names = new Map<string, string>();
    for (const part of mentionParts(message.body)) {
      const id = mentionId(part);
      const profile = id ? profiles.get(id) : undefined;
      if (profile) names.set(profile.display_name, profile.user_id);
    }
    return names;
  }

  function edit() {
    const text = mentionParts(message.body).map((part) => {
      const id = mentionId(part);
      const name = id ? profiles.get(id)?.display_name : undefined;
      return name ? "@" + name : part;
    }).join("");
    setError(null);
    setEdit({ id: message.id, text, mentions: mentionNames(), onSave: onChange });
  }

  function save() {
    if (!confirmDelete || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await changeConnectMessage(message.id, "delete", "");
        setError(result);
        if (!result) {
          setConfirmDelete(false);
          onChange();
        }
      } catch {
        setError("Could not update this message. Try again.");
      }
    });
  }

  if (!confirmDelete) return (
    <details className="eba-connect__message-actions">
      <summary aria-label="Message options">···</summary>
      <div>
        {message.kind === "text" && <button type="button" onClick={edit}>Edit</button>}
        <button type="button" onClick={() => { setError(null); setConfirmDelete(true); }}>Delete</button>
      </div>
    </details>
  );

  return (
    <div className="eba-connect__edit">
      <p>Delete this message for everyone in the chat?</p>
      <div>
        <button type="button" disabled={pending} onClick={save}>
          {pending ? "Saving…" : "Delete for everyone"}
        </button>
        <button type="button" disabled={pending} onClick={() => setConfirmDelete(false)}>Cancel</button>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
