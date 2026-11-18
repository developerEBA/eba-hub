"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { signInStaff } from "./actions";

export function StaffSignInForm() {
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [error, formAction, pending] = useActionState(signInStaff, null);

  return (
    <form
      className="eba-access__form"
      action={formAction}
    >
      <label htmlFor="staff-username">Username</label>
      <input
        id="staff-username"
        name="username"
        type="text"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        aria-describedby="staff-username-hint"
        required
      />
      <span id="staff-username-hint" className="eba-access__note">
        Enter the part before @enibrand.com.
      </span>

      <label htmlFor="staff-password">Password</label>
      <div className="eba-access__password">
        <input
          id="staff-password"
          name="password"
          type={passwordVisible ? "text" : "password"}
          autoComplete="current-password"
          required
        />
        <button
          type="button"
          aria-controls="staff-password"
          aria-label={passwordVisible ? "Hide password" : "Show password"}
          onClick={() => setPasswordVisible(!passwordVisible)}
        >
          {passwordVisible ? "Hide" : "Show"}
        </button>
      </div>

      <Link className="eba-access__forgot" href="/sign-in/help">Forgot password?</Link>
      <button className="eba-access__submit" type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
      {error && <p className="eba-access__note" role="alert">{error}</p>}
    </form>
  );
}
