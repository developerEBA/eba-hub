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

export const departmentRooms = [
  { id: "00000000-0000-4000-8000-000000000002", name: "Graphics" },
  { id: "00000000-0000-4000-8000-000000000003", name: "Development" },
  { id: "00000000-0000-4000-8000-000000000004", name: "Communications" },
  { id: "00000000-0000-4000-8000-000000000005", name: "Events" },
  { id: "00000000-0000-4000-8000-000000000006", name: "Marketing" },
] as const;
