import type { Metadata } from "next";
import Link from "next/link";
import { StaffSignInForm } from "./staff-sign-in-form";
import { EbaWordmark } from "../eba-wordmark";

export const metadata: Metadata = {
  title: "Sign in | EBA Hub",
};

export default function StaffSignIn() {
  return (
    <main className="eba-office eba-access">
      <section className="eba-access__panel eba-access__panel--staff" aria-labelledby="staff-sign-in-title">
        <EbaWordmark />
        <h1 id="staff-sign-in-title">Sign in to EBA Hub</h1>
        <StaffSignInForm />

        <nav className="eba-access__links" aria-label="Staff sign-in navigation">
          <Link href="/">Back to home</Link>
        </nav>
        <div className="eba-access__client">
          <Link href="/client/sign-in">Client Portal</Link>
        </div>
      </section>
    </main>
  );
}
