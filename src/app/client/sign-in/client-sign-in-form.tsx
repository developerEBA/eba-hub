"use client";

import { useActionState, useEffect, useRef } from "react";
import { signInClient } from "./actions";

export function ClientSignInForm() {
  const invitation = useRef("");
  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    if (fragment.has("invite")) {
      invitation.current = fragment.get("invite") ?? "";
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    }
  }, []);

  const [error, action, pending] = useActionState(async (previous: string | null, form: FormData) => {
    if (invitation.current) form.set("invite", invitation.current);
    return signInClient(previous, form);
  }, null);

  return (
    <form className="eba-access__form" action={action}>
      <label htmlFor="client-email">Invited email</label>
      <input id="client-email" name="email" type="email" autoComplete="username" required maxLength={254} />
      <label htmlFor="client-password">Password</label>
      <input id="client-password" name="password" type="password" autoComplete="current-password" required />
      {error && <p role="alert">{error}</p>}
      <button className="eba-access__submit" type="submit" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
