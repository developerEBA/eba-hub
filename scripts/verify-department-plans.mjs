import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

function required(name) {
  const value = process.env[name];
  assert.ok(value, "Missing " + name);
  return value;
}

const url = required("NEXT_PUBLIC_SUPABASE_URL");
const key = required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const planId = required("EBA_TEST_SUBMITTED_PLAN_ID");
const draftId = required("EBA_TEST_DRAFT_PLAN_ID");
const path = required("EBA_TEST_SUBMITTED_ATTACHMENT_PATH");
const draftPath = required("EBA_TEST_DRAFT_ATTACHMENT_PATH");
assert.notEqual(planId, draftId);
assert.ok(path.startsWith(planId + "/") && draftPath.startsWith(draftId + "/"));

let sharedDigest;
for (const role of ["ceo", "admin"]) {
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: signInError } = await client.auth.signInWithPassword({
    email: required("EBA_TEST_" + role.toUpperCase() + "_EMAIL"),
    password: required("EBA_TEST_" + role.toUpperCase() + "_PASSWORD"),
  });
  assert.ok(!signInError && auth.user, role + ": sign-in failed");

  try {
    const membership = await client.from("staff_memberships").select("role,status")
      .eq("user_id", auth.user.id).single();
    assert.ok(!membership.error && membership.data?.role === role && membership.data.status === "active",
      role + ": unexpected membership");

    const plans = await client.from("department_plans").select("id,title,status")
      .in("id", [planId, draftId]);
    assert.ok(!plans.error && plans.data.length === 1 && plans.data[0].id === planId &&
      plans.data[0].status === "submitted", role + ": submitted/draft visibility check failed");

    const items = await client.from("department_plan_items").select("plan_id").in("plan_id", [planId, draftId]);
    assert.ok(!items.error && items.data.length && items.data.every((item) => item.plan_id === planId),
      role + ": deliverable visibility check failed");

    const attachments = await client.from("department_plan_attachments").select("object_path")
      .in("object_path", [path, draftPath]);
    assert.ok(!attachments.error && attachments.data.length === 1 && attachments.data[0].object_path === path,
      role + ": attachment metadata visibility check failed");

    const files = client.storage.from("department-plan-files");
    const submitted = await files.download(path);
    assert.ok(!submitted.error && submitted.data.size > 0, role + ": submitted attachment download failed");
    const digest = createHash("sha256").update(Buffer.from(await submitted.data.arrayBuffer())).digest("hex");
    sharedDigest ??= digest;
    assert.equal(digest, sharedDigest, role + ": downloaded attachment differs");
    const draft = await files.download(draftPath);
    assert.ok(draft.error && !draft.data, role + ": draft attachment was downloadable");

    const update = await client.from("department_plans").update({ title: plans.data[0].title })
      .eq("id", planId).select("id");
    assert.equal(update.error?.code, "42501", role + ": submitted plan update was not denied");
    const upload = await files.upload(planId + "/release-check-" + randomUUID() + ".txt", "Development permission check");
    assert.ok(upload.error && !upload.data, role + ": upload was not denied");
    console.log(role.toUpperCase() + ": submitted reads, shared download, draft isolation and write denials passed.");
  } finally {
    await client.auth.signOut({ scope: "local" });
  }
}
