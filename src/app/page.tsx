import type { Metadata } from "next";
import Link from "next/link";
import { EbaAnimatedText, EbaWordmark } from "./eba-wordmark";

export const metadata: Metadata = {
  title: "EBA Hub | Eni Brand Architect",
  description: "Your private workspace.",
};

export default function Home() {
  return (
    <main className="eba-home eba-office">
      <div className="eba-home__content">
        <EbaWordmark animated />
        <p className="eba-home__brand"><EbaAnimatedText text="ENI BRAND ARCHITECT" /></p>
        <p className="eba-home__tagline">Your private workspace.</p>

        <nav className="eba-home__nav" aria-label="Workspace access">
          <Link className="eba-home__sign-in" href="/sign-in">
            Sign in to EBA Hub
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12h15m-6-6 6 6-6 6" />
            </svg>
          </Link>
          <div className="eba-home__secondary">
            <Link href="/client/sign-in">Client Portal</Link>
          </div>
        </nav>
      </div>

      <footer className="eba-home__footer">
        <Link href="/sign-in/help">Need help signing in?</Link>
      </footer>
    </main>
  );
}
