import test from "node:test";
import assert from "node:assert/strict";
import {
  operationSchema,
  toInstant,
  validMeetUrl,
  matchesDue,
} from "../src/modules/operations/schemas.ts";
test("WAT date conversion is explicit and stable", () => {
  assert.equal(toInstant("2026-10-25T10:00"), "2026-10-25T09:00:00.000Z");
  assert.equal(toInstant("2026-10-25T10:00:30"), "2026-10-25T09:00:30.000Z");
  assert.equal(toInstant("2026-10-25T10:00:00Z"), "2026-10-25T10:00:00.000Z");
  assert.equal(toInstant(""), null);
});
test("meeting joins reject lookalike hosts, credentials and executable schemes", () => {
  assert.equal(validMeetUrl("https://meet.google.com/abc-defg-hij"), true);
  for (const value of [
    null,
    "javascript:alert(1)",
    "https://meet.google.com.attacker.test/abc-defg-hij",
    "https://x:password@meet.google.com/abc-defg-hij",
    "https://meet.google.com/invalid",
    "http://meet.google.com/abc-defg-hij",
  ])
    assert.equal(validMeetUrl(value), false);
});
test("due filters use the Lagos day boundary and exclude missing dates", () => {
  const now = new Date("2026-10-25T12:00:00Z");
  assert.equal(matchesDue("2026-10-24T23:30:00Z", "today", now), true);
  assert.equal(matchesDue("2026-10-25T23:30:00Z", "today", now), false);
  assert.equal(matchesDue(null, "today", now), false);
  assert.equal(matchesDue("2026-10-25T11:00:00Z", "overdue", now), true);
});
test("operation input rejects spoofed decisions, bad priorities and malformed participants", () => {
  assert.equal(
    operationSchema.safeParse({
      operation: "approval.review",
      id: "bad",
      decision: "approved",
    }).success,
    false,
  );
  assert.equal(
    operationSchema.safeParse({
      operation: "conversation.create",
      title: "Private",
      kind: "private",
      members: ["bad"],
    }).success,
    false,
  );
  assert.equal(
    operationSchema.safeParse({ operation: "profile.save", display_name: "  " })
      .success,
    false,
  );
});
