import { Card } from "@/components/ui/card";
import { signInWithGoogle, signOut } from "@/modules/auth/actions";
import { getSupabaseConfig } from "@/lib/supabase/config";
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const configured = !!getSupabaseConfig() && !!process.env.APP_URL;
  const error = (await searchParams).error;
  const messages: Record<string, string> = {
    setup: "Configure Supabase and APP_URL first.",
    provider:
      "Google sign-in did not complete. Check provider configuration and try again.",
    membership:
      "Your account has no approved employee profile. Contact an administrator.",
    signout: "Sign-out failed. Your session may still be active; try again.",
  };
  return (
    <main className="grid min-h-screen place-items-center bg-primary p-6">
      <Card className="w-full max-w-md p-9">
        <p className="eyebrow">ENI BRAND ARCHITECT</p>
        <h1 className="page-title">Sign in to EBA Hub</h1>
        <p className="my-5 text-sm text-muted-foreground">
          Access is limited to approved employees. Signing in does not create an
          employee profile or grant a role.
        </p>
        {error && (
          <p
            className="mb-5 rounded border border-border p-3 text-sm"
            role="alert"
          >
            {messages[error] ?? "Sign-in could not be completed."}
          </p>
        )}
        {configured ? (
          <form action={signInWithGoogle}>
            <button className="rounded-lg bg-primary px-5 py-3 text-primary-foreground">
              Continue with Google
            </button>
          </form>
        ) : (
          <p className="rounded-lg bg-muted p-4" role="status">
            Setup required: configure Supabase, APP_URL and the approved Google
            OAuth provider.
          </p>
        )}
        <form action={signOut} className="mt-5">
          <button className="text-sm underline">
            Sign out of any existing session
          </button>
        </form>
      </Card>
    </main>
  );
}
