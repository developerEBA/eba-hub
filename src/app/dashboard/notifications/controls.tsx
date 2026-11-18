"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { markNotification } from "./actions";
import { NotificationChime } from "./notification-chime";

export function NotificationUpdates({latestUnreadId}:{latestUnreadId?:number}={}) {
  const router = useRouter();
  useEffect(() => {
    const source = new EventSource("/dashboard/connect/events");
    let connected = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const refresh = (event: MessageEvent<string>) => {
      if (event.data === "ready") {
        // The initial server render already loaded the inbox. Refreshing on
        // every mount's handshake can remount this subscription in a loop.
        // A later handshake means a real reconnect: catch up on missed changes.
        if (!connected) { connected = true; return; }
      } else if (event.data !== "changed") return;
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => router.refresh(), 150);
    };
    source.addEventListener("refresh", refresh);
    return () => {
      clearTimeout(refreshTimer);
      source.close();
    };
  }, [router]);
  return <NotificationChime latestUnreadId={latestUnreadId}/>;
}

export function MarkRead({ id, label }: { id: number | "all"; label: string }) {
  const [error, action, pending] = useActionState(markNotification, null);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending}>{pending ? "Saving…" : label}</button>
      {error && <span role="alert">{error}</span>}
    </form>
  );
}
