export type Employee = { id: string; display_name: string; role: string };
export type Project = {
  id: string;
  name: string;
  department_id: string;
  status: string;
  deadline: string | null;
  created_by: string;
};
export type Task = {
  id: string;
  project_id: string;
  title: string;
  assignee_id: string | null;
  created_by: string | null;
  status: string;
  priority: string;
  due_at: string | null;
};
export type Conversation = { id: string; title: string; kind: string };
export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  kind: string;
  attachment_id: string | null;
};
export type Meeting = {
  id: string;
  title: string;
  organizer_id: string;
  starts_at: string;
  ends_at: string;
  meet_url: string | null;
  google_event_id: string | null;
};
export type Approval = {
  id: string;
  requester_id: string;
  title: string;
  body: string;
  status: string;
  kind: string;
  reviewer_id: string | null;
  created_at: string;
};
export type Focus = { id: string; title: string; complete: boolean };
export type Notification = {
  id: string;
  title: string;
  read_at: string | null;
  created_at: string;
};
export type Announcement = {
  id: string;
  title: string;
  body: string;
  author_id: string;
  created_at: string;
};
export type Recognition = {
  id: string;
  recipient_id: string;
  sender_id: string;
  message: string;
  created_at: string;
};
export type FileRecord = {
  id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  path: string;
  conversation_id: string | null;
};
export type Period = {
  id: string;
  title: string;
  starts_on: string;
  ends_on: string;
};
export type Counts = {
  projects: number;
  tasks: number;
  meetings: number;
  messages: number;
  notifications: number;
  approvals: number;
};
