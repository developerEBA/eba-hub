"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { openDirectMessage, readConnectChat, sendConnectMessage } from "./actions";
import type { ConnectProfile } from "./model";
import { encodeMentions } from "./mentions";
import { DashboardIcon } from "../navigation";

function Avatar({ profile }: { profile: ConnectProfile | undefined }) {
  const [failed, setFailed] = useState(false);
  const initials = profile?.display_name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("") || "?";
  const url = profile?.avatar_url;
  return (
    <span className="eba-connect__avatar" aria-hidden="true">
      {url?.startsWith("https://") && !failed ? (
        <Image src={url} alt="" width={34} height={34} unoptimized referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : initials.toUpperCase()}
    </span>
  );
}

export function Person({ profile, isSelf, avatarOnly }: {
  profile: ConnectProfile | undefined;
  isSelf: boolean;
  avatarOnly?: boolean;
}) {
  const [error, action, pending] = useActionState(openDirectMessage, null);
  const name = profile?.display_name ?? "Former member";
  const identity = <><Avatar profile={profile} />{!avatarOnly && <><span>{name}</span>{isSelf && <small className="eba-connect__self">You</small>}</>}</>;
  if (!profile || isSelf) return <span className="eba-connect__person">{identity}</span>;

  return (
    <form action={action}>
      <input type="hidden" name="recipient" value={profile.user_id} />
      <button type="submit" className="eba-connect__person" disabled={pending} aria-label={`Open chat with ${name}`}>
        {identity}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

export function Members({ members, userId }: { members: ConnectProfile[]; userId: string }) {
  const [search, setSearch] = useState("");
  const matches = members.filter((member) => member.display_name.toLowerCase().includes(search.trim().toLowerCase()));
  return (
    <details className="eba-connect__members">
      <summary>
        <DashboardIcon path="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-4M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0zm4-4a4 4 0 0 1 0 8" />
        Members <span className="eba-connect__member-count">{members.length}</span>
      </summary>
      <div className="eba-connect__member-panel">
        <header><strong>EBA General members</strong><p>Select a teammate to start a private chat.</p></header>
        <label className="eba-connect__member-search">
          <span className="sr-only">Search members</span>
          <DashboardIcon path="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm5 12 5 5" />
          <input type="search" placeholder="Find a teammate" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        {matches.length ? (
          <ul>{matches.map((member) => <li key={member.user_id}><Person profile={member} isSelf={member.user_id === userId} /></li>)}</ul>
        ) : <p>No matching members.</p>}
      </div>
    </details>
  );
}

export function ConnectComposer({ conversation, body, setBody, members }: {
  conversation: string;
  body: string;
  setBody: (value: string) => void;
  members: ConnectProfile[];
}) {
  const retryId = useRef<string | null>(null);
  const tagged = useRef(new Map<string, string>());
  const [mentionOpen, setMentionOpen] = useState(false);
  const match = mentionOpen ? /(?:^|\s)@([^@\n]*)$/.exec(body) : null;
  const suggestions = match ? members.filter((member) =>
    member.display_name.toLowerCase().includes(match[1].trim().toLowerCase())).slice(0, 8) : [];
  const [error, action, sending] = useActionState(async (previous: string | null, form: FormData) => {
    retryId.current ??= crypto.randomUUID();
    form.set("clientId", retryId.current);
    form.set("body", encodeMentions(body, tagged.current));
    try {
      const result = await sendConnectMessage(previous, form);
      if (!result) {
        retryId.current = null;
        tagged.current.clear();
        setMentionOpen(false);
        setBody("");
      }
      return result;
    } catch {
      return "Message could not be sent. Try again.";
    }
  }, null);

  return (
    <form className="eba-connect__composer" action={action}>
      <input type="hidden" name="conversation" value={conversation} />
      <label htmlFor="connect-message" className="sr-only">Message</label>
      <div>
        <textarea id="connect-message" name="body" rows={1} required maxLength={4000}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && !suggestions.length) {
              event.preventDefault();
              if (!sending && body.trim()) event.currentTarget.form?.requestSubmit();
            }
          }}
          value={body} readOnly={sending} onChange={(event) => {
            retryId.current = null;
            setBody(event.target.value);
            setMentionOpen(true);
          }} />
        <button type="submit" disabled={sending}>{sending ? "Sending…" : "Send"}</button>
      </div>
      {suggestions.length > 0 && (
        <ul className="eba-connect__mentions" aria-label="Tag a teammate">
          {suggestions.map((member) => (
            <li key={member.user_id}>
              <button type="button" onClick={() => {
                tagged.current.set(member.display_name, member.user_id);
                retryId.current = null;
                setBody(body.slice(0, body.lastIndexOf("@")) + "@" + member.display_name + " ");
                setMentionOpen(false);
              }}>@{member.display_name}</button>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

export function ReadConversation({ conversation, through, unread }: {
  conversation: string;
  through: number | undefined;
  unread: number;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!through || !unread) return;
    let active = true;
    let reading = false;
    const mark = async () => {
      if (document.hidden || reading) return;
      reading = true;
      try {
        if (await readConnectChat(conversation, through) && active) router.refresh();
      } catch {
        // A later navigation or visibility change can retry the read receipt.
      } finally {
        reading = false;
      }
    };
    void mark();
    document.addEventListener("visibilitychange", mark);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", mark);
    };
  }, [conversation, through, unread, router]);

  return null;
}
