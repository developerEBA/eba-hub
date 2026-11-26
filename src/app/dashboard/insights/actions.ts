"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireDashboardAccess } from "../access";
import { currentRecognitionWeek, isMonday, loadRecognition, recognitionPath } from "./recognition";

const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

function note(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function submitRecognitionReview(_previous: string | null, form: FormData) {
  const { client } = await requireDashboardAccess();
  const week = form.get("week");
  const nominee = form.get("nominee");
  const impact = note(form, "impact");
  const contribution = note(form, "contribution");
  const evidence = note(form, "evidence_strength");
  if (!isMonday(week) || week > currentRecognitionWeek() || typeof nominee !== "string" ||
      (nominee !== "no-award" && !uuid.test(nominee)) ||
      [impact, contribution, evidence].some((assessment) => !assessment || assessment.length > 500)) {
    return "Choose a decision and enter all three assessments, up to 500 characters each.";
  }

  const { data, error } = await client.rpc("submit_weekly_recognition_review", {
    p_week_start: week, p_nominee_id: nominee === "no-award" ? null : nominee,
    p_impact: impact, p_contribution: contribution, p_evidence_strength: evidence,
  });
  if (error || data !== true) {
    return "Review could not be saved. Reload the week to check whether it was published or the nomination changed.";
  }
  revalidatePath(recognitionPath);
  redirect(recognitionPath + "?week=" + week);
}

export async function submitWeeklyNomination(_previous: string | null, form: FormData) {
  const { client } = await requireDashboardAccess();
  const week = form.get("week"), nominee = form.get("nominee");
  const evidenceDate = note(form, "evidence_date"), what = note(form, "what_they_did");
  const beneficiaries = note(form, "who_benefited"), results = note(form, "what_changed"), evidence = note(form, "evidence_url");
  let url: URL | null = null; try { url = new URL(evidence); } catch { /* validated below */ }
  const lagosToday = new Intl.DateTimeFormat("sv-SE", { timeZone: "Africa/Lagos" }).format(new Date());
  if (!isMonday(week) || typeof nominee !== "string" || !uuid.test(nominee) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(evidenceDate) || evidenceDate < week || evidenceDate > lagosToday || evidenceDate >= new Date(Date.parse(week + "T00:00:00Z") + 7 * 86400000).toISOString().slice(0,10) ||
      [what, beneficiaries, results].some((value) => !value || value.length > 1500) || !url || url.protocol !== "https:" || url.username || url.password || evidence.length > 2048) {
    return "Choose an eligible employee and complete the evidence fields with a date inside this week and an HTTPS link.";
  }
  const { data, error } = await client.rpc("submit_weekly_recognition_nomination", { p_week_start: week, p_nominee_id: nominee,
    p_evidence_date: evidenceDate, p_what: what, p_beneficiaries: beneficiaries, p_results: results, p_evidence_url: url.href });
  if (error || data !== true) return "Nomination could not be saved. Check that this week is unpublished and the nominee is active.";
  revalidatePath(recognitionPath); redirect(recognitionPath + "?week=" + week);
}

export async function publishRecognition(_previous: string | null, form: FormData) {
  const { client, role } = await requireDashboardAccess();
  if (role !== "CEO") return "Only an active CEO can publish a recognition result.";

  const week = form.get("week");
  const winner = form.get("winner");
  const value = form.get("reason");
  const reason = typeof value === "string" ? value.trim() : "";
  if (form.get("confirmed") !== "yes") return "Confirm the selection before publishing.";
  if (!isMonday(week) || week > currentRecognitionWeek() ||
      typeof winner !== "string" || (winner !== "no-award" && !uuid.test(winner)) ||
      !reason || reason.length > 240) return "Choose an employee and enter a reason up to 240 characters.";

  const { data, error } = await client.rpc("publish_weekly_recognition", {
    p_week_start: week, p_winner_id: winner === "no-award" ? null : winner, p_reason: reason,
  });
  if (error) return "Could not publish recognition. Try again.";

  const url = recognitionPath + "?week=" + week;
  revalidatePath(recognitionPath);
  if (data === true) {
    revalidatePath("/dashboard");
    redirect(url);
  }

  const latest = await loadRecognition(client, week);
  if (latest.error) return "Could not reload the selected week. Try again.";
  redirect(url + (latest.data ? "&result=already-published" : "&result=publish-blocked"));
}
