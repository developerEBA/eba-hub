import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { requireDashboardAccess } from "../access";
import { DashboardShell } from "../dashboard-shell";
import { DashboardIcon } from "../navigation";
import DashboardLoading from "../loading";
import { ClientConversation } from "../../client-conversation/conversation";
import { ClientForm } from "./client-form";
import { ClientFileCleanupForm, DeleteClientForm } from "./delete-client-form";
import { ClientPortalManagement } from "./client-portal-management";
import { clientDirectoryPath, clientLimits, type ClientRecord, type ClientSummary } from "./directory";

export type Query = Record<string, string | string[] | undefined>;
const pageSize = 25;
const tabs = { details: "Details", work: "Shared Work", access: "Access", activity: "Activity", messages: "Messages" } as const;

export function ClientsWorkspace({ searchParams, id }: { searchParams: Promise<Query>; id?: string }) {
  return <Suspense fallback={<DashboardLoading />}><Workspace searchParams={searchParams} id={id} /></Suspense>;
}

function Monogram({ name }: { name: string }) {
  return <span className="eba-client-workspace__monogram" aria-hidden="true">{name.trim().split(/\s+/).slice(0, 2).map((part) => Array.from(part)[0]).join("").toUpperCase()}</span>;
}

async function Workspace({ searchParams, id }: { searchParams: Promise<Query>; id?: string }) {
  const { client, role } = await requireDashboardAccess();
  const params = await searchParams;
  const search = typeof params.q === "string" ? params.q.trim().slice(0, clientLimits.name) : "";
  const page = typeof params.page === "string" && /^[1-9]\d{0,3}$/.test(params.page) ? Number(params.page) : 1;
  const context = { q: search || undefined, page: page > 1 ? page : undefined };
  const tab = params.tab === "messages" || params.tab === "work" || params.tab === "access" || params.tab === "activity" ? params.tab : "details";
  const admin = role === "Admin";
  if (id === "new" && !admin) redirect(clientDirectoryPath);
  const creating = id === "new";
  const editing = admin && params.edit === "1";
  const listing = client.rpc("search_client_directory", { p_query: search, p_offset: (page - 1) * pageSize });
  const loadRecord = (selected: string) => client.from("client_directory")
    .select("id,name,primary_contact,email,phone,notes").eq("id", selected).maybeSingle<ClientRecord>();
  const [list, direct, cleanup] = await Promise.all([
    listing,
    id && id !== "new" ? loadRecord(id) : null,
    admin && !id ? client.from("client_file_cleanup").select("object_path").limit(1) : null,
  ]);
  const rows: ClientSummary[] = Array.isArray(list.data) ? list.data : [];
  const visible = rows.slice(0, pageSize);
  const detail = direct ?? (!creating && visible[0] ? await loadRecord(visible[0].id) : null);
  if (direct && !direct.data && !direct.error) notFound();
  const record = detail?.data;
  const [portalAccess, unread] = record ? await Promise.all([
    client.from("client_portal_access").select("user_id", { count: "exact", head: true }).eq("client_id", record.id).is("revoked_at", null),
    client.rpc("client_unread_message_count", { p_client: record.id }),
  ]) : [null, null];
  const href = (selected?: string, query?: { tab?: string; edit?: string; page?: number }) =>
    ({ pathname: selected ? clientDirectoryPath + "/" + selected : clientDirectoryPath, query: { ...context, ...query } });

  return (
    <DashboardShell role={role} section="clients">
      <section className="eba-clients eba-client-workspace" aria-labelledby="clients-title" data-client-open={Boolean(id)}>
        <header className="eba-clients__header">
          <div><h1 id="clients-title">Clients</h1><p>Find client contacts, shared work, and portal access.</p></div>
          {admin && <Link className="eba-clients__primary" href={href("new")}><span aria-hidden="true">＋ </span>Add client</Link>}
        </header>
        {Boolean(cleanup?.data?.length) && <ClientFileCleanupForm />}
        <div className="eba-client-workspace__grid">
          <aside className="eba-client-workspace__roster" aria-label="Client directory" id="client-directory">
            <h2 className="eba-client-workspace__roster-title">Directory</h2>
            <form action={clientDirectoryPath} className="eba-clients__search">
              <label className="sr-only" htmlFor="client-search">Search clients</label>
              <div>
                <input type="search" name="q" id="client-search" maxLength={clientLimits.name} defaultValue={search} key={search} placeholder="Search clients" />
                <button className="eba-client-workspace__search-button" type="submit" aria-label="Search clients">
                  <DashboardIcon path="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm5 12 5 5" />
                </button>
                {search && <Link href={clientDirectoryPath}>Clear</Link>}
              </div>
            </form>
            <div className="eba-clients__list">
              {list.error ? <p role="status">Clients could not be loaded.</p> : visible.length ? (
                <ul>{visible.map((entry) => (
                  <li key={entry.id}>
                    <Link href={href(entry.id, { tab })} aria-current={record?.id === entry.id ? "true" : undefined}>
                      <Monogram name={entry.name} />
                      <span><strong>{entry.name}</strong>{entry.primary_contact && <small>{entry.primary_contact}</small>}</span>
                      <span className="eba-client-workspace__chevron" aria-hidden="true">›</span>
                    </Link>
                  </li>
                ))}</ul>
              ) : <p>{search ? "No clients match your search." : page > 1 ? "No clients on this page." : "No clients added yet."}</p>}
            </div>
            {!list.error && (page > 1 || rows.length > pageSize) && (
              <nav className="eba-clients__pagination" aria-label="Client directory pages">
                {page > 1 && <Link href={href(undefined, { page: page - 1 })}>← Previous</Link>}
                {rows.length > pageSize && page < 9999 && <Link href={href(undefined, { page: page + 1 })}>Next →</Link>}
              </nav>
            )}
          </aside>
          <section className="eba-client-workspace__profile" id="client-profile" aria-label="Client workspace">
            {id && <Link className="eba-client-workspace__back" href={href()}>← Back to clients</Link>}
            {creating ? <div className="eba-client-workspace__body"><h2>New client</h2><ClientForm /></div> : record ? (
              <>
                <header className="eba-client-workspace__masthead">
                  <Monogram name={record.name} />
                  <div className="eba-client-workspace__identity">
                    <h2>{record.name}</h2>
                    {record.primary_contact && <p>{record.primary_contact}</p>}
                    {portalAccess && !portalAccess.error && <span className="eba-client-workspace__portal-state" data-active={Boolean(portalAccess.count)}>
                      {portalAccess.count ? "Portal access granted" : "No active portal access"}
                    </span>}
                  </div>
                  <div className="eba-client-workspace__profile-actions">
                    {admin && !editing && <Link className="eba-clients__primary" href={href(record.id, { edit: "1" })}>Edit details</Link>}
                    {admin && <DeleteClientForm key={record.id} id={record.id} name={record.name} />}
                  </div>
                </header>
                <nav className="eba-client-workspace__tabs" aria-label="Client profile sections">
                  {(Object.keys(tabs) as (keyof typeof tabs)[]).map((key) => (
                    <Link key={key} href={href(record.id, { tab: key })} aria-current={!editing && key === tab ? "page" : undefined}>
                      {tabs[key]}
                      {key === "messages" && Number(unread?.data) > 0 && <span className="eba-client-chat__unread" aria-label={unread?.data + " unread"}>{unread?.data}</span>}
                    </Link>
                  ))}
                </nav>
                <div className="eba-client-workspace__body">
                  {editing ? <><h3>Edit client details</h3><ClientForm record={record} /></> : tab === "details" ? (
                    <>
                      <h3>Contact information</h3>
                      <dl className="eba-client-workspace__details">
                        <div><dt>Primary contact</dt><dd>{record.primary_contact ?? "Not provided"}</dd></div>
                        <div><dt>Email</dt><dd>{record.email ?? "Not provided"}</dd></div>
                        <div><dt>Phone</dt><dd>{record.phone ?? "Not provided"}</dd></div>
                        <div><dt>Internal notes</dt><dd>{record.notes ?? "No notes added."}</dd></div>
                      </dl>
                    </>
                  ) : tab === "messages" ? (
                    <><h3>Messages</h3><ClientConversation client={client} clientId={record.id} side="staff" canSend={admin}
                      baseUrl={clientDirectoryPath + "/" + record.id + "?" + new URLSearchParams({ tab: "messages", ...(search ? { q: search } : {}), ...(page > 1 ? { page: String(page) } : {}) })}
                      before={params.before} /></>
                  ) : <ClientPortalManagement client={client} clientId={record.id} role={role} tab={tab} />}
                </div>
              </>
            ) : <div className="eba-client-workspace__body"><h2>{detail?.error ? "Client unavailable" : "Client workspace"}</h2><p>{detail?.error ? "This client could not be loaded." : "Choose a client from the directory to see their profile."}</p></div>}
          </section>
        </div>
      </section>
    </DashboardShell>
  );
}
