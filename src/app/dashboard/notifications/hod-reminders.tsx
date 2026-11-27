"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type Reminder = {
  id: number;
  created_at: string;
  read_at: string | null;
  conversation_id: string | null;
  approval_id: string | null;
  calendar_occurrence_id: string | null;
  game_room_id: string | null;
};
export function HodReminders() {
  const [items, setItems] = useState<Reminder[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function refresh() {
    try {
      const response = await fetch("/dashboard/notifications/hod", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error();
      setItems(data.items ?? []);
      setError("");
    } catch {
      setError("Reminders could not be loaded.");
    }
  }
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, []);
  async function markRead(id: number) {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/dashboard/notifications/hod", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) throw new Error();
      await refresh();
    } catch {
      setError("Reminder could not be marked read. Retry.");
    } finally {
      setBusy(false);
    }
  }
  const unread = items.filter((item) => !item.read_at).length;
  return (
    <details className="eba-notifications" aria-label="Department reminders">
      <summary aria-label={`Department reminders, ${unread} unread`}>
        <span aria-hidden="true">♢</span>
        {unread > 0 && <span>{unread}</span>}
      </summary>
      <section className="eba-notifications__inbox">
        <header>
          <strong>Department reminders</strong>
          <button type="button" disabled={busy || !unread} onClick={() => void markRead(-1)}>
            Mark all read
          </button>
        </header>
        {error ? (
          <p role="alert">
            {error}
            <button type="button" onClick={() => void refresh()}>
              Retry
            </button>
          </p>
        ) : !items.length ? (
          <p>No department reminders yet.</p>
        ) : (
          <ul>
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  href={
                    item.game_room_id
                      ? `/dashboard/games?room=${item.game_room_id}`
                      : item.calendar_occurrence_id
                        ? `/dashboard/calendar?meeting=${item.calendar_occurrence_id}`
                        : item.approval_id
                          ? `/dashboard/approvals?request=${item.approval_id}`
                          : `/dashboard/connect?chat=${item.conversation_id}`
                  }
                >
                  {item.game_room_id
                    ? "Game invitation"
                    : item.calendar_occurrence_id
                      ? "Meeting reminder"
                      : item.approval_id
                        ? "Approval request"
                        : "Connect activity"}
                </Link>
                {!item.read_at && (
                  <button type="button" disabled={busy} onClick={() => void markRead(item.id)}>
                    Mark read
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </details>
  );
}
