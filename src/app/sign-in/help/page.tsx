import Link from "next/link";

export default function SignInHelp() {
  return (
    <main className="eba-office eba-access">
      <section className="eba-access__panel" aria-labelledby="sign-in-help-title">
        <h1 id="sign-in-help-title">Need help signing in?</h1>
        <p>Password reset is pending setup. If you forgot your password or need help accessing your account, contact the EBA Admin through your usual company channel.</p>
        <nav className="eba-access__links" aria-label="Sign-in help navigation">
          <Link href="/sign-in">Back to sign in</Link>
          <Link href="/">Back to home</Link>
        </nav>
      </section>
    </main>
  );
}
