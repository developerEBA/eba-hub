"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { mutateWorkspace } from "./actions";
export function PersistedCheckbox({
  id,
  checked,
  label,
  detail,
  kind,
}: {
  id: string;
  checked: boolean;
  label: string;
  detail?: string;
  kind: "task" | "focus";
}) {
  const [pending, startTransition] = useTransition(),
    [error, setError] = useState("");
  const router = useRouter();
  return (
    <div className="ref-persist-container">
      <label className="ref-persist-toggle">
        <input
          type="checkbox"
          checked={checked}
          disabled={pending}
          onChange={(e) => {
            const next = e.target.checked;
            setError("");
            startTransition(async () => {
              const form = new FormData();
              form.set("operation", `${kind}.toggle`);
              form.set("id", id);
              form.set("complete", String(next));
              try {
                const result = await mutateWorkspace(
                  { ok: false, message: "" },
                  form,
                );
                if (result.ok) router.refresh();
                else setError(result.message);
              } catch {
                setError("Not saved. Sign in and try again.");
              }
            });
          }}
        />
        <span>
          {label}
          {detail && <small>{detail}</small>}
        </span>
      </label>
      {pending && <small role="status">Saving…</small>}
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
