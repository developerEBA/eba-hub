import Link from "next/link";
import { signOut } from "@/modules/auth/actions";
import { loadWorkspace, loadMessages, type WorkspaceData } from "./queries";
import { OperationForm } from "./operation-form";
import { SetupRequired, EmptyRecords } from "./states";
import { matchesDue, validMeetUrl } from "./schemas";
import { ChatThread } from "./chat-thread";
import { FileUpload, FileDownload } from "./files-ui";
function Field({
  name,
  label,
  type = "text",
  value,
  required = true,
}: {
  name: string;
  label: string;
  type?: string;
  value?: string;
  required?: boolean;
}) {
  return (
    <label>
      {label}
      <input name={name} type={type} defaultValue={value} required={required} />
    </label>
  );
}
function Hidden({ name, value }: { name: string; value: string }) {
  return <input type="hidden" name={name} value={value} />;
}
function People({
  data,
  name = "members",
  multiple = true,
  value,
}: {
  data: WorkspaceData;
  name?: string;
  multiple?: boolean;
  value?: string;
}) {
  return (
    <label>
      {multiple
        ? "Participants (Ctrl/Command to select multiple)"
        : "Assigned employee"}
      <select
        name={name}
        multiple={multiple}
        defaultValue={multiple ? [] : (value ?? "")}
      >
        {!multiple && <option value="">Unassigned</option>}
        {data.employees.map((e) => (
          <option key={e.id} value={e.id}>
            {e.display_name}
          </option>
        ))}
      </select>
    </label>
  );
}
function When({ value }: { value: string | null }) {
  return (
    <>
      {value
        ? new Date(value).toLocaleString("en-GB", { timeZone: "Africa/Lagos" })
        : "Not set"}
    </>
  );
}
const localTime = (value: string | null) =>
  value
    ? new Date(new Date(value).getTime() + 3600000).toISOString().slice(0, 16)
    : "";
export async function OperationsPage({
  module,
  searchParams,
}: {
  module: string;
  searchParams: {
    q?: string;
    status?: string;
    conversation?: string;
    assigned?: string;
    due?: string;
    project?: string;
    action?: string;
    upcoming?: string;
    unread?: string;
  };
}) {
  const data = await loadWorkspace();
  if (!data.ready) return <SetupRequired message={data.error} />;
  const { session } = data;
  if (session.preview) return <SetupRequired />;
  const manager = ["admin", "management"].includes(session.role),
    lead = manager || session.role === "department_lead";
  const employeeName = (id: string | null) =>
    data.employees.find((e) => e.id === id)?.display_name ?? "Unassigned";
  if (module === "tasks") {
    const visible = data.tasks.filter(
      (t) =>
        (!searchParams.status ||
          (searchParams.status === "open"
            ? t.status !== "complete"
            : t.status === searchParams.status)) &&
        (!searchParams.q ||
          t.title.toLowerCase().includes(searchParams.q.toLowerCase())) &&
        (searchParams.assigned !== "me" || t.assignee_id === session.userId) &&
        (!searchParams.project || t.project_id === searchParams.project) &&
        matchesDue(t.due_at, searchParams.due, new Date(data.now)) &&
        (searchParams.due !== "overdue" || t.status !== "complete"),
    );
    return (
      <div className="op-stack">
        <form className="op-filters">
          <label>
            Find tasks
            <input name="q" defaultValue={searchParams.q} />
          </label>
          <label>
            Status
            <select name="status" defaultValue={searchParams.status ?? ""}>
              <option value="">All</option>
              <option value="todo">To do</option>
              <option value="in_progress">In progress</option>
              <option value="complete">Complete</option>
            </select>
          </label>
          <label>
            Assignment
            <select name="assigned" defaultValue={searchParams.assigned ?? ""}>
              <option value="">Accessible tasks</option>
              <option value="me">My tasks</option>
            </select>
          </label>
          <button>Filter</button>
        </form>
        <details
          className="op-card"
          open={searchParams.action === "create" || !data.tasks.length}
        >
          <summary>Create task</summary>
          {!data.projects.length ? (
            <EmptyRecords label="Create a project with participants before adding tasks." />
          ) : (
            <TaskEditor data={data} />
          )}
        </details>
        {!visible.length && <EmptyRecords />}
        {visible.map((task) => (
          <article className="op-card" key={task.id}>
            <h2>{task.title}</h2>
            <p>
              {task.status} · {task.priority} priority ·{" "}
              {employeeName(task.assignee_id)} · Due{" "}
              <When value={task.due_at} />
            </p>
            {(lead ||
              task.created_by === session.userId ||
              task.assignee_id === session.userId) && (
              <>
                <OperationForm
                  operation="task.toggle"
                  label={
                    task.status === "complete" ? "Reopen task" : "Complete task"
                  }
                >
                  <Hidden name="id" value={task.id} />
                  <Hidden
                    name="complete"
                    value={task.status === "complete" ? "false" : "true"}
                  />
                </OperationForm>
                <details>
                  <summary>Edit task</summary>
                  <TaskEditor data={data} task={task} />
                </details>
                {(lead || task.created_by === session.userId) && (
                  <details>
                    <summary>Delete task</summary>
                    <p>
                      This permanently deletes the task. Only its creator or
                      project management can delete it.
                    </p>
                    <OperationForm
                      operation="task.delete"
                      label="Confirm deletion"
                    >
                      <Hidden name="id" value={task.id} />
                    </OperationForm>
                  </details>
                )}
              </>
            )}
          </article>
        ))}
        <p className="op-note">
          Showing up to 500 accessible tasks. Server checks and RLS authorize
          each save.
        </p>
      </div>
    );
  }
  if (module === "projects")
    return (
      <div className="op-stack">
        {!lead && searchParams.action === "create" && (
          <p role="alert">
            Your stored role does not allow project creation. Contact your
            department lead.
          </p>
        )}
        {lead && (
          <details className="op-card" open={searchParams.action === "create"}>
            <summary>New project</summary>
            <ProjectEditor data={data} />
          </details>
        )}
        {!data.projects.length && (
          <EmptyRecords label="No accessible projects. A department lead, management or admin can create the first project." />
        )}
        {data.projects
          .filter(
            (p) => !searchParams.status || p.status === searchParams.status,
          )
          .map((project) => (
            <article className="op-card" key={project.id}>
              <h2>{project.name}</h2>
              <p>
                {project.status} · Deadline <When value={project.deadline} />
              </p>
              <Link href={`/dashboard/tasks?project=${project.id}`}>
                Open tasks
              </Link>
              {lead && (
                <>
                  <details>
                    <summary>Edit project</summary>
                    <ProjectEditor data={data} project={project} />
                  </details>
                  <details>
                    <summary>Replace participants</summary>
                    <p>
                      Choose all participants to retain. Assigned tasks must be
                      reassigned before removing a participant.
                    </p>
                    <OperationForm
                      operation="project.members"
                      label="Save participants"
                    >
                      <Hidden name="id" value={project.id} />
                      <People data={data} />
                    </OperationForm>
                  </details>
                </>
              )}
            </article>
          ))}
      </div>
    );
  if (module === "chat") {
    const conversations = data.conversations.filter(
      (c) =>
        searchParams.unread !== "true" ||
        data.unread.some((u) => u.id === c.id && u.unread_count > 0),
    );
    const chosen =
      conversations.find((c) => c.id === searchParams.conversation) ??
      conversations[0];
    const messages = chosen ? await loadMessages(chosen.id) : [];
    return (
      <div className="op-stack">
        <details className="op-card">
          <summary>New private chat or channel</summary>
          <OperationForm
            operation="conversation.create"
            label="Create conversation"
          >
            <Field name="title" label="Conversation name" />
            <label>
              Kind
              <select name="kind">
                <option value="private">Private chat (one recipient)</option>
                <option value="channel">Channel</option>
              </select>
            </label>
            <People
              data={{
                ...data,
                employees: data.employees.filter(
                  (e) => e.id !== session.userId,
                ),
              }}
            />
          </OperationForm>
        </details>
        <nav className="op-tabs">
          {conversations.map((c) => (
            <Link
              key={c.id}
              href={`/dashboard/chat?conversation=${c.id}`}
              aria-current={chosen?.id === c.id ? "page" : undefined}
            >
              {c.title} · {c.kind}
            </Link>
          ))}
        </nav>
        {chosen ? (
          <ChatThread
            conversation={chosen}
            messages={messages}
            employees={data.employees}
            userId={session.userId}
          />
        ) : (
          <EmptyRecords label="Create a conversation to send your first persisted message." />
        )}
      </div>
    );
  }
  if (module === "meetings")
    return (
      <div className="op-stack">
        <p className="op-setup">
          Google Calendar/Meet setup required. Internal meeting records and
          invitations can be saved; no Google meeting link is fabricated.
        </p>
        <details className="op-card" open={searchParams.action === "create"}>
          <summary>Schedule an internal meeting</summary>
          <MeetingEditor data={data} />
        </details>
        {!data.meetings.length && <EmptyRecords />}
        {data.meetings
          .filter(
            (m) =>
              searchParams.upcoming !== "true" ||
              Date.parse(m.ends_at) >= Date.parse(data.now),
          )
          .map((meeting) => (
            <article className="op-card" key={meeting.id}>
              <h2>{meeting.title}</h2>
              <p>
                <When value={meeting.starts_at} /> –{" "}
                <When value={meeting.ends_at} /> WAT · Organizer:{" "}
                {employeeName(meeting.organizer_id)}
              </p>
              {meeting.google_event_id && validMeetUrl(meeting.meet_url) ? (
                <a
                  href={meeting.meet_url!}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Join Google Meet
                </a>
              ) : (
                <p>No verified Google Meet link. Provider setup required.</p>
              )}
              {meeting.organizer_id === session.userId && (
                <>
                  <details>
                    <summary>Edit meeting details</summary>
                    <MeetingEditor data={data} meeting={meeting} />
                  </details>
                  <details>
                    <summary>Manage invitations</summary>
                    <OperationForm
                      operation="meeting.members"
                      label="Save invitees"
                    >
                      <Hidden name="id" value={meeting.id} />
                      <People data={data} />
                    </OperationForm>
                  </details>
                </>
              )}
            </article>
          ))}
      </div>
    );
  if (module === "approvals")
    return (
      <div className="op-stack">
        <details className="op-card">
          <summary>Submit approval request</summary>
          <OperationForm operation="approval.create">
            <Field name="title" label="Request title" />
            <label>
              Details
              <textarea name="body" required maxLength={3000} />
            </label>
          </OperationForm>
        </details>
        {!data.approvals.length && <EmptyRecords />}
        {data.approvals
          .filter(
            (a) => !searchParams.status || a.status === searchParams.status,
          )
          .map((a) => (
            <article className="op-card" key={a.id}>
              <h2>{a.title}</h2>
              <p>{a.body}</p>
              <p>
                {employeeName(a.requester_id)} · {a.kind} · {a.status}
              </p>
              {manager &&
                a.status === "pending" &&
                a.requester_id !== session.userId && (
                  <OperationForm
                    operation="approval.review"
                    label="Submit decision"
                  >
                    <Hidden name="id" value={a.id} />
                    <label>
                      Decision
                      <select name="decision">
                        <option value="approved">Approve</option>
                        <option value="rejected">Reject</option>
                      </select>
                    </label>
                  </OperationForm>
                )}
            </article>
          ))}
      </div>
    );
  if (module === "leave")
    return (
      <div className="op-card">
        <h2>Request leave</h2>
        <OperationForm operation="leave.submit">
          <Field name="starts_on" label="Start date" type="date" />
          <Field name="ends_on" label="End date" type="date" />
          <label>
            Reason
            <textarea name="reason" required maxLength={3000} />
          </label>
        </OperationForm>
        <Link href="/dashboard/approvals">
          Track your requests and decisions
        </Link>
      </div>
    );
  if (module === "recognition")
    return (
      <div className="op-stack">
        {manager && (
          <details className="op-card">
            <summary>Create award period</summary>
            <OperationForm operation="period.create">
              <Field name="title" label="Period name" />
              <Field name="starts_on" label="Start date" type="date" />
              <Field name="ends_on" label="End date" type="date" />
            </OperationForm>
          </details>
        )}
        <details className="op-card">
          <summary>Nominate an employee</summary>
          {data.periods.length ? (
            <OperationForm
              operation="nomination.create"
              label="Submit nomination"
            >
              <label>
                Award period
                <select name="period_id">
                  {data.periods.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title} ({p.starts_on}–{p.ends_on})
                    </option>
                  ))}
                </select>
              </label>
              <People
                data={{
                  ...data,
                  employees: data.employees.filter(
                    (e) => e.id !== session.userId,
                  ),
                }}
                name="nominee_id"
                multiple={false}
              />
              <label>
                Contribution evidence
                <textarea name="reason" required maxLength={2000} />
              </label>
            </OperationForm>
          ) : (
            <EmptyRecords label="Management must create an open award period before nominations can be submitted." />
          )}
        </details>
        <p className="op-note">
          Recognition is published only after independent management approval.
          No automated winners or employee performance scores are invented.
        </p>
        {data.recognition.map((r) => (
          <article className="op-card" key={r.id}>
            <h2>{employeeName(r.recipient_id)}</h2>
            <p>{r.message}</p>
            <small>
              Approved recognition · <When value={r.created_at} />
            </small>
          </article>
        ))}
        {!data.recognition.length && (
          <EmptyRecords label="No approved recognition yet." />
        )}
      </div>
    );
  if (module === "files")
    return (
      <div className="op-stack">
        <FileUpload />
        {!data.files.length && <EmptyRecords />}
        {data.files.map((file) => (
          <article className="op-card" key={file.id}>
            <h2>{file.name}</h2>
            <p>
              {file.mime_type} · {file.size_bytes} bytes
            </p>
            <FileDownload file={file} />
          </article>
        ))}
      </div>
    );
  if (module === "notifications")
    return (
      <div className="op-stack">
        {!data.notifications.length && <EmptyRecords />}
        {data.notifications
          .filter((n) => searchParams.status !== "unread" || !n.read_at)
          .map((n) => (
            <article className="op-card" key={n.id}>
              <h2>{n.title}</h2>
              <p>
                <When value={n.created_at} /> · {n.read_at ? "Read" : "Unread"}
              </p>
              {!n.read_at && (
                <OperationForm operation="notification.read" label="Mark read">
                  <Hidden name="id" value={n.id} />
                </OperationForm>
              )}
            </article>
          ))}
      </div>
    );
  if (module === "directory")
    return (
      <div className="op-stack">
        {data.employees.map((e) => (
          <article className="op-card" key={e.id}>
            <h2>{e.display_name}</h2>
            <p>{e.role.replaceAll("_", " ")}</p>
          </article>
        ))}
      </div>
    );
  if (module === "settings")
    return (
      <div className="op-card">
        <h2>Your employee profile</h2>
        <OperationForm operation="profile.save" label="Save profile">
          <Field
            name="display_name"
            label="Display name"
            value={session.displayName}
          />
        </OperationForm>
        <p>
          Role: {session.role.replaceAll("_", " ")}. Role changes require
          trusted administration.
        </p>
        <form action={signOut}>
          <button>Sign out</button>
        </form>
      </div>
    );
  if (module === "workspace")
    return (
      <div className="op-stack">
        <section className="op-card">
          <h2>Today’s Focus</h2>
          <OperationForm operation="focus.create" label="Add focus item">
            <Field name="title" label="Focus item" />
          </OperationForm>
          {data.focus.map((f) => (
            <OperationForm
              key={f.id}
              operation="focus.toggle"
              label={f.complete ? "Reopen" : "Complete"}
            >
              <Hidden name="id" value={f.id} />
              <Hidden name="complete" value={f.complete ? "false" : "true"} />
              <p>
                {f.title} · {f.complete ? "Complete" : "Open"}
              </p>
            </OperationForm>
          ))}
        </section>
        <section className="op-card">
          <h2>Company announcements</h2>
          {manager && (
            <OperationForm
              operation="announcement.create"
              label="Publish announcement"
            >
              <Field name="title" label="Title" />
              <label>
                Announcement
                <textarea name="body" required maxLength={5000} />
              </label>
            </OperationForm>
          )}
          {data.announcements.map((a) => (
            <article key={a.id}>
              <h3>{a.title}</h3>
              <p>{a.body}</p>
            </article>
          ))}
          {!data.announcements.length && <EmptyRecords />}
        </section>
      </div>
    );
  if (module === "assistant")
    return (
      <div className="op-stack">
        <p className="op-setup">
          Background scheduler setup required until an operator enables the
          documented pg_cron job. In-app reminder jobs are durable; email/push
          delivery is not implemented.
        </p>
        {data.reminders.map((job) => (
          <article className="op-card" key={job.id}>
            <h2>Task reminder · {job.state}</h2>
            <p>
              <When value={job.run_at} /> · Attempts: {job.attempts}
            </p>
          </article>
        ))}
        {!data.reminders.length && (
          <EmptyRecords label="No scheduled reminder jobs. Assign a task with a due time to create one." />
        )}
      </div>
    );
  if (module === "reports")
    return (
      <div className="op-card">
        <h2>Your authorized workspace counts</h2>
        <dl>
          {Object.entries(data.counts ?? {}).map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <p className="op-note">
          Counts are calculated in PostgreSQL under your RLS permissions. Team
          performance scoring, client analytics and export reports are not
          implemented.
        </p>
      </div>
    );
  if (module === "admin")
    return (
      <div className="op-card">
        <h2>Administration</h2>
        {session.role === "admin" ? (
          <p>
            Use the approved operator workflow to provision employees and assign
            roles. Google Workspace provisioning and the role-management UI are
            not implemented.
          </p>
        ) : (
          <p role="alert">
            Your stored role does not authorize administration.
          </p>
        )}
      </div>
    );
  return (
    <SetupRequired message="This module is not implemented yet. No operation is simulated." />
  );
}
function TaskEditor({
  data,
  task,
}: {
  data: WorkspaceData;
  task?: WorkspaceData["tasks"][number];
}) {
  return (
    <OperationForm
      operation="task.save"
      label={task ? "Save task" : "Create task"}
    >
      <Hidden name="id" value={task?.id ?? ""} />
      <Field name="title" label="Task title" value={task?.title} />
      {task && <Hidden name="project_id" value={task.project_id} />}
      <label>
        Project
        <select
          name="project_id"
          defaultValue={task?.project_id}
          disabled={!!task}
        >
          {data.projects.map((p) => (
            <option value={p.id} key={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <People
        data={data}
        name="assignee_id"
        multiple={false}
        value={task?.assignee_id ?? ""}
      />
      <label>
        Status
        <select name="status" defaultValue={task?.status ?? "todo"}>
          <option value="todo">To do</option>
          <option value="in_progress">In progress</option>
          <option value="complete">Complete</option>
        </select>
      </label>
      <label>
        Priority
        <select name="priority" defaultValue={task?.priority ?? "medium"}>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </label>
      <Field
        name="due_at"
        label="Due time (WAT)"
        type="datetime-local"
        value={localTime(task?.due_at ?? null)}
        required={false}
      />
    </OperationForm>
  );
}
function ProjectEditor({
  data,
  project,
}: {
  data: WorkspaceData;
  project?: WorkspaceData["projects"][number];
}) {
  return (
    <OperationForm
      operation="project.save"
      label={project ? "Save project" : "Create project"}
    >
      <Hidden name="id" value={project?.id ?? ""} />
      <Field name="name" label="Project name" value={project?.name} />
      {project && <Hidden name="department_id" value={project.department_id} />}
      <label>
        Department
        <select
          name="department_id"
          defaultValue={project?.department_id}
          disabled={!!project}
        >
          {data.departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Status
        <select name="status" defaultValue={project?.status ?? "planning"}>
          <option value="planning">Planning</option>
          {project && (
            <>
              <option value="active">Active</option>
              <option value="complete">Complete</option>
              <option value="archived">Archived</option>
            </>
          )}
        </select>
      </label>
      <Field
        name="deadline"
        label="Deadline (WAT)"
        type="datetime-local"
        value={localTime(project?.deadline ?? null)}
        required={false}
      />
      {!project && <People data={data} />}
    </OperationForm>
  );
}
function MeetingEditor({
  data,
  meeting,
}: {
  data: WorkspaceData;
  meeting?: WorkspaceData["meetings"][number];
}) {
  return (
    <OperationForm
      operation="meeting.save"
      label={meeting ? "Save internal meeting" : "Schedule internal meeting"}
    >
      <Hidden name="id" value={meeting?.id ?? ""} />
      <Field name="title" label="Meeting title" value={meeting?.title} />
      <Field
        name="starts_at"
        label="Starts (WAT)"
        type="datetime-local"
        value={localTime(meeting?.starts_at ?? null)}
      />
      <Field
        name="ends_at"
        label="Ends (WAT)"
        type="datetime-local"
        value={localTime(meeting?.ends_at ?? null)}
      />
      {!meeting && <People data={data} />}
    </OperationForm>
  );
}
