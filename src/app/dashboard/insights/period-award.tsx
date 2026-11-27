"use client";

import { useActionState, useState } from "react";
import { getAwardDecision, getPeriodRecognitionStatus, reviewCriteria } from "./award-decision";
import {
  publishPeriodRecognition,
  submitPeriodNomination,
  submitPeriodReview,
} from "./period-actions";

type AwardType = "employee_month" | "teamwork_month" | "most_improved_month";
type Candidate = { user_id: string; display_name: string };
type Nomination = {
  id: string;
  contributor_ids: string[];
  what_they_did: string;
  collaboration: string;
  who_benefited: string;
  what_changed: string;
  evidence_date: string;
  evidence_url: string;
  before_date?: string | null;
  after_date?: string | null;
  before_evidence?: string | null;
  after_evidence?: string | null;
};
type Review = {
  reviewer_id: string;
  reviewer_role: "ceo" | "admin";
  nomination_id: string | null;
  impact: string;
  contribution: string;
  evidence_strength: string;
  submitted_at: string;
};
type Result = { outcome: "winner" | "no_award"; result_label: string; public_reason: string };
const title = (type: AwardType) =>
  ({
    employee_month: "Employee of the Month",
    teamwork_month: "Best Teamwork",
    most_improved_month: "Most Improved Employee",
  })[type];
const isTeam = (type: AwardType) => type.startsWith("teamwork_");

function NominationForm({
  type,
  period,
  candidates,
}: {
  type: AwardType;
  period: string;
  candidates: Candidate[];
}) {
  const [error, action, pending] = useActionState(submitPeriodNomination, null);
  return (
    <details className="period-recognition__add">
      <summary>Add evidence nomination</summary>
      {!candidates.length ? (
        <p>
          No active staff are available as nominees. Check staff access records before nominating.
        </p>
      ) : (
        <form action={action}>
          <input type="hidden" name="award_type" value={type} />
          <input type="hidden" name="period_start" value={period} />
          <fieldset>
            <legend>
              {isTeam(type) ? "Explicit collaborators · choose at least two" : "Eligible employee"}
              {candidates.length > 0 && (
                <span className="period-recognition__candidate-list">
                  {candidates.map((person) => (
                    <label key={person.user_id}>
                      <input
                        name="contributor_ids"
                        type={isTeam(type) ? "checkbox" : "radio"}
                        value={person.user_id}
                        required={!isTeam(type)}
                      />
                      {person.display_name}
                    </label>
                  ))}
                </span>
              )}
            </legend>
          </fieldset>
          <label>
            What did they do?
            <textarea name="what_they_did" required maxLength={1500} />
          </label>
          {type === "most_improved_month" && (
            <fieldset>
              <legend>Dated before-and-after evidence · selected month</legend>
              <label>
                Before date
                <input
                  name="before_date"
                  type="date"
                  required
                  min={period}
                  max={`${period.slice(0, 7)}-${new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).getUTCDate().toString().padStart(2, "0")}`}
                />
              </label>
              <label>
                Before evidence
                <textarea name="before_evidence" required maxLength={1200} />
              </label>
              <label>
                After date
                <input
                  name="after_date"
                  type="date"
                  required
                  min={period}
                  max={`${period.slice(0, 7)}-${new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).getUTCDate().toString().padStart(2, "0")}`}
                />
              </label>
              <label>
                After evidence
                <textarea name="after_evidence" required maxLength={1200} />
              </label>
              <p>
                Describe a specific improvement between these records. Do not use message counts,
                sign-ins or unsupported activity statistics.
              </p>
            </fieldset>
          )}
          <label>
            {isTeam(type)
              ? "How did they collaborate?"
              : "How did this contribution involve or support others?"}
            <textarea name="collaboration" required maxLength={1500} />
          </label>
          <label>
            Who benefited?
            <textarea name="who_benefited" required maxLength={1500} />
          </label>
          <label>
            What changed as a result?
            <textarea name="what_changed" required maxLength={1500} />
          </label>
          <label>
            Evidence date · within selected month
            <input
              name="evidence_date"
              type="date"
              required
              min={period}
              max={`${period.slice(0, 7)}-${new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).getUTCDate().toString().padStart(2, "0")}`}
            />
          </label>
          <label>
            Evidence link (HTTPS)
            <input
              name="evidence_url"
              type="url"
              required
              maxLength={2048}
              placeholder="https://…"
            />
          </label>
          <button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Submit nomination"}
          </button>
          {error && <p role="alert">{error}</p>}
        </form>
      )}
    </details>
  );
}

function ReviewForm({
  type,
  period,
  nominations,
  candidates,
  own,
}: {
  type: AwardType;
  period: string;
  nominations: Nomination[];
  candidates: Candidate[];
  own?: Review;
}) {
  const [error, action, pending] = useActionState(submitPeriodReview, null);
  return (
    <form className="period-recognition__review-form" action={action}>
      <input type="hidden" name="award_type" value={type} />
      <input type="hidden" name="period_start" value={period} />
      <fieldset>
        <legend>{own ? "Revise your independent review" : "Your independent decision"}</legend>
        {nominations.map((nomination) => (
          <label className="period-recognition__choice" key={nomination.id}>
            <input
              type="radio"
              name="nomination_id"
              value={nomination.id}
              required
              defaultChecked={own?.nomination_id === nomination.id}
            />
            <span>
              {nomination.contributor_ids
                .map(
                  (id) =>
                    candidates.find((person) => person.user_id === id)?.display_name ??
                    "Active contributor",
                )
                .join(", ")}
            </span>
          </label>
        ))}
        <label className="period-recognition__choice">
          <input
            type="radio"
            name="nomination_id"
            value="no-award"
            required
            defaultChecked={Boolean(own && own.nomination_id === null)}
          />
          No award
        </label>
      </fieldset>
      <fieldset className="recognition-assessments">
        <legend>Assessment</legend>
        {reviewCriteria.map(([key, label]) => (
          <label key={key}>
            {label}
            <textarea name={key} required maxLength={500} defaultValue={own?.[key]} />
          </label>
        ))}
      </fieldset>
      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Submit review"}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

function PublishForm({
  type,
  period,
  nominationId,
  label,
}: {
  type: AwardType;
  period: string;
  nominationId: string | null;
  label: string;
}) {
  const [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const [error, action, pending] = useActionState(publishPeriodRecognition, null);
  return (
    <form className="period-recognition__publish" action={action}>
      <input type="hidden" name="award_type" value={type} />
      <input type="hidden" name="period_start" value={period} />
      <input type="hidden" name="nomination_id" value={nominationId ?? "no-award"} />
      <h3>Publish agreed result</h3>
      <p>{label}</p>
      <label>
        Public reason
        <textarea
          name="reason"
          maxLength={240}
          required
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
            setConfirmed(false);
          }}
        />
      </label>
      {confirmed && (
        <p role="status">
          Publish this {label === "No award" ? "no-award result" : `result for ${label}`}?
        </p>
      )}
      {confirmed ? (
        <div>
          <button type="submit" disabled={pending}>
            {pending ? "Publishing…" : "Confirm and publish"}
          </button>
          <button type="button" disabled={pending} onClick={() => setConfirmed(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" disabled={!reason.trim()} onClick={() => setConfirmed(true)}>
          Review publication
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

export function PeriodAward({
  type,
  period,
  candidates,
  nominations,
  reviews,
  result,
  role,
  userId,
  unavailable,
  periodClosed,
  candidateUnavailable,
}: {
  type: AwardType;
  period: string;
  candidates: Candidate[];
  nominations: Nomination[];
  reviews: Review[];
  result: Result | null;
  role: "CEO" | "Admin";
  userId: string;
  unavailable: boolean;
  periodClosed: boolean;
  candidateUnavailable: boolean;
}) {
  const ceoReview = reviews.find((review) => review.reviewer_role === "ceo"),
    adminReview = reviews.find((review) => review.reviewer_role === "admin");
  const decision = getAwardDecision(
    ceoReview ? { nomineeId: ceoReview.nomination_id } : undefined,
    adminReview ? { nomineeId: adminReview.nomination_id } : undefined,
  );
  const own = reviews.find((review) => review.reviewer_id === userId);
  const canReview = periodClosed && !result && (!own || reviews.length === 2);
  const publishId =
    decision.status === "ready_to_publish"
      ? decision.nomineeId
      : decision.status === "no_award"
        ? null
        : undefined;
  const publishLabel =
    publishId === null
      ? "No award"
      : (nominations
          .find((nomination) => nomination.id === publishId)
          ?.contributor_ids.map(
            (id) =>
              candidates.find((person) => person.user_id === id)?.display_name ??
              "Active contributor",
          )
          .join(", ") ?? "Agreed nominee");
  const periodStatus = unavailable
    ? "Recognition status unavailable"
    : getPeriodRecognitionStatus({
        periodClosed,
        nominationsCount: nominations.length,
        reviews,
        result,
        decision,
      });
  return (
    <article className="period-recognition__card">
      <header>
        <div>
          <p className="recognition-kicker">MONTHLY AWARD</p>
          <h2>{title(type)}</h2>
        </div>
        <span className="period-recognition__pill">{periodStatus}</span>
      </header>
      {result && (
        <section className="period-recognition__result">
          <strong>
            {result.outcome === "no_award" ? "No award published" : result.result_label}
          </strong>
          <p>{result.public_reason}</p>
        </section>
      )}
      {!periodClosed && (
        <p className="period-recognition__privacy">
          This period is still open. Evidence nominations and reviews become available after it
          ends.
        </p>
      )}
      {unavailable ? (
        <p role="alert">Recognition data could not be loaded. Refresh to retry.</p>
      ) : (
        <>
          <details className="period-recognition__evidence">
            <summary>Evidence nominations · {nominations.length}</summary>
            {!nominations.length ? (
              <p>No nominations for this period.</p>
            ) : (
              <ul>
                {nominations.map((n) => (
                  <li key={n.id}>
                    <strong>
                      {n.contributor_ids
                        .map(
                          (id) =>
                            candidates.find((person) => person.user_id === id)?.display_name ??
                            "Active contributor",
                        )
                        .join(", ")}
                    </strong>
                    <dl>
                      <div>
                        <dt>Contribution</dt>
                        <dd>{n.what_they_did}</dd>
                      </div>
                      <div>
                        <dt>Collaboration</dt>
                        <dd>{n.collaboration}</dd>
                      </div>
                      <div>
                        <dt>Beneficiaries</dt>
                        <dd>{n.who_benefited}</dd>
                      </div>
                      <div>
                        <dt>Results</dt>
                        <dd>{n.what_changed}</dd>
                      </div>
                      <div>
                        <dt>Evidence date</dt>
                        <dd>{n.evidence_date}</dd>
                      </div>
                      {n.before_date && (
                        <div>
                          <dt>Before · {n.before_date}</dt>
                          <dd>{n.before_evidence}</dd>
                        </div>
                      )}
                      {n.after_date && (
                        <div>
                          <dt>After · {n.after_date}</dt>
                          <dd>{n.after_evidence}</dd>
                        </div>
                      )}
                    </dl>
                    <a href={n.evidence_url} target="_blank" rel="noopener noreferrer">
                      Open evidence
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </details>
          {reviews.length < 2 && !result && (
            <p className="period-recognition__privacy">
              Each CEO/Admin review remains private until both have submitted.
            </p>
          )}
          {canReview && (
            <ReviewForm
              type={type}
              period={period}
              nominations={nominations}
              candidates={candidates}
              own={own}
            />
          )}
          {reviews.length === 2 && (
            <details className="period-recognition__reviews">
              <summary>Independent reviews · both submitted</summary>
              {reviews.map((review) => (
                <article key={review.reviewer_role}>
                  <h3>
                    {review.reviewer_role === "ceo" ? "CEO" : "Admin"}
                    {review.reviewer_id === userId ? " · You" : ""}
                  </h3>
                  <p>
                    Decision:{" "}
                    {review.nomination_id
                      ? (nominations
                          .find((n) => n.id === review.nomination_id)
                          ?.contributor_ids.map(
                            (id) =>
                              candidates.find((person) => person.user_id === id)?.display_name ??
                              "Active contributor",
                          )
                          .join(", ") ?? "Nomination unavailable")
                      : "No award"}
                  </p>
                  <dl>
                    {reviewCriteria.map(([key, label]) => (
                      <div key={key}>
                        <dt>{label}</dt>
                        <dd>{review[key]}</dd>
                      </div>
                    ))}
                  </dl>
                </article>
              ))}
            </details>
          )}
          {periodClosed && role === "CEO" && publishId !== undefined && !result && (
            <PublishForm
              type={type}
              period={period}
              nominationId={publishId}
              label={publishLabel}
            />
          )}
          {periodClosed &&
            !result &&
            (candidateUnavailable ? (
              <p role="status">
                Active staff nominees could not be loaded. Retry when the staff directory is
                available.
              </p>
            ) : (
              <NominationForm type={type} period={period} candidates={candidates} />
            ))}
          {!nominations.length && !result && (
            <p className="period-recognition__empty">
              {candidateUnavailable
                ? "Nomination data is unavailable."
                : "No evidence nominations yet. Results stay empty until real nominations and independent reviews are submitted."}
            </p>
          )}
        </>
      )}
    </article>
  );
}
