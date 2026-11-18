"use client";

import { useActionState, useRef } from "react";
import { deleteClient, retryClientFileCleanup } from "./actions";

export function DeleteClientForm({ id, name }: { id: string; name: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, action, pending] = useActionState(deleteClient.bind(null, id), null);

  return (
    <>
      <details className="eba-client-workspace__actions-menu">
        <summary className="eba-client-workspace__edit">Actions</summary>
        <button type="button" onClick={() => dialog.current?.showModal()}>Delete Client</button>
      </details>
      <dialog ref={dialog} className="eba-client-workspace__delete-dialog"
        aria-labelledby="delete-client-title" aria-describedby="delete-client-description"
        onCancel={(event) => { if (pending) event.preventDefault(); }}>
        <form action={action}>
          <input type="hidden" name="confirm" value="yes" />
          <h3 id="delete-client-title">Delete {name}?</h3>
          <p id="delete-client-description">
            This permanently removes the client record and its messages, ends portal access, and invalidates outstanding invitations and shared links.
          </p>
          {error && <p role="alert">{error}</p>}
          <div className="eba-client-workspace__delete-buttons">
            <button type="button" autoFocus disabled={pending} onClick={() => dialog.current?.close()}>Cancel</button>
            <button type="submit" disabled={pending}>{pending ? "Deleting…" : "Delete Client"}</button>
          </div>
        </form>
      </dialog>
    </>
  );
}

export function ClientFileCleanupForm() {
  const [message, action, pending] = useActionState(retryClientFileCleanup, null);
  return (
    <form action={action} className="eba-client-workspace__cleanup">
      <p>Files from deleted clients are pending cleanup.</p>
      <button type="submit" className="eba-client-workspace__edit" disabled={pending}>
        {pending ? "Cleaning up…" : "Retry file cleanup"}
      </button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
