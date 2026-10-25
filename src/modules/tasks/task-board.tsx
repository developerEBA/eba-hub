"use client";
import { useState } from "react";
import { sampleData } from "@/modules/workspace/sample-data";
export function TaskBoard() {
  const [filter, setFilter] = useState("All");
  const [done, setDone] = useState<string[]>([]);
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <p className="eyebrow">
        SAMPLE DATA · CHANGES LAST UNTIL THIS PAGE CLOSES
      </p>
      <label className="my-5 block text-sm">
        Filter tasks{" "}
        <select
          className="ml-3 rounded border border-border bg-card p-2"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option>All</option>
          <option>Open</option>
          <option>Complete</option>
        </select>
      </label>
      <ul className="divide-y divide-border">
        {sampleData.tasks
          .filter(
            (task) =>
              filter === "All" ||
              (filter === "Complete"
                ? done.includes(task.title)
                : !done.includes(task.title)),
          )
          .map((task) => (
            <li className="py-5" key={task.title}>
              <label className="flex items-start gap-3">
                <input
                  className="mt-1 size-4 accent-primary"
                  type="checkbox"
                  checked={done.includes(task.title)}
                  onChange={(e) =>
                    setDone((previous) =>
                      e.target.checked
                        ? [...previous, task.title]
                        : previous.filter((title) => title !== task.title),
                    )
                  }
                />
                <span>
                  <span
                    className={
                      done.includes(task.title) ? "line-through" : "font-medium"
                    }
                  >
                    {task.title}
                  </span>
                  <span className="mt-2 block text-sm text-muted-foreground">
                    {task.detail}
                  </span>
                </span>
              </label>
            </li>
          ))}
      </ul>
      <p className="mt-4 text-sm text-muted-foreground" aria-live="polite">
        {done.length} of {sampleData.tasks.length} sample tasks complete. No
        backend is connected.
      </p>
    </section>
  );
}
