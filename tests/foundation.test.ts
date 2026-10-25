import test from "node:test";
import assert from "node:assert/strict";
import {
  isWorkspaceRole,
  canAdminister,
  canManage,
} from "../src/modules/auth/permissions.ts";
import {
  taskInput,
  messageInput,
  recognitionInput,
} from "../src/modules/workspace/schemas.ts";
test("unknown roles fail closed", () => {
  for (const value of [null, undefined, "owner", "ADMIN", {}, 1])
    assert.equal(isWorkspaceRole(value), false);
});
test("administration requires admin and management excludes department leads", () => {
  assert.equal(canAdminister("admin"), true);
  for (const role of ["employee", "department_lead", "management"] as const)
    assert.equal(canAdminister(role), false);
  assert.equal(canManage("management"), true);
  assert.equal(canManage("department_lead"), false);
  assert.equal(canManage("employee"), false);
});
test("task validation rejects empty titles and malformed identifiers", () => {
  assert.equal(
    taskInput.safeParse({
      title: "  ",
      projectId: "bad",
      assigneeId: null,
      dueAt: null,
    }).success,
    false,
  );
  const valid = taskInput.parse({
    title: "  Review brief ",
    projectId: "d8d754e1-495c-4210-bf75-561623d337d1",
    assigneeId: null,
    dueAt: null,
  });
  assert.equal(valid.title, "Review brief");
});
test("messages and appreciation are bounded and require recipients", () => {
  assert.equal(
    messageInput.safeParse({ conversationId: "bad", body: "hello" }).success,
    false,
  );
  assert.equal(
    recognitionInput.safeParse({
      recipientId: "d8d754e1-495c-4210-bf75-561623d337d1",
      message: "x".repeat(2001),
    }).success,
    false,
  );
  assert.equal(
    messageInput.safeParse({
      conversationId: "d8d754e1-495c-4210-bf75-561623d337d1",
      body: "  ",
    }).success,
    false,
  );
});
