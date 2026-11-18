"use client";

import { useState, type ReactNode } from "react";
import type { RecognitionNomination } from "./award-decision";

export function NomineeInitials({ name }: { name: string }) {
  return <span className="recognition-avatar" aria-hidden="true">{name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("")}</span>;
}

function supportingLink(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function RecognitionWorkspace({ nominations, children }: { nominations: RecognitionNomination[]; children: ReactNode }) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(nominations[0]?.nominee_id ?? "");
  const filtered = nominations.filter((nominee) => nominee.nominee_name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const nominee = nominations.find((entry) => entry.nominee_id === selected);
  const link = nominee ? supportingLink(nominee.evidence_url) : null;

  return <section className="recognition-workspace" aria-labelledby="recognition-nominations">
    <header className="recognition-workspace__heading"><h2 id="recognition-nominations">Nominations <span>· {nominations.length}</span></h2></header>
    <div className="recognition-workspace__columns">
      <aside className="recognition-roster" aria-label="Nominees">
        <div className="recognition-roster__search"><label className="sr-only" htmlFor="nominee-search">Search nominees by name</label><input id="nominee-search" type="search" placeholder="Search nominee name" value={search} onChange={(event) => setSearch(event.target.value)} /><p>{filtered.length} {filtered.length === 1 ? "nominee" : "nominees"}</p></div>
        <ul>{filtered.map((entry) => <li key={entry.nominee_id}><button type="button" aria-pressed={selected === entry.nominee_id} onClick={() => setSelected(entry.nominee_id)}><NomineeInitials name={entry.nominee_name} /><span>{entry.nominee_name}</span></button></li>)}</ul>
        {!filtered.length && <p className="recognition-empty">{nominations.length ? "No matching nominees." : "No nominations for this week."}</p>}
      </aside>
      <section className="recognition-evidence" aria-label="Nomination evidence">
        {nominee ? <>
          <header className="recognition-evidence__person"><NomineeInitials name={nominee.nominee_name} /><div><p className="recognition-kicker">Nomination evidence</p><h2>{nominee.nominee_name}</h2></div></header>
          <dl>{([["What they did", nominee.what_they_did], ["Who benefited", nominee.who_benefited], ["What changed", nominee.what_changed]] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          {link && <a className="recognition-support" href={link} target="_blank" rel="noopener noreferrer">Open supporting link <span aria-hidden="true">↗</span></a>}
        </> : <div className="recognition-evidence__empty"><span aria-hidden="true">✧</span><h2>Every contribution matters.</h2><p>Nomination evidence will appear here when nominations are available for this week.</p></div>}
      </section>
      <aside className="recognition-review" aria-labelledby="recognition-reviews">{children}</aside>
    </div>
  </section>;
}
