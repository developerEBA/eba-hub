import type { requireHodDashboardAccess } from "../access";
import type { ConnectMessage } from "./model";

export const historyPageSize = 30;
export const messageFields = "id,body,sender_id,sent_at,kind,attachment_name,attachment_size,attachment_caption,edited_at,deleted_at";
const dayKey = new Intl.DateTimeFormat("sv-SE", { timeZone: "Africa/Lagos" });

// Called by the request-time page after it verifies dashboard access.
export function chatDayLabels() {
  const now = Date.now();
  return { today: dayKey.format(now), yesterday: dayKey.format(now - 86400000) };
}

export async function loadChatHistory(
  client: Awaited<ReturnType<typeof requireHodDashboardAccess>>["client"],
  conversation: string,
  before?: number,
) {
  let query = client.from("connect_messages")
    .select(messageFields)
    .eq("conversation_id", conversation).order("id", { ascending: false }).limit(historyPageSize + 1);
  if (before !== undefined) query = query.lt("id", before);
  const { data, error } = await query.returns<ConnectMessage[]>();
  return {
    messages: (data ?? []).slice(0, historyPageSize).reverse(),
    hasOlder: (data?.length ?? 0) > historyPageSize,
    error,
  };
}
