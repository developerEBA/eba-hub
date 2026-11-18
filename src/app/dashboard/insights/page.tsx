import Link from "next/link";
import { Suspense } from "react";
import { requireDashboardAccess } from "../access";
import { DashboardShell } from "../dashboard-shell";
import DashboardLoading from "../loading";
import { decisionLabels, getAwardDecision, reviewCriteria, type RecognitionNomination, type RecognitionReview } from "./award-decision";
import { PublishWinner, ReviewForm } from "./review-forms";
import { currentRecognitionWeek, isMonday, loadRecognition, recognitionPath, recognitionWeekLabel, shiftWeek } from "./recognition";
import { RecognitionWorkspace } from "./recognition-workspace";
import "./insights.css";

type Query = Record<string, string | string[] | undefined>;

export default function Insights({ searchParams }: { searchParams: Promise<Query> }) {
  return <Suspense fallback={<DashboardLoading />}><Recognition searchParams={searchParams} /></Suspense>;
}

async function Recognition({ searchParams }: { searchParams: Promise<Query> }) {
  const { client, role, user } = await requireDashboardAccess();
  const query = await searchParams;
  const current = currentRecognitionWeek();
  const week = isMonday(query.week) && query.week <= current ? query.week : current;
  const [result, nominationResult, reviewResult] = await Promise.all([
    loadRecognition(client, week),
    client.from("weekly_recognition_nominations")
      .select("nominee_id,nominee_name,what_they_did,who_benefited,what_changed,evidence_url")
      .eq("week_start", week).order("nominee_name").returns<RecognitionNomination[]>(),
    client.from("weekly_recognition_reviews")
      .select("reviewer_id,reviewer_role,nominee_id,impact,contribution,evidence_strength,submitted_at")
      .eq("week_start", week).returns<RecognitionReview[]>(),
  ]);
  const nominations = nominationResult.data ?? [];
  const reviews = reviewResult.data ?? [];
  const ownReview = reviews.find((review) => review.reviewer_id === user.id);
  const bothSubmitted = reviews.length === 2;
  const choice = (reviewRole: "ceo" | "admin") => {
    const review = reviews.find((entry) => entry.reviewer_role === reviewRole);
    return review ? { nomineeId: review.nominee_id } : undefined;
  };
  const decision = getAwardDecision(choice("ceo"), choice("admin"));
  const agreedNominee = decision.status === "ready_to_publish"
    ? nominations.find((nomination) => nomination.nominee_id === decision.nomineeId) : undefined;
  const unavailable = Boolean(result.error || nominationResult.error || reviewResult.error);

  return (
    <DashboardShell role={role} section="insights">
      <section className="eba-recognition" aria-labelledby="recognition-title">
        <header className="recognition-page-heading"><div><p className="recognition-kicker">Insights</p><h1 id="recognition-title">Employee Recognition</h1><p className="recognition-subtitle">Recognize meaningful contributions across EBA.</p></div>
          <nav className="recognition-week" aria-label="Recognition weeks">
            {isMonday(shiftWeek(week, -1)) && <Link aria-label="Previous week" href={{ pathname: recognitionPath, query: { week: shiftWeek(week, -1) } }}>‹</Link>}
            <div><strong>{recognitionWeekLabel(week)}</strong>{week === current ? <span>This week</span> : <Link href={recognitionPath}>Back to this week</Link>}</div>
            {week < current ? <Link aria-label="Next week" href={{ pathname: recognitionPath, query: { week: shiftWeek(week, 1) } }}>›</Link> : <span aria-hidden="true" className="recognition-week__disabled">›</span>}
          </nav>
        </header>
        {query.result === "already-published" && result.data && <p role="status">A winner is already published for this week.</p>}
        {query.result === "publish-blocked" && !result.data && <p role="status">
          {decision.status === "ready_to_publish" ? "The agreed nominee may no longer be eligible. Review the nomination before trying again."
            : "The reviews changed. Both reviewers must agree before publishing."}
        </p>}
        <article className="recognition-winner">
          <div className="recognition-winner__label"><span className="recognition-trophy" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3h8v7a4 4 0 0 1-8 0zM8 5H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4m-4 3v5m-4 2h8m-7-2h6" /></svg></span><div><h2>Most Influential Employee of the Week</h2><p>{recognitionWeekLabel(week)}</p></div></div>
          <div className="recognition-winner__result">
          {result.error ? <p role="status">Recognition could not be loaded.</p> : result.data ? (
            <><strong className="eba-recognition__winner">{result.data.winner_name}</strong><p>{result.data.reason}</p></>
          ) : <p>No winner announced for this week.</p>}</div>
        </article>
        {unavailable ? <p role="status">Nominations or reviews could not be loaded.</p> : (
          <>
            <RecognitionWorkspace key={week} nominations={nominations}>
              <header className="recognition-review__heading"><div><h2 id="recognition-reviews">Independent review</h2><p>Signed in as {role}</p></div><span role="status">{result.data ? "Published" : decisionLabels[decision.status]}</span></header>
              {!bothSubmitted && !result.data && <p>Each review stays private until both reviewers have submitted.</p>}
              {reviews.map((review) => (
                <details key={review.reviewer_role} className="recognition-submitted">
                  <summary>{review.reviewer_role === "ceo" ? "CEO" : "Admin"} review · Submitted</summary>
                  <h3>{review.reviewer_role === "ceo" ? "CEO" : "Admin"} review{review.reviewer_id === user.id ? " (you)" : ""}</h3>
                  <p>{review.nominee_id
                    ? nominations.find((nomination) => nomination.nominee_id === review.nominee_id)?.nominee_name ?? "Nominee unavailable"
                    : "No award this week"}</p>
                  <dl>{reviewCriteria.map(([key, label]) => (
                    <div key={key}><dt>{label}</dt><dd>{review[key]}</dd></div>
                  ))}</dl>
                </details>
              ))}
              {!result.data && (!ownReview || bothSubmitted) && (
                <ReviewForm key={week + (ownReview?.submitted_at ?? "")}
                  week={week} nominations={nominations} ownReview={ownReview} />
              )}
            {!result.data && role === "Admin" && agreedNominee && (
              <PublishWinner key={week + agreedNominee.nominee_id} week={week} nominee={agreedNominee} />
            )}
            </RecognitionWorkspace>
          </>
        )}
      </section>
    </DashboardShell>
  );
}
