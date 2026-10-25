import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
const env = process.env;
const enabled =
  env.EBA_TEST_PROJECT_CONFIRMED === "isolated" &&
  [
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    env.EBA_TEST_MANAGER_JWT,
    env.EBA_TEST_EMPLOYEE_A_JWT,
    env.EBA_TEST_EMPLOYEE_B_JWT,
    env.EBA_TEST_OUTSIDER_JWT,
    env.EBA_TEST_DEPARTMENT_ID,
  ].every(Boolean);
test(
  "isolated Supabase: persistence, two sessions, counts and RLS",
  { skip: !enabled },
  async () => {
    const client = (jwt: string) =>
      createClient(
        env.NEXT_PUBLIC_SUPABASE_URL!,
        env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        {
          global: { headers: { Authorization: `Bearer ${jwt}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        },
      );
    const manager = client(env.EBA_TEST_MANAGER_JWT!),
      a = client(env.EBA_TEST_EMPLOYEE_A_JWT!),
      b = client(env.EBA_TEST_EMPLOYEE_B_JWT!),
      outsider = client(env.EBA_TEST_OUTSIDER_JWT!);
    const identify = async (jwt: string) => {
      const result = await manager.auth.getUser(jwt);
      assert.equal(result.error, null);
      assert.ok(result.data.user);
      return result.data.user.id;
    };
    const aId = await identify(env.EBA_TEST_EMPLOYEE_A_JWT!),
      bId = await identify(env.EBA_TEST_EMPLOYEE_B_JWT!);
    const marker = `[integration ${crypto.randomUUID()}]`;
    const project = await manager.rpc("create_workspace_project", {
      project_name: marker,
      department: env.EBA_TEST_DEPARTMENT_ID,
      due: null,
      members: [aId, bId],
    });
    assert.equal(project.error, null);
    assert.ok(project.data);
    let taskId: string | undefined;
    try {
      const made = await a
        .from("tasks")
        .insert({
          project_id: project.data,
          title: marker,
          created_by: aId,
          assignee_id: aId,
          priority: "high",
        })
        .select("id")
        .single();
      assert.equal(made.error, null);
      taskId = made.data!.id;
      assert.equal(
        (
          await a
            .from("tasks")
            .update({ status: "complete", title: `${marker} revised` })
            .eq("id", taskId)
            .select("id")
            .single()
        ).error,
        null,
      );
      const fresh = client(env.EBA_TEST_EMPLOYEE_A_JWT!);
      const reread = await fresh
        .from("tasks")
        .select("title,status")
        .eq("id", taskId)
        .single();
      assert.equal(reread.error, null);
      assert.equal(reread.data!.status, "complete");
      const prohibited = await outsider
        .from("tasks")
        .select("id")
        .eq("id", taskId);
      assert.equal(prohibited.error, null);
      assert.equal(prohibited.data!.length, 0);
      const progress = await a
        .from("project_delivery")
        .select("progress")
        .eq("project_id", project.data)
        .single();
      assert.equal(progress.data!.progress, 100);
      assert.equal(
        (
          await manager
            .from("projects")
            .update({ name: `${marker} updated`, status: "active" })
            .eq("id", project.data)
            .select("id")
            .single()
        ).error,
        null,
      );
      const conversation = await a.rpc("create_workspace_conversation", {
        conversation_title: marker,
        conversation_kind: "private",
        members: [bId],
      });
      assert.equal(conversation.error, null);
      assert.equal(
        (
          await a
            .from("messages")
            .insert({
              conversation_id: conversation.data,
              sender_id: aId,
              body: marker,
            })
        ).error,
        null,
      );
      const received = await b
        .from("messages")
        .select("id,body")
        .eq("conversation_id", conversation.data);
      assert.equal(received.error, null);
      assert.equal(received.data!.length, 1);
      assert.equal(
        (
          await outsider
            .from("messages")
            .select("id")
            .eq("conversation_id", conversation.data)
        ).data!.length,
        0,
      );
      const request = await a
        .from("approvals")
        .insert({
          requester_id: aId,
          title: marker,
          body: "Isolated integration approval",
        })
        .select("id")
        .single();
      assert.equal(request.error, null);
      assert.ok(
        (
          await a.rpc("review_approval", {
            target: request.data!.id,
            decision: "approved",
          })
        ).error,
      );
      assert.equal(
        (
          await manager.rpc("review_approval", {
            target: request.data!.id,
            decision: "approved",
          })
        ).error,
        null,
      );
      const counts = await a.rpc("workspace_counts");
      assert.equal(counts.error, null);
      assert.equal(typeof counts.data.tasks, "number");
    } finally {
      if (taskId)
        assert.equal(
          (await a.from("tasks").delete().eq("id", taskId)).error,
          null,
        );
      assert.equal(
        (
          await manager
            .from("projects")
            .update({ status: "archived" })
            .eq("id", project.data)
        ).error,
        null,
      );
    }
  },
);
