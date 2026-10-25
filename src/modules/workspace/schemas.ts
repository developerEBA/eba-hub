import { z } from "zod";
export const taskInput = z.object({
  title: z.string().trim().min(1).max(200),
  projectId: z.uuid(),
  assigneeId: z.uuid().nullable(),
  dueAt: z.iso.datetime().nullable(),
});
export const messageInput = z.object({
  conversationId: z.uuid(),
  body: z.string().trim().min(1).max(10000),
});
export const recognitionInput = z.object({
  recipientId: z.uuid(),
  message: z.string().trim().min(1).max(2000),
});
