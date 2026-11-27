"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { markClientMessagesRead, sendClientMessage } from "./actions";

export function ConversationComposer({
  side,
  clientId,
}: {
  side: "staff" | "client";
  clientId: string;
}) {
  const [message, setMessage] = useState("");
  const requestId = useRef<string | null>(null);
  const [state, send, pending] = useActionState(
    async (previous: { error?: string }, form: FormData) => {
      requestId.current ??= crypto.randomUUID();
      form.set("requestId", requestId.current);
      const result = await sendClientMessage(
        side,
        side === "staff" ? clientId : null,
        previous,
        form,
      );
      if (result.sent) {
        requestId.current = null;
        setMessage("");
      }
      return result;
    },
    {},
  );

  return (
    <form className="eba-client-chat__composer" action={send}>
      <label htmlFor="client-chat-message">Your message</label>
      <textarea
        value={message}
        onChange={(event) => {
          requestId.current = null;
          setMessage(event.target.value);
        }}
        id="client-chat-message"
        name="message"
        rows={3}
        maxLength={2000}
        required
        readOnly={pending}
        placeholder="Write a message…"
      />
      <button type="submit" disabled={pending}>
        {pending ? "Sending…" : state.error ? "Retry sending" : "Send message"}
      </button>
      {state.error && <p role="alert">{state.error}</p>}
    </form>
  );
}

export function ClientMessageRefresh() {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = window.setInterval(refresh, 5000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);
  return null;
}

export function ClientMessageReadReceipt({
  side,
  clientId,
  messageIds,
}: {
  side: "staff" | "client";
  clientId: string;
  messageIds: string;
}) {
  useEffect(() => {
    if (!messageIds) return;
    const mark = () => {
      if (document.visibilityState === "visible") {
        void markClientMessagesRead(side, clientId, messageIds.split(",").map(Number)).catch(
          () => undefined,
        );
      }
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [side, clientId, messageIds]);
  return null;
}
