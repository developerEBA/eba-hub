"use client";

import { createContext, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { changeConnectMessage } from "./actions";
import { encodeMentions } from "./mentions";

type Edit = { id: number; text: string; mentions: Map<string, string>; onSave: () => void };
const EditingContext = createContext<{ edit: Edit | null; setEdit: (edit: Edit | null) => void } | null>(null);

export function ChatEditing({ children }: { children: ReactNode }) {
  const [edit, setEdit] = useState<Edit | null>(null);
  return <EditingContext.Provider value={{ edit, setEdit }}>{children}</EditingContext.Provider>;
}

export function useChatEditing() {
  const context = useContext(EditingContext);
  if (!context) throw new Error("Chat editing requires a conversation.");
  return context;
}

export function EditComposer({ edit, cancel }: { edit: Edit; cancel: () => void }) {
  const [draft, setDraft] = useState(edit.text);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const input = field.current;
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  }, []);

  function save() {
    if (pending || !draft.trim()) return;
    startTransition(async () => {
      try {
        const result = await changeConnectMessage(edit.id, "edit", encodeMentions(draft, edit.mentions));
        if (result) setError(result);
        else {
          edit.onSave();
          cancel();
        }
      } catch {
        setError("Could not save the edit. Try again.");
      }
    });
  }

  return (
    <form className="eba-connect__edit-composer" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <div className="eba-connect__draft-heading">
        <label htmlFor="connect-edit">Editing message</label>
        <button type="button" aria-label="Cancel edit" disabled={pending} onClick={cancel}>×</button>
      </div>
      <div className="eba-connect__record-bar">
        <textarea id="connect-edit" ref={field} rows={2} value={draft} maxLength={4000}
          readOnly={pending} onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !pending) cancel();
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }} />
        <button type="submit" className="eba-connect__voice-send" disabled={pending || !draft.trim()}>
          {pending ? "Saving…" : "✓ Save"}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
