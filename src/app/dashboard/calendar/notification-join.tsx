"use client";
import { joinWindow } from "./join-window";
import { useMeetingClock } from "./use-meeting-clock";
import { useEffect, useState } from "react";
export function NotificationJoin({
  meeting,
}: {
  meeting: {
    id: string;
    starts_at: string;
    ends_at: string;
    status: "scheduled" | "cancelled";
    joining_closed_at?: string | null;
  };
}) {
  const [current, setCurrent] = useState(meeting),
    [denied, setDenied] = useState(false);
  useEffect(() => {
    let busy = false;
    const controller = new AbortController();
    const update = async () => {
      if (busy) return;
      busy = true;
      try {
        const response = await fetch(`/dashboard/calendar/api/${meeting.id}?view=join`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if ([401, 403, 404].includes(response.status)) {
          setDenied(true);
          return;
        }
        if (response.ok) {
          const data = await response.json();
          if (!controller.signal.aborted) {
            setCurrent(data);
            setDenied(false);
          }
        }
      } catch {
        return;
      } finally {
        busy = false;
      }
    };
    void update();
    const timer = setInterval(() => void update(), 15000);
    window.addEventListener("focus", update);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, [meeting.id]);
  const now = useMeetingClock(),
    joining = joinWindow(current, now);
  return !denied && joining.state === "open" ? (
    <a
      href={`/dashboard/calendar/api/${meeting.id}/join`}
      target="_blank"
      rel="noopener noreferrer"
    >
      Join Meeting ↗
    </a>
  ) : (
    <button
      type="button"
      disabled
      title={
        joining.state === "waiting"
          ? "Opens at scheduled start"
          : "Joining closed for this occurrence"
      }
    >
      Join Meeting
    </button>
  );
}
