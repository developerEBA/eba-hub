export type Review = { nomineeId: string | null };

type AwardDecision =
  | { status: "awaiting_reviews" }
  | { status: "needs_agreement" }
  | { status: "no_award" }
  | { status: "ready_to_publish"; nomineeId: string };

export function getAwardDecision(ceoReview: Review | undefined, adminReview: Review | undefined): AwardDecision {
  if (!ceoReview || !adminReview) return { status: "awaiting_reviews" };
  if (ceoReview.nomineeId !== adminReview.nomineeId) return { status: "needs_agreement" };
  if (ceoReview.nomineeId === null) return { status: "no_award" };
  return { status: "ready_to_publish", nomineeId: ceoReview.nomineeId };
}

export const decisionLabels = {
  awaiting_reviews: "Awaiting reviews",
  needs_agreement: "Reviewers haven’t agreed",
  no_award: "No award this week",
  ready_to_publish: "Ready to publish",
};

export const reviewCriteria = [
  ["impact", "Impact"],
  ["contribution", "Contribution to others"],
  ["evidence_strength", "Strength of evidence"],
] as const;

export type RecognitionReview = {
  reviewer_id: string;
  reviewer_role: "ceo" | "admin";
  nominee_id: string | null;
  impact: string;
  contribution: string;
  evidence_strength: string;
  submitted_at: string;
};

export type RecognitionNomination = {
  nominee_id: string;
  nominee_name: string;
  what_they_did: string;
  who_benefited: string;
  what_changed: string;
  evidence_url: string | null;
};
