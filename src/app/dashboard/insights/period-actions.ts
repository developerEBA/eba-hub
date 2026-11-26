"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireDashboardAccess } from "../access";
import { isRecognitionPeriod, recognitionPeriodClosed, recognitionPeriodEnd, type RecognitionCadence } from "./periods";
import { recognitionPath } from "./recognition";

type AwardType = "employee_month" | "teamwork_month" | "most_improved_month";
const allowed: AwardType[] = ["employee_month", "teamwork_month", "most_improved_month"];
function fields(form: FormData) {
  const type = form.get("award_type"); const period = form.get("period_start");
  if (typeof type !== "string" || !allowed.includes(type as AwardType) || typeof period !== "string") return null;
  const cadence: RecognitionCadence = "month";
  if (!isRecognitionPeriod(cadence, period) || !recognitionPeriodClosed(cadence, period)) return null;
  return { type: type as AwardType, period, cadence };
}
function value(form: FormData, key: string) { const raw = form.get(key); return typeof raw === "string" ? raw.trim() : ""; }
function page(period: string, cadence: RecognitionCadence) { return `${recognitionPath}?cadence=${cadence}&period=${period}`; }

export async function submitPeriodNomination(_previous: string | null, form: FormData) {
  const { client, role } = await requireDashboardAccess(); const target = fields(form);
  if (role !== "CEO" && role !== "Admin") return "Only an active CEO or Admin can nominate recognition.";
  const contributorIds = form.getAll("contributor_ids").filter((entry): entry is string => typeof entry === "string");
  const teamwork = target?.type.startsWith("teamwork_");
  const mostImproved = target?.type === "most_improved_month";
  const what = value(form, "what_they_did"), collaboration = value(form, "collaboration"), beneficiaries = value(form, "who_benefited"), results = value(form, "what_changed"), evidence = value(form, "evidence_url");
  const evidenceDate = value(form, "evidence_date");
  let evidenceUrl: URL | null = null; try { evidenceUrl = new URL(evidence); } catch { /* validation below */ }
  const beforeDate = value(form, "before_date"), afterDate = value(form, "after_date"), beforeEvidence = value(form, "before_evidence"), afterEvidence = value(form, "after_evidence");
  if (!target || !/^\d{4}-\d{2}-\d{2}$/.test(evidenceDate) || evidenceDate < target.period || evidenceDate >= recognitionPeriodEnd(target.cadence,target.period) ||
      contributorIds.length !== new Set(contributorIds).size || (!teamwork && contributorIds.length !== 1) || (teamwork && contributorIds.length < 2) ||
      (mostImproved && (!/^\d{4}-\d{2}-\d{2}$/.test(beforeDate) || !/^\d{4}-\d{2}-\d{2}$/.test(afterDate) || beforeDate >= afterDate || afterDate < target.period || afterDate >= recognitionPeriodEnd(target.cadence,target.period) || !beforeEvidence || !afterEvidence || beforeEvidence.length > 1200 || afterEvidence.length > 1200)) ||
      [what, collaboration, beneficiaries, results].some((text) => !text || text.length > 1500) || !evidenceUrl || evidenceUrl.protocol !== "https:" || evidenceUrl.username || evidenceUrl.password || evidence.length > 2048) {
    return "Choose real active staff and complete each evidence field. Include a secure HTTPS evidence link.";
  }
  const { data, error } = await client.rpc("period_recognition_nominate", { p_award_type: target.type, p_period_start: target.period, p_evidence_date: evidenceDate,
    p_contributor_ids: contributorIds, p_what: what, p_collaboration: collaboration, p_beneficiaries: beneficiaries, p_results: results, p_evidence_url: evidenceUrl.href,
    p_before_date: mostImproved ? beforeDate : null, p_after_date: mostImproved ? afterDate : null, p_before_evidence: mostImproved ? beforeEvidence : null, p_after_evidence: mostImproved ? afterEvidence : null });
  if (error || !data) return "Nomination was not saved. Check that this period is closed and all selected staff are active.";
  revalidatePath(recognitionPath); redirect(page(target.period, target.cadence));
}

export async function submitPeriodReview(_previous: string | null, form: FormData) {
  const { client, role } = await requireDashboardAccess(); const target = fields(form); const choice = form.get("nomination_id");
  if (role !== "CEO" && role !== "Admin") return "Only an active CEO or Admin can review recognition.";
  const nominee = choice === "no-award" ? null : typeof choice === "string" ? choice : undefined;
  const impact = value(form, "impact"), contribution = value(form, "contribution"), evidence = value(form, "evidence_strength");
  if (!target || nominee === undefined || ![impact, contribution, evidence].every((text) => text && text.length <= 500)) return "Choose a nominee or No award and complete all three assessments (up to 500 characters each).";
  const { data, error } = await client.rpc("period_recognition_review", { p_award_type: target.type, p_period_start: target.period,
    p_nomination_id: nominee, p_impact: impact, p_contribution: contribution, p_evidence_strength: evidence });
  if (error || data !== true) return "Review could not be saved. Reload to check the selected period and current result.";
  revalidatePath(recognitionPath); redirect(page(target.period, target.cadence));
}

export async function publishPeriodRecognition(_previous: string | null, form: FormData) {
  const { client, role } = await requireDashboardAccess(); if (role !== "CEO") return "Only an active CEO can publish a recognition result.";
  const target = fields(form), raw = form.get("nomination_id"), nomination = raw === "no-award" ? null : typeof raw === "string" ? raw : undefined;
  const reason = value(form, "reason");
  if (form.get("confirmed") !== "yes" || !target || nomination === undefined || !reason || reason.length > 240) return "Confirm the agreed result and enter a public reason up to 240 characters.";
  const { data, error } = await client.rpc("period_recognition_publish", { p_award_type: target.type, p_period_start: target.period, p_nomination_id: nomination, p_reason: reason });
  if (error) return "Could not publish the agreed result. Try again.";
  revalidatePath(recognitionPath); revalidatePath("/dashboard");
  redirect(page(target.period, target.cadence) + (data === true ? "&result=published" : "&result=publish-blocked"));
}
