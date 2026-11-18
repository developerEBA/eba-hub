import Link from "next/link";
import { EbaWordmark } from "../../eba-wordmark";
import { ClientSignInForm } from "./client-sign-in-form";

export default function ClientSignIn() {
  return (
    <main className="eba-office eba-access">
      <section className="eba-access__panel" aria-labelledby="client-sign-in-title">
        <EbaWordmark />
        <h1 id="client-sign-in-title">Client Portal</h1>
        <ClientSignInForm />
        <div className="eba-access__links"><Link href="/">Back to home</Link></div>
      </section>
    </main>
  );
}
