"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { saveClient } from "./actions";
import { clientDirectoryPath, clientLimits, type ClientRecord } from "./directory";

const fields = [
  { key: "name", label: "Client or organization name", type: "text" },
  { key: "primary_contact", label: "Primary contact", type: "text" },
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone", type: "tel" },
] as const;

export function ClientForm({ record }: { record?: ClientRecord }) {
  const [draft, setDraft] = useState({
    name: record?.name ?? "",
    primary_contact: record?.primary_contact ?? "",
    email: record?.email ?? "",
    phone: record?.phone ?? "",
    notes: record?.notes ?? "",
  });
  const [error, action, pending] = useActionState(saveClient.bind(null, record?.id ?? null), null);
  const cancel = record ? clientDirectoryPath + "/" + record.id : clientDirectoryPath;

  return (
    <form className="eba-clients__form" action={action}>
      {fields.map(({ key, label, type }) => (
        <label key={key}>{label}{key === "name" ? " (required)" : ""}
          <input name={key} type={type} required={key === "name"} maxLength={clientLimits[key]}
            value={draft[key]} readOnly={pending}
            onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} />
        </label>
      ))}
      <label>Internal notes
        <textarea name="notes" rows={4} maxLength={clientLimits.notes} value={draft.notes}
          readOnly={pending} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />
      </label>
      {error && <p role="alert">{error}</p>}
      <div>
        <button className="eba-clients__primary" type="submit" disabled={pending}>{pending ? "Saving…" : "Save client"}</button>
        <Link href={cancel}>Cancel</Link>
      </div>
    </form>
  );
}
