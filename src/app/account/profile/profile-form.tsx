"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from "react";

type Profile = { name: string; email: string; avatar: string | null; role: string };

export function AccountProfileForm() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [uploading, setUploading] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/account/profile/api", { cache: "no-store" }), body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Your profile could not be loaded.");
      setProfile(body);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Your profile could not be loaded."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!profile || saving) return;
    setSaving(true); setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/account/profile/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.get("name"), email: form.get("email") }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Profile could not be saved.");
      setProfile({ ...profile, name: body.name, email: body.email }); setNotice(body.message); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Profile could not be saved. Retry."); }
    finally { setSaving(false); }
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget, file = input.files?.[0]; if (!file || uploading) return;
    setUploading(true); setError(""); setNotice("");
    try {
      const form = new FormData(); form.set("photo", file);
      const response = await fetch("/account/profile/photo", { method: "POST", body: form });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Photo could not be saved.");
      setProfile((current) => current ? { ...current, avatar: body.avatar } : current); setNotice(body.message); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Photo could not be saved. Retry."); }
    finally { setUploading(false); input.value = ""; }
  }

  return <section className="account-profile" aria-labelledby="account-profile-title">
    <header><div><p className="account-profile__eyebrow">Your account</p><h2 id="account-profile-title">Profile</h2><p>Keep your name and photo up to date for your colleagues.</p></div>{profile && <span>{profile.role}</span>}</header>
    {loading ? <p role="status">Loading your profile…</p> : error && !profile ? <div role="alert"><p>{error}</p><button type="button" onClick={() => void load()}>Retry</button></div> : profile && <>
      {notice && <p className="account-profile__notice" role="status">{notice}</p>}{error && <p className="account-profile__error" role="alert">{error}</p>}
      <div className="account-profile__photo"><span>{profile.avatar ? <Image src={profile.avatar} alt="Your profile photo" width={80} height={80} unoptimized/> : profile.name.split(/\s+/).map((part) => part[0]).slice(0,2).join("").toUpperCase() || "?"}</span><label>Profile photo<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void upload(event)} disabled={uploading}/><small>{uploading ? "Uploading…" : "JPG, PNG or WebP · up to 2 MB"}</small></label></div>
      <form onSubmit={(event) => void save(event)}>
        <label>Full name<input name="name" required maxLength={120} defaultValue={profile.name}/></label>
        <label>Company email<input name="email" type="email" required maxLength={254} pattern="[^@\s]+@enibrand\.com" defaultValue={profile.email} autoComplete="email"/><small>Email changes require confirmation at the new address.</small></label>
        <button type="submit" disabled={saving||uploading}>{saving ? "Saving…" : "Save profile"}</button>
      </form>
    </>}
    {!loading && <PasswordChangeForm />}
  </section>;
}

function PasswordChangeForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function change(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/account/profile/password", {
        method: "POST", cache: "no-store", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: values.get("currentPassword"), newPassword: values.get("newPassword"), confirmPassword: values.get("confirmPassword") }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Password could not be changed. Retry.");
      form.reset(); setNotice(body.message ?? "Password updated.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Password could not be changed. Retry.");
    } finally { setBusy(false); }
  }

  return <section className="account-profile__security" aria-labelledby="account-password-title">
    <div><p className="account-profile__eyebrow">Security</p><h3 id="account-password-title">Change password</h3><p>Use your current password to set a new one for your EBA Hub sign-in.</p></div>
    {notice && <p className="account-profile__notice" role="status">{notice}</p>}
    {error && <p className="account-profile__error" role="alert">{error}</p>}
    <form className="account-profile__password-form" onSubmit={(event) => void change(event)}>
      <label>Current password<input name="currentPassword" type="password" autoComplete="current-password" minLength={1} required disabled={busy}/></label>
      <label>New password<input name="newPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={busy}/><small>Use 12–128 characters.</small></label>
      <label>Confirm new password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={busy}/></label>
      <button type="submit" disabled={busy}>{busy ? "Updating password…" : "Update password"}</button>
    </form>
  </section>;
}
