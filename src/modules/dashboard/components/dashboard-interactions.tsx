"use client";
import { useRef, useState } from "react";
import { Clock3, X } from "lucide-react";
export function DemoAction({
  children,
  label,
  className = "",
}: {
  children?: React.ReactNode;
  label: string;
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button className={className} onClick={() => dialog.current?.showModal()}>
        {children ?? label}
      </button>
      <dialog ref={dialog} className="ref-dialog" aria-label={label}>
        <button
          className="ref-dialog-close"
          aria-label="Close demo information"
          onClick={() => dialog.current?.close()}
        >
          <X size={18} />
        </button>
        <span className="ref-demo-label">SAMPLE WORKSPACE</span>
        <h2>{label}</h2>
        <p>
          This is a sample dashboard.{" "}
          {label === "Join Meeting"
            ? "No real meeting or Google Meet link has been created."
            : "This service is not connected yet."}{" "}
          No records are saved and no external action is performed.
        </p>
        <button
          className="ref-green-button"
          onClick={() => dialog.current?.close()}
        >
          Got it
        </button>
      </dialog>
    </>
  );
}
const tasks = [
  {
    title: "Finalize creative designs for Zenith Bank campaign",
    time: "Today, 10:00 AM",
    priority: "High",
    overdue: false,
  },
  {
    title: "Team meeting preparation",
    time: "Today, 11:00 AM",
    priority: "Medium",
    overdue: false,
  },
  {
    title: "Review client proposal",
    time: "Today, 2:00 PM",
    priority: "High",
    overdue: false,
  },
  {
    title: "Update project timeline",
    time: "Today, 4:00 PM",
    priority: "Medium",
    overdue: false,
  },
  {
    title: "Review campaign research",
    time: "Yesterday, 3:00 PM",
    priority: "High",
    overdue: true,
  },
  {
    title: "Share brand guidelines",
    time: "Yesterday, 5:00 PM",
    priority: "Medium",
    overdue: true,
  },
  {
    title: "Approve studio brief",
    time: "Monday, 10:00 AM",
    priority: "High",
    overdue: true,
  },
  {
    title: "Prepare weekly report",
    time: "Friday, 2:00 PM",
    priority: "Medium",
    overdue: false,
  },
];
export function DashboardTasks() {
  const [tab, setTab] = useState("Today");
  const [completed, setCompleted] = useState<string[]>([]);
  const visible =
    tab === "Today"
      ? tasks.slice(0, 4)
      : tab === "Overdue"
        ? tasks.filter((task) => task.overdue)
        : tasks;
  return (
    <>
      <div
        className="ref-task-tabs"
        role="group"
        aria-label="Filter sample tasks"
      >
        {[
          ["Today", 4],
          ["This Week", 8],
          ["Overdue", 3],
        ].map(([name, count]) => (
          <button
            key={name}
            className={tab === name ? "selected" : ""}
            aria-pressed={tab === name}
            onClick={() => setTab(String(name))}
          >
            {name} ({count})
          </button>
        ))}
      </div>
      <div className="ref-task-list">
        {visible.map((task) => (
          <label key={task.title} className="ref-task-row">
            <input
              type="checkbox"
              checked={completed.includes(task.title)}
              onChange={(e) =>
                setCompleted((previous) =>
                  e.target.checked
                    ? [...previous, task.title]
                    : previous.filter((title) => title !== task.title),
                )
              }
            />
            <span>
              <span
                className={completed.includes(task.title) ? "ref-done" : ""}
              >
                {task.title}
              </span>
              <small>
                <Clock3 size={11} />
                {task.time}
              </small>
            </span>
            <em className={task.priority.toLowerCase()}>{task.priority}</em>
          </label>
        ))}
      </div>
      <span className="ref-sr-only" role="status">
        {completed.length} sample tasks completed. Changes reset when you leave
        this page.
      </span>
    </>
  );
}
export function TodayFocus() {
  return (
    <div className="ref-focus">
      <h2>
        ♛ <span>Today’s Focus</span>
      </h2>
      {[
        "Review campaign designs",
        "Team meeting at 11:00 AM",
        "Approve client proposal",
        "Update project timeline",
      ].map((label) => (
        <label key={label}>
          <input type="checkbox" />
          {label}
        </label>
      ))}
    </div>
  );
}
