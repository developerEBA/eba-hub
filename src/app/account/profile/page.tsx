import { redirect } from "next/navigation";
import { connection } from "next/server";
import { signOutStaff } from "../../sign-in/actions";
import { accountActor } from "../../../lib/account-profile/server";
import { EbaWordmark } from "../../eba-wordmark";
import { AccountProfileForm } from "./profile-form";
import "./profile.css";

export const metadata = { title: "Your profile · EBA Hub", robots: { index: false, follow: false } };
export const instant = false;

export default async function AccountProfilePage() {
  await connection();
  const actor = await accountActor();
  if (!actor) redirect("/sign-in");
  return <main className="account-profile-page">
    <header><div className="account-profile-page__brand"><EbaWordmark/><span>ENI BRAND ARCHITECT</span></div><form action={signOutStaff}><button type="submit">Sign out</button></form></header>
    <section className="account-profile-page__intro"><p>ACCOUNT SETTINGS</p><h1>Your profile</h1><span>Profile access only · Employee and HOD dashboards are not released.</span></section>
    <AccountProfileForm/>
  </main>;
}
