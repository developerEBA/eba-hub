"use client";

import { useActionState, useState } from "react";
import { decideRequest } from "./actions";

const options = [
  ["approved", "Approve"],
  ["changes_requested", "Request changes"],
  ["rejected", "Reject"],
] as const;

export function ReviewActions({ id, canDecide }: { id: string; canDecide: boolean }) {
  const [decision, setDecision] = useState<(typeof options)[number][0] | null>(null);
  const [message, action, pending] = useActionState(decideRequest, null);

  return (
    <div className="eba-approvals__review">
      {message && <p role="status">{message}</p>}
      {canDecide && (decision ? (
        <form action={action} className="eba-approvals__confirmation">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="decision" value={decision} />
          <strong>{options.find(([key]) => key === decision)?.[1]} this request?</strong>
          {decision !== "approved" && (
            <label>
              {decision === "rejected" ? "Reason (optional)" : "What should the sender revise?"}
              <textarea name="note" maxLength={2000} required={decision === "changes_requested"} rows={3} />
            </label>
          )}
          <div className="eba-approvals__actions">
            <button type="submit" data-action={decision} disabled={pending}>{pending ? "Saving…" : "Confirm decision"}</button>
            <button type="button" onClick={() => setDecision(null)} disabled={pending}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="eba-approvals__actions">
          {options.map(([key, label]) => (
            <button type="button" key={key} data-action={key} onClick={() => setDecision(key)}>{label}</button>
          ))}
        </div>
      ))}
    </div>
  );
}
