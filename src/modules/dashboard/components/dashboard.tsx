import Link from "next/link";
import {
  Folder,
  SquareCheckBig,
  CalendarDays,
  MessageSquare,
  Bell,
  Trophy,
  Bot,
  Video,
  CirclePlus,
  Upload,
  Plane,
  CircleCheck,
  ChartNoAxesColumn,
  UsersRound,
  Settings,
  Megaphone,
} from "lucide-react";
import { loadWorkspace } from "@/modules/operations/queries";
import { PersistedCheckbox } from "@/modules/operations/persisted-checkbox";
import { validMeetUrl } from "@/modules/operations/schemas";
function Panel({
  title,
  href,
  children,
  className = "",
}: {
  title: string;
  href?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`ref-panel ${className}`}>
      <div className="ref-panel-heading">
        <h2>
          {title === "EBA Assistant" && (
            <span className="ref-bot-mark">
              <Bot />
            </span>
          )}
          {title}
        </h2>
        {href && <Link href={href}>View all</Link>}
      </div>
      <div className="ref-panel-body">{children}</div>
    </section>
  );
}
function Empty({
  ready,
  label = "No records yet.",
}: {
  ready: boolean;
  label?: string;
}) {
  return (
    <p className="ref-data-state">
      {ready
        ? label
        : "Setup required · connect Supabase and apply migrations."}
    </p>
  );
}
const when = (value: string) =>
  new Date(value).toLocaleString("en-GB", {
    timeZone: "Africa/Lagos",
    dateStyle: "medium",
    timeStyle: "short",
  });
export async function Dashboard() {
  const d = await loadWorkspace();
  const userId = d.session.preview ? null : d.session.userId;
  const name = d.session.preview ? "your workspace" : d.session.displayName;
  const own = d.tasks.filter((t) => t.assignee_id === userId);
  const open = own.filter((t) => t.status !== "complete");
  const upcoming = d.meetings.filter(
    (m) => Date.parse(m.ends_at) >= Date.parse(d.now),
  );
  const employee = (id: string) =>
    d.employees.find((e) => e.id === id)?.display_name ?? "Employee";
  const stats = [
    {
      label: "Active Projects",
      key: "projects" as const,
      icon: Folder,
      href: "projects?status=active",
    },
    {
      label: "My Tasks",
      key: "tasks" as const,
      icon: SquareCheckBig,
      href: "tasks?assigned=me&status=open",
    },
    {
      label: "Upcoming Meetings",
      key: "meetings" as const,
      icon: CalendarDays,
      href: "meetings?upcoming=true",
    },
    {
      label: "Unread Messages",
      key: "messages" as const,
      icon: MessageSquare,
      href: "chat?unread=true",
    },
    {
      label: "Notifications",
      key: "notifications" as const,
      icon: Bell,
      href: "notifications?status=unread",
    },
    {
      label: "Pending Approvals",
      key: "approvals" as const,
      icon: Trophy,
      href: "approvals?status=pending",
    },
  ];
  const actions = [
    { label: "Create Task", icon: CirclePlus, href: "tasks?action=create" },
    {
      label: "Schedule Meeting",
      icon: CalendarDays,
      href: "meetings?action=create",
    },
    { label: "Send Message", icon: MessageSquare, href: "chat" },
    { label: "Upload File", icon: Upload, href: "files" },
    { label: "New Project", icon: Folder, href: "projects?action=create" },
    { label: "Request Leave", icon: Plane, href: "leave" },
    {
      label: "Make Approval",
      icon: CircleCheck,
      href: "approvals?status=pending",
    },
    { label: "View Reports", icon: ChartNoAxesColumn, href: "reports" },
  ];
  return (
    <div className="ref-dashboard">
      <section className="ref-welcome" aria-label="Welcome and today's focus">
        <div className="ref-welcome-copy">
          <h1>
            Welcome, <strong>{name}</strong> <span aria-hidden="true">👋</span>
          </h1>
          <p>Let’s make today count.</p>
          <blockquote>
            “Great work builds great reputations.”
            <cite>— ENI BRAND ARCHITECT</cite>
          </blockquote>
        </div>
        <div className="ref-weather">
          <strong>
            {new Date(d.now).toLocaleDateString("en-GB", {
              timeZone: "Africa/Lagos",
              dateStyle: "full",
            })}
          </strong>
          <span>Lagos, Nigeria · WAT</span>
          <small>Weather service not configured</small>
        </div>
        <div className="ref-focus">
          <h2>
            ♛ <span>Today’s Focus</span>
          </h2>
          {d.focus.length ? (
            d.focus
              .slice(0, 4)
              .map((f) => (
                <PersistedCheckbox
                  key={f.id}
                  id={f.id}
                  checked={f.complete}
                  label={f.title}
                  kind="focus"
                />
              ))
          ) : (
            <Empty ready={d.ready} label="Add a focus item in My Workspace." />
          )}
          <Link href="/dashboard/workspace">Manage focus</Link>
        </div>
      </section>
      <section className="ref-stats" aria-label="Database workspace statistics">
        {stats.map(({ label, key, icon: Icon, href }) => (
          <Link key={key} href={`/dashboard/${href}`} className="ref-stat">
            <Icon
              className={
                key === "notifications" || key === "approvals" ? "gold" : ""
              }
            />
            <div>
              <b>{d.counts?.[key] ?? "—"}</b>
              <span>{label}</span>
              {!d.ready && <small>Setup required</small>}
            </div>
          </Link>
        ))}
      </section>
      <div className="ref-content">
        <div className="ref-primary-grid">
          <Panel
            title="My Tasks"
            href="/dashboard/tasks?assigned=me"
            className="ref-tasks"
          >
            <div className="ref-task-tabs">
              <Link href="/dashboard/tasks?assigned=me&due=today">Today</Link>
              <Link href="/dashboard/tasks?assigned=me&due=week">
                This Week
              </Link>
              <Link href="/dashboard/tasks?assigned=me&due=overdue">
                Overdue
              </Link>
            </div>
            {open.length ? (
              open.slice(0, 4).map((t) => (
                <div key={t.id} className="ref-task-row">
                  <PersistedCheckbox
                    id={t.id}
                    checked={t.status === "complete"}
                    label={t.title}
                    detail={t.due_at ? when(t.due_at) : "No due time"}
                    kind="task"
                  />
                  <em className={t.priority}>{t.priority}</em>
                </div>
              ))
            ) : (
              <Empty ready={d.ready} label="No assigned tasks." />
            )}
          </Panel>
          <Panel
            title="Upcoming Meetings"
            href="/dashboard/meetings"
            className="ref-meetings"
          >
            <div className="ref-meeting-list">
              {upcoming.length ? (
                upcoming.slice(0, 3).map((m) => (
                  <article key={m.id} className="ref-meeting">
                    <div>
                      <h3>{m.title}</h3>
                      <p>{when(m.starts_at)}</p>
                    </div>
                    {m.google_event_id && validMeetUrl(m.meet_url) ? (
                      <a
                        className="ref-green-button"
                        href={m.meet_url!}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Video size={15} /> Join Meeting
                      </a>
                    ) : (
                      <Link
                        href="/dashboard/meetings"
                        className="ref-muted-button"
                      >
                        Details · Meet setup
                      </Link>
                    )}
                  </article>
                ))
              ) : (
                <Empty ready={d.ready} label="No upcoming meetings." />
              )}
            </div>
          </Panel>
          <Panel
            title="EBA Assistant"
            href="/dashboard/assistant"
            className="ref-assistant"
          >
            <ul className="ref-assistant-list">
              {d.notifications.length ? (
                d.notifications.slice(0, 4).map((n) => (
                  <li key={n.id}>
                    <span className="ref-round-icon purple">
                      <Bell />
                    </span>
                    <p>{n.title}</p>
                    <Link href="/dashboard/notifications">Open</Link>
                  </li>
                ))
              ) : (
                <li>
                  <Empty
                    ready={d.ready}
                    label="No reminders or notifications."
                  />
                </li>
              )}
            </ul>
            <p className="ref-data-state">
              {process.env.REMINDER_SCHEDULER_ENABLED === "true"
                ? "Reminder job status is available in EBA Assistant."
                : "Background scheduler setup required."}
            </p>
          </Panel>
          <Panel
            title="Project Progress"
            href="/dashboard/projects"
            className="ref-project-progress"
          >
            <ul>
              {d.projects.length ? (
                d.projects.slice(0, 5).map((p) => {
                  const progress =
                    d.progress.find((row) => row.project_id === p.id)
                      ?.progress ?? 0;
                  return (
                    <li key={p.id}>
                      <span>{p.name}</span>
                      <div
                        className="ref-progress-track"
                        role="progressbar"
                        aria-label={p.name}
                        aria-valuenow={progress}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <span
                          className="green"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <b>{progress}%</b>
                    </li>
                  );
                })
              ) : (
                <li>
                  <Empty ready={d.ready} />
                </li>
              )}
            </ul>
          </Panel>
          <Panel
            title="Employee Recognition"
            href="/dashboard/recognition"
            className="ref-recognition"
          >
            <div className="ref-live-recognition">
              {d.recognition.length ? (
                d.recognition.slice(0, 4).map((r) => (
                  <article key={r.id}>
                    <Trophy className="gold" />
                    <strong>{employee(r.recipient_id)}</strong>
                    <p>{r.message}</p>
                    <small>Management-approved</small>
                  </article>
                ))
              ) : (
                <Empty
                  ready={d.ready}
                  label="No approved recognition. No employee winners are fabricated."
                />
              )}
            </div>
          </Panel>
          <Panel title="Quick Actions" className="ref-quick-actions">
            <div className="ref-quick-grid">
              {actions.map(({ label, icon: Icon, href }) => (
                <Link
                  className="ref-quick-action"
                  key={label}
                  href={`/dashboard/${href}`}
                >
                  <Icon />
                  <span>{label}</span>
                </Link>
              ))}
            </div>
          </Panel>
        </div>
        <div className="ref-bottom-grid">
          <Panel title="Team Activity" href="/dashboard/workspace">
            <ul className="ref-activity-list">
              {d.activity.length ? (
                d.activity.slice(0, 4).map((a) => (
                  <li key={a.id}>
                    <CircleCheck size={18} />
                    <p>{a.event}</p>
                    <time>{when(a.created_at)}</time>
                  </li>
                ))
              ) : (
                <li>
                  <Empty
                    ready={d.ready}
                    label="No activity visible to your role."
                  />
                </li>
              )}
            </ul>
          </Panel>
          <Panel title="Company Announcements" href="/dashboard/workspace">
            <ul className="ref-announcements">
              {d.announcements.length ? (
                d.announcements.slice(0, 3).map((a) => (
                  <li key={a.id}>
                    <Megaphone className="gold" />
                    <div>
                      <strong>{a.title}</strong>
                      <p>{a.body}</p>
                    </div>
                  </li>
                ))
              ) : (
                <li>
                  <Empty ready={d.ready} />
                </li>
              )}
            </ul>
          </Panel>
          <section className="ref-highlights">
            <div className="ref-panel-heading">
              <h2>This Month’s Highlights</h2>
              <span>
                {new Date(d.now).toLocaleDateString("en-GB", {
                  timeZone: "Africa/Lagos",
                  month: "long",
                  year: "numeric",
                })}
              </span>
            </div>
            <div className="ref-highlight-stats">
              <div>
                <span>
                  <Trophy />
                  <strong>—</strong>
                </span>
                <small>Period report required</small>
              </div>
              <div>
                <span>
                  <UsersRound />
                  <strong>—</strong>
                </span>
                <small>Client records required</small>
              </div>
              <div>
                <span>
                  <ChartNoAxesColumn />
                  <strong>—</strong>
                </span>
                <small>No invented scores</small>
              </div>
              <div>
                <span>
                  <Settings />
                  <strong>—</strong>
                </span>
                <small>Delivery report required</small>
              </div>
            </div>
            <blockquote>
              “Together, we create stories that shape reputations
              <br />
              and build lasting impact.”<cite>— ENI BRAND ARCHITECT</cite>
            </blockquote>
            <div className="ref-gold-lines" />
          </section>
        </div>
      </div>
    </div>
  );
}
