export const generalId = "00000000-0000-4000-8000-000000000001";

export function isConversationId(value: unknown): value is string {
  return typeof value === "string" && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value);
}

export type ConnectProfile = { user_id: string; display_name: string; avatar_url: string | null };
export type UnreadConversation = { conversation_id: string; unread_count: number };
export type ConnectMessage = {
  id: number;
  body: string;
  sender_id: string;
  sent_at: string;
  kind: string;
  attachment_name: string | null;
  attachment_size: number | null;
  attachment_caption: string | null;
  edited_at: string | null;
  deleted_at: string | null;
};

export const departmentNames: Record<string, string> = {
  graphics: "Graphics", development: "Development", communications: "Communications",
  events: "Events", marketing: "Marketing",
};

export type ConnectRoom = {
  id: string;
  room_type: "general" | "dm" | "department" | "legacy_shared";
  department: string | null;
  archived_at: string | null;
  member_low: string | null;
  member_high: string | null;
};
