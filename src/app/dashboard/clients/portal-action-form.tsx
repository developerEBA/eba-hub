"use client";

import { useActionState, useState, type ReactNode } from "react";
import { managePortal } from "./portal-actions";
import { portalFileLimit } from "./portal-config";

export function PortalActionForm({ clientId, operation, label, children }: {
  clientId: string;
  operation: string;
  label: string;
  children: ReactNode;
}) {
  const [state, action, pending] = useActionState(managePortal.bind(null, clientId, operation), null);
  const [clipboard, setClipboard] = useState("");
  const [fileError, setFileError] = useState("");

  async function copy() {
    if (!state?.invitation) return;
    const link = window.location.origin + "/client/sign-in#invite=" + state.invitation;
    try {
      await navigator.clipboard.writeText(link);
      setClipboard("Invitation link copied.");
    } catch {
      setClipboard("Copy this link manually: " + link);
    }
  }

  return (
    <form className="eba-client-management__form" action={action} onSubmit={(event) => {
      setFileError("");
      if (operation !== "file_shared") return;
      const file = new FormData(event.currentTarget).get("file");
      if (file instanceof File && file.size > portalFileLimit) {
        event.preventDefault();
        setFileError("Choose a file up to 750 KB.");
      }
    }}>
      {children}
      <button className="eba-clients__primary" type="submit" disabled={pending}>{pending ? "Saving…" : label}</button>
      {fileError && <p role="alert">{fileError}</p>}
      {state && <p role="status">{state.message}</p>}
      {state?.invitation && (
        <button type="button" onClick={copy}>Copy invitation link</button>
      )}
      {clipboard && <p role="status">{clipboard}</p>}
    </form>
  );
}
