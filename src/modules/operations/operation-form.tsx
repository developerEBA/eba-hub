"use client";
import { useActionState } from "react";
import { mutateWorkspace } from "./actions";
export function OperationForm({
  operation,
  children,
  label = "Save",
  className = "",
  disabled = false,
}: {
  operation: string;
  children: React.ReactNode;
  label?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [state, action, pending] = useActionState(mutateWorkspace, {
    ok: false,
    message: "",
  });
  return (
    <form action={action} className={`op-form ${className}`}>
      <input type="hidden" name="operation" value={operation} />
      {children}
      <button type="submit" disabled={pending || disabled}>
        {pending ? "Saving…" : label}
      </button>
      {state.message && (
        <p
          role={state.ok ? "status" : "alert"}
          className={state.ok ? "op-success" : "op-error"}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
