"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  assignment,
  companyEmail,
  departments,
  type AccessData,
  type StaffRow,
} from "../../../lib/staff-access/model";
function DeactivateConfirmation({
  name,
  pending,
  onCancel,
  onConfirm,
}: {
  name: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  return (
    <dialog
      className="staff-confirm"
      ref={ref}
      aria-labelledby="staff-confirm-title"
      aria-describedby="staff-confirm-detail"
      onCancel={(e) => {
        e.preventDefault();
        if (!pending) onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const buttons =
            event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
          first = buttons[0],
          last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <h3 id="staff-confirm-title">Deactivate {name}?</h3>
      <p id="staff-confirm-detail">
        Their Hub access will be disabled. Messages, plans, approvals and history will be preserved.
      </p>
      <button type="button" autoFocus disabled={pending} onClick={onCancel}>
        Keep access
      </button>
      <button type="button" className="staff-primary" disabled={pending} onClick={onConfirm}>
        {pending ? "Saving…" : "Deactivate access"}
      </button>
    </dialog>
  );
}
function DeleteMemberConfirmation({
  name,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  name: string;
  pending: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  return (
    <dialog
      className="staff-confirm"
      ref={ref}
      aria-labelledby="staff-delete-title"
      aria-describedby="staff-delete-detail"
      onCancel={(e) => {
        e.preventDefault();
        if (!pending) onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const buttons =
            event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
          first = buttons[0],
          last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <h3 id="staff-delete-title">Delete {name} from EBA Hub?</h3>
      <p id="staff-delete-detail">
        This removes their staff membership and department assignments, so staff dashboard access
        ends. Their sign-in identity, client access, messages, plans, approvals and history are
        preserved. They can be invited again later.
      </p>
      {error && (
        <p className="staff-confirm-error" role="alert">
          {error}
        </p>
      )}
      <button type="button" autoFocus disabled={pending} onClick={onCancel}>
        Cancel
      </button>
      <button type="button" className="staff-delete-button" disabled={pending} onClick={onConfirm}>
        {pending ? "Deleting…" : "Delete from Hub"}
      </button>
    </dialog>
  );
}
function AssignmentFields({ person }: { person?: StaffRow }) {
  return (
    <>
      <label>
        Name
        <input name="name" required maxLength={120} defaultValue={person?.name} />
      </label>
      <label>
        Assigned role
        <select name="role" defaultValue={person?.role ?? "staff"}>
          <option value="staff">Employee</option>
          <option value="hod">HOD</option>
        </select>
      </label>
      {person ? (
        <fieldset className="staff-department-choices">
          <legend>Authorized departments</legend>
          {Object.entries(departments).map(([key, name]) => (
            <label key={key}>
              <input
                type="checkbox"
                name="departments"
                value={key}
                defaultChecked={person.departments.includes(key)}
              />
              {name}
            </label>
          ))}
        </fieldset>
      ) : (
        <label>
          Department
          <select name="department" required defaultValue="">
            <option value="" disabled>
              Select department
            </option>
            {Object.entries(departments).map(([key, name]) => (
              <option value={key} key={key}>
                {name}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}
const roleName = (role: string) =>
  ({ ceo: "CEO", admin: "Admin", staff: "Employee", hod: "HOD" })[role] ?? role;
export function StaffAccessCard({ role }: { role: "CEO" | "Admin" }) {
  const [data, setData] = useState<AccessData | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(""),
    [department, setDepartment] = useState(""),
    [status, setStatus] = useState(""),
    [link, setLink] = useState(""),
    [confirm, setConfirm] = useState<StaffRow | null>(null),
    [deleteConfirm, setDeleteConfirm] = useState<StaffRow | null>(null);
  const admin = role === "Admin";
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const r = await fetch("/dashboard/settings/staff", { cache: "no-store", signal }),
        value = await r.json();
      if (!r.ok) throw Error(value.error ?? "Directory unavailable");
      if (!signal?.aborted) {
        setData(value);
        setError("");
      }
    } catch {
      if (!signal?.aborted) setError("Staff directory could not load. Please try again.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  function retry() {
    setLoading(true);
    void refresh();
  }
  useEffect(() => {
    const c = new AbortController(),
      timer = setTimeout(() => void refresh(c.signal), 0);
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [refresh]);
  async function command(body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setNotice("");
    setError("");
    setLink("");
    try {
      const r = await fetch("/dashboard/settings/staff", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(25000),
        }),
        result = await r.json();
      if (!r.ok) throw Error(result.error ?? "Change could not be saved.");
      setNotice(result.message);
      if (result.link) setLink(result.link);
      setConfirm(null);
      setDeleteConfirm(null);
      await refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Change could not be saved. Refresh before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  function submit(form: HTMLFormElement, person?: StaffRow) {
    const formData = new FormData(form),
      values: Record<string, unknown> = Object.fromEntries(formData);
    if (person)
      values.departments = formData
        .getAll("departments")
        .filter((value): value is string => typeof value === "string");
    try {
      const fields = assignment(values);
      const email = person ? undefined : companyEmail(values.email);
      void command(
        person
          ? { action: "update", id: person.id, version: person.version, ...fields }
          : { action: "invite", requestId: crypto.randomUUID(), email, ...fields },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check the form.");
    }
  }
  async function copyLink() {
    try {
      if (!navigator.clipboard?.writeText) throw Error("Clipboard unavailable");
      await navigator.clipboard.writeText(link);
      setNotice("Invitation link copied. Share only with the intended recipient.");
    } catch {
      setNotice("Select the link and copy it manually.");
    }
  }
  const matches = (name: string, email: string, depts: string[], state: string) =>
    `${name} ${email}`.toLowerCase().includes(search.toLowerCase().trim()) &&
    (!department || depts.includes(department)) &&
    (!status || state === status);
  const members =
    data?.members.filter((p) => matches(p.name, p.email, p.departments, p.status)) ?? [];
  const invites =
    data?.invitations.filter((p) => matches(p.name, p.email, [p.department], p.status)) ?? [];
  return (
    <section className="staff-access" aria-labelledby="staff-access-title">
      <header>
        <div>
          <h2 id="staff-access-title">Staff access</h2>
          <p>Manage your team’s roles and access.</p>
        </div>
        <span className="staff-pill">{admin ? "Admin management" : "CEO · View only"}</span>
      </header>
      <p className="staff-coming-soon">
        Employee dashboards remain unavailable. Active HOD accounts with verified department
        assignments can use their department workspace.
      </p>
      {loading && <p role="status">Loading staff…</p>}
      {error && (
        <div className="staff-notice">
          <p role="alert">{error}</p>
          <button type="button" disabled={busy || loading} onClick={retry}>
            Retry
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className="staff-notice">
          {notice}
        </p>
      )}
      {link && (
        <div className="staff-copy">
          <label>
            Invitation link · copy now
            <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
          </label>
          <button type="button" onClick={() => void copyLink()}>
            Copy invitation link
          </button>
          <small>
            This link is shown only now. It expires in 48 hours, or sooner if its Auth verification
            link expires.
          </small>
        </div>
      )}
      {admin && (
        <details className="staff-invite">
          <summary>＋ Invite staff</summary>
          <p>Invitations use privately shared links</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(e.currentTarget);
            }}
          >
            <fieldset disabled={busy || loading || !data}>
              <legend>Existing company email</legend>
              <label>
                Company email
                <input
                  type="email"
                  name="email"
                  required
                  maxLength={254}
                  placeholder="name@enibrand.com"
                  autoComplete="off"
                />
              </label>
              <AssignmentFields />
              <button type="submit" className="staff-primary">
                {busy ? "Creating…" : "Create invitation link"}
              </button>
            </fieldset>
          </form>
        </details>
      )}
      <div className="staff-filters">
        <label>
          Search staff
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or company email"
          />
        </label>
        <label>
          Department
          <select value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option value="">All departments</option>
            {Object.entries(departments).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {["active", "inactive", "pending", "accepted", "revoked", "expired", "failed"].map(
              (s) => (
                <option key={s}>{s}</option>
              ),
            )}
          </select>
        </label>
        <button type="button" disabled={busy} onClick={() => void refresh()}>
          Refresh
        </button>
      </div>
      {!loading && data && (
        <>
          <div className="staff-table-wrap">
            <table>
              <caption>
                Staff directory · {members.length} matching account{members.length === 1 ? "" : "s"}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Assignment</th>
                  <th scope="col">Account / membership</th>
                  <th scope="col">Hub access</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {members.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.name}</strong>
                      <small>{p.email}</small>
                    </td>
                    <td>
                      {roleName(p.role)}
                      <small>
                        {p.departments
                          .map((d) => departments[d as keyof typeof departments] ?? d)
                          .join(", ") || "No department assigned"}
                      </small>
                    </td>
                    <td>
                      {p.account_status}
                      <small>Membership {p.status}</small>
                    </td>
                    <td>
                      <span className="staff-pill" data-active={p.hub_access}>
                        {p.hub_access
                          ? "Active"
                          : p.role === "staff"
                            ? "Employee rollout blocked"
                            : "Inactive"}
                      </span>
                    </td>
                    <td>
                      {admin && ["staff", "hod"].includes(p.role) ? (
                        <div className="staff-row-actions">
                          <details>
                            <summary>Edit assignment</summary>
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                submit(e.currentTarget, p);
                              }}
                            >
                              <fieldset disabled={busy}>
                                <legend className="staff-sr">Assignment for {p.name}</legend>
                                <AssignmentFields person={p} />
                                <button type="submit">Save assignment</button>
                              </fieldset>
                            </form>
                          </details>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              p.status === "active"
                                ? setConfirm(p)
                                : void command({
                                    action: "reactivate",
                                    id: p.id,
                                    version: p.version,
                                  })
                            }
                          >
                            {p.status === "active" ? "Deactivate access" : "Reactivate membership"}
                          </button>
                          <button
                            type="button"
                            className="staff-delete-trigger"
                            disabled={busy}
                            onClick={() => {
                              setError("");
                              setDeleteConfirm(p);
                            }}
                          >
                            Delete from Hub
                          </button>
                        </div>
                      ) : (
                        <small>
                          {["ceo", "admin"].includes(p.role) ? "Protected account" : "View only"}
                        </small>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!members.length && <p className="staff-empty">No staff accounts match these filters.</p>}
          <h3>Invitations</h3>
          {!invites.length ? (
            <p className="staff-empty">No invitations match these filters.</p>
          ) : (
            <ul className="staff-invitations">
              {invites.map((i) => (
                <li key={i.id}>
                  <div>
                    <strong>{i.name}</strong>
                    <small>
                      {i.email} · {roleName(i.role)} ·{" "}
                      {departments[i.department as keyof typeof departments]}
                    </small>
                    <small>
                      {i.account_status ?? "Account status unavailable"} · No Hub access from this
                      invitation
                    </small>
                    <small>
                      Expires{" "}
                      {new Intl.DateTimeFormat("en-GB", {
                        timeZone: "Africa/Lagos",
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(i.expires_at))}{" "}
                      · Lagos
                    </small>
                  </div>
                  <span className="staff-pill">{i.status}</span>
                  {admin && i.status === "pending" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void command({ action: "revoke", id: i.id })}
                    >
                      Revoke invitation
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {data.truncated && (
            <p role="status">
              Showing the first 500 accounts and most recent 500 invitations. Filters apply to this
              loaded set.
            </p>
          )}
          <details className="staff-audit">
            <summary>Recent access audit · latest 50</summary>
            {data.audit.length ? (
              <ul>
                {data.audit.map((a) => (
                  <li key={a.id}>
                    <strong>{a.action.replaceAll("_", " ")}</strong> · {a.target}
                    <small>
                      Actor {a.actor} ·{" "}
                      {new Intl.DateTimeFormat("en-GB", {
                        timeZone: "Africa/Lagos",
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(a.created_at))}{" "}
                      Lagos
                    </small>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No staff-access changes recorded yet.</p>
            )}
          </details>
        </>
      )}
      {confirm && (
        <DeactivateConfirmation
          name={confirm.name}
          pending={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() =>
            void command({
              action: "deactivate",
              id: confirm.id,
              version: confirm.version,
              confirm: true,
            })
          }
        />
      )}
      {deleteConfirm && (
        <DeleteMemberConfirmation
          name={deleteConfirm.name}
          pending={busy}
          error={error}
          onCancel={() => {
            setDeleteConfirm(null);
            setError("");
          }}
          onConfirm={() =>
            void command({
              action: "delete_member",
              id: deleteConfirm.id,
              version: deleteConfirm.version,
              confirm: true,
            })
          }
        />
      )}
    </section>
  );
}
