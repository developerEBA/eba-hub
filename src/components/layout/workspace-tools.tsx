"use client";
import Link from "next/link";
export function WorkspaceTools() {
  return (
    <nav aria-label="Workspace tools" className="flex gap-3 text-xs">
      <Link href="/dashboard">Search dashboard</Link>
      <Link href="/dashboard/notifications">Notifications</Link>
      <Link href="/dashboard/settings">Profile</Link>
    </nav>
  );
}
