"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Person, ReadConversation } from "./chat-controls";
import { MessageAttachment } from "./attachments/message-attachment";
import { MessageActions } from "./message-actions";
import { VoiceNote } from "./voice-note";
import { mentionId, mentionParts } from "./mentions";
import { isSticker, stickers } from "./media";
import type { ConnectMessage, ConnectProfile } from "./model";

const dayKey = new Intl.DateTimeFormat("sv-SE", { timeZone: "Africa/Lagos" });
const fullDate = new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeZone: "Africa/Lagos" });
const clock = new Intl.DateTimeFormat("en-GB", { timeStyle: "short", timeZone: "Africa/Lagos" });

function mergeMessages(existing: ConnectMessage[], incoming: ConnectMessage[]) {
  const byId = new Map(existing.map((message) => [message.id, message]));
  for (const message of incoming) {
    const existing = byId.get(message.id);
    const current = existing?.deleted_at ?? existing?.edited_at ?? "";
    const next = message.deleted_at ?? message.edited_at ?? "";
    if (next >= current) byId.set(message.id, message);
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

type Batch = { messages: ConnectMessage[]; hasOlder: boolean };

export function ChatHistory({ conversation, latest, members, userId, general, unread, visible, today, yesterday }: {
  conversation: string;
  latest: Batch;
  members: ConnectProfile[];
  userId: string;
  general: boolean;
  unread: number;
  visible: boolean;
  today: string;
  yesterday: string;
}) {
  const router = useRouter();
  const [history, setHistory] = useState(() => ({
    latest, messages: latest.messages, hasOlder: latest.hasOlder,
  }));
  if (history.latest !== latest) {
    setHistory({
      latest,
      messages: mergeMessages(history.messages, latest.messages),
      hasOlder: history.messages[0]?.id < (latest.messages[0]?.id ?? 0) ? history.hasOlder : latest.hasOlder,
    });
  }

  const [atBottom, setAtBottom] = useState(true);
  const [seen, setSeen] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null);
  const anchor = useRef<{ element: HTMLElement; top: number } | null>(null);
  const newest = history.messages.at(-1)?.id;

  useEffect(() => () => request.current?.abort(), []);

  const refreshMessage = useCallback(async (id: string) => {
    const url = "/dashboard/connect/history?" + new URLSearchParams({ chat: conversation, message: id });
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok || response.redirected) return;
      const updated: ConnectMessage = await response.json();
      setHistory((current) => current.messages.some((item) => item.id === updated.id)
        ? { ...current, messages: mergeMessages(current.messages, [updated]) } : current);
    } catch {
      // The next successful update or refresh can retry the request.
    }
  }, [conversation]);

  const refreshLatest = useCallback(async () => {
    const url = "/dashboard/connect/history?" + new URLSearchParams({ chat: conversation });
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.status === 401 || response.status === 404 || response.redirected) {
        router.replace("/dashboard/connect");
        return;
      }
      if (!response.ok) return;
      const batch: Batch = await response.json();
      setHistory((current) => ({ ...current, messages: mergeMessages(current.messages, batch.messages), hasOlder: batch.hasOlder }));
    } catch {
      // A later realtime event or reconnect refresh can retry the request.
    }
  }, [conversation, router]);

  useEffect(() => {
    const source = new EventSource("/dashboard/connect/events?chat=" + encodeURIComponent(conversation));
    const update = (event: MessageEvent<string>) => { void refreshMessage(event.data); };
    const refresh = () => { void refreshLatest(); };
    const revoke = () => {
      source.close();
      router.replace("/dashboard/connect");
    };
    source.addEventListener("refresh", refresh);
    source.addEventListener("message-edit", update);
    source.addEventListener("access-revoked", revoke);
    return () => source.close();
  }, [conversation, refreshLatest, refreshMessage, router]);

  useLayoutEffect(() => {
    const panel = viewport.current;
    if (!panel || !visible) return;
    if (anchor.current) {
      panel.scrollTop += anchor.current.element.getBoundingClientRect().top - anchor.current.top;
      anchor.current = null;
    } else if (atBottom) {
      panel.scrollTop = panel.scrollHeight;
    }
  }, [history.messages, atBottom, visible]);

  async function loadOlder() {
    const oldest = history.messages[0]?.id;
    if (!oldest || !history.hasOlder || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(false);
    try {
      const url = "/dashboard/connect/history?" + new URLSearchParams({ chat: conversation, before: String(oldest) });
      const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
      if (!response.ok || response.redirected) throw new Error("History unavailable");
      const batch: Batch = await response.json();
      const panel = viewport.current;
      if (panel) {
        const panelTop = panel.getBoundingClientRect().top;
        const element = Array.from(panel.querySelectorAll<HTMLElement>("[data-message]"))
          .find((message) => message.getBoundingClientRect().bottom > panelTop);
        if (element) anchor.current = { element, top: element.getBoundingClientRect().top };
      }
      setHistory((current) => ({
        ...current, messages: mergeMessages(current.messages, batch.messages), hasOlder: batch.hasOlder,
      }));
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  function onScroll() {
    const panel = viewport.current;
    if (!panel || !visible) return;
    const nearBottom = panel.scrollHeight - panel.clientHeight - panel.scrollTop < 48;
    if (atBottom && !nearBottom) setSeen(newest ?? 0);
    setAtBottom(nearBottom);
    if (!nearBottom && panel.scrollTop < 32 && !error) void loadOlder();
  }

  const profiles = new Map(members.map((member) => [member.user_id, member]));

  return (
    <div className="eba-connect__timeline">
      {visible && atBottom && <ReadConversation conversation={conversation} through={newest} unread={unread} />}
      <div className="eba-connect__history" ref={viewport} onScroll={onScroll} tabIndex={0} aria-label="Message history">
        {history.hasOlder && (
          <button type="button" className="eba-connect__older" onClick={loadOlder} disabled={loading}>
            {loading ? "Loading earlier messages…" : error ? "Could not load messages. Retry" : "Load earlier messages"}
          </button>
        )}
        {!history.messages.length ? <p>No messages yet</p> : (
          <ol className="eba-connect__messages">
            {history.messages.map((message, index) => {
              const date = new Date(message.sent_at);
              const day = dayKey.format(date);
              const previous = history.messages[index - 1];
              const separator = !previous || dayKey.format(new Date(previous.sent_at)) !== day;
              const own = message.sender_id === userId;
              const incomingGroup = general && !own;
              const showSender = incomingGroup && (separator || previous?.sender_id !== message.sender_id);
              const sender = profiles.get(message.sender_id);
              const audio = "/dashboard/connect/audio/" + message.id;
              return (
                <Fragment key={message.id}>
                  {separator && <li className="eba-connect__date"><time dateTime={day}>
                    {day === today ? "Today" : day === yesterday ? "Yesterday" : fullDate.format(date)}
                  </time></li>}
                  <li data-message={message.id} data-own={own} data-kind={message.kind} data-group={incomingGroup}>
                    {incomingGroup && <div className="eba-connect__bubble-avatar">
                      {showSender && <Person profile={sender} isSelf={false} avatarOnly />}
                    </div>}
                    <div className="eba-connect__bubble">
                      {showSender && <strong className="eba-connect__bubble-name">{sender?.display_name ?? "Former member"}</strong>}
                      {message.deleted_at ? <p className="eba-connect__deleted">Message deleted</p> :
                        message.kind === "photo" || message.kind === "document" ? (
                        <MessageAttachment message={message} />
                      ) : message.kind === "voice" ? (
                        <VoiceNote src={audio} />
                      ) : message.kind === "sticker" && isSticker(message.body) ? (
                        <p className="eba-connect__sticker" role="img" aria-label={stickers[message.body].label}>{stickers[message.body].glyph}</p>
                      ) : <p>{mentionParts(message.body).map((part, partIndex) => {
                        const id = mentionId(part);
                        return id ? <strong className="eba-connect__mention" key={partIndex}>@{profiles.get(id)?.display_name ?? "Former member"}</strong> : part;
                      })}</p>}
                      <footer className="eba-connect__bubble-meta">
                        <time dateTime={message.sent_at}>{clock.format(date)}{message.edited_at && !message.deleted_at ? " · Edited" : ""}</time>
                        {own && !message.deleted_at && <MessageActions message={message} profiles={profiles}
                          onChange={() => { void refreshMessage(String(message.id)); }} />}
                      </footer>
                    </div>
                  </li>
                </Fragment>
              );
            })}
          </ol>
        )}
      </div>
      {!atBottom && (newest ?? 0) > seen && (
        <button type="button" className="eba-connect__jump" onClick={() => setAtBottom(true)}>↓ New messages</button>
      )}
    </div>
  );
}
