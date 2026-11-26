"use client";

import { useActionState, useState } from "react";
import { publishRecognition, submitRecognitionReview, submitWeeklyNomination } from "./actions";

import { reviewCriteria, type RecognitionNomination, type RecognitionReview } from "./award-decision";
import { NomineeInitials } from "./recognition-workspace";

export function ReviewForm({ week, nominations, ownReview }: {
  week: string;
  nominations: RecognitionNomination[];
  ownReview?: RecognitionReview;
}) {
  const [error, action, pending] = useActionState(submitRecognitionReview, null);
  return (
    <form className="eba-recognition__form" action={action}>
      {ownReview && <h3>Revise your review</h3>}
      <input type="hidden" name="week" value={week} />
      <fieldset className="recognition-choices"><legend>Your choice</legend>
        {nominations.map((nominee) => <label key={nominee.nominee_id}><input type="radio" name="nominee" value={nominee.nominee_id} required defaultChecked={ownReview?.nominee_id === nominee.nominee_id} /><NomineeInitials name={nominee.nominee_name} /><span>{nominee.nominee_name}</span></label>)}
        <label className="recognition-choices__no-award"><input type="radio" name="nominee" value="no-award" required defaultChecked={Boolean(ownReview && ownReview.nominee_id === null)} /><span aria-hidden="true">⊘</span><span>No award this week</span></label>
      </fieldset>
      <fieldset className="recognition-assessments"><legend>Assessment</legend>{reviewCriteria.map(([key, label]) => (
        <label key={key}>{label}<textarea name={key} rows={2} required maxLength={500} placeholder="Describe your assessment…" defaultValue={ownReview?.[key]} /></label>
      ))}</fieldset>
      <div><button type="submit" disabled={pending}>{pending ? "Saving…" : "Submit review"}</button></div>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

export function WeeklyNominationForm({ week, candidates }: { week: string; candidates: { user_id: string; display_name: string }[] }) {
  const [error, action, pending] = useActionState(submitWeeklyNomination, null);
  const weekEnd = new Date(Date.parse(week+"T00:00:00Z")+6*86400000).toISOString().slice(0,10);
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Africa/Lagos" }).format(new Date());
  return <details className="period-recognition__add"><summary>Submit evidence nomination</summary>
    {!candidates.length ? <p>No active staff nominees are available.</p> : <form action={action}>
      <input type="hidden" name="week" value={week}/>
      <label>Employee<select name="nominee" required defaultValue=""><option value="" disabled>Select an active employee</option>{candidates.map((person)=><option key={person.user_id} value={person.user_id}>{person.display_name}</option>)}</select></label>
      <label>What did they contribute?<textarea name="what_they_did" required maxLength={1500}/></label>
      <label>Who benefited?<textarea name="who_benefited" required maxLength={1500}/></label>
      <label>What changed or improved?<textarea name="what_changed" required maxLength={1500}/></label>
      <label>Evidence date within this week<input type="date" name="evidence_date" required min={week} max={weekEnd < today ? weekEnd : today}/></label>
      <label>Supporting evidence link (HTTPS)<input type="url" name="evidence_url" required maxLength={2048} placeholder="https://…"/></label>
      <button type="submit" disabled={pending}>{pending?"Saving…":"Submit nomination"}</button>{error&&<p role="alert">{error}</p>}
    </form>}
  </details>;
}

export function PublishWinner({ week, nominee }: { week: string; nominee: RecognitionNomination | null }) {
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [error, action, pending] = useActionState(publishRecognition, null);

  return (
    <form className="eba-recognition__form" action={action}>
      <h2>Publish Winner</h2>
      <p>Agreed result: <strong>{nominee?.nominee_name ?? "No award"}</strong></p>
      <input type="hidden" name="week" value={week} />
      <input type="hidden" name="winner" value={nominee?.nominee_id ?? "no-award"} />
      {confirm && <input type="hidden" name="confirmed" value="yes" />}
      <label>Public reason
        <textarea name="reason" rows={3} maxLength={240} required value={reason}
          onChange={(event) => { setReason(event.target.value); setConfirm(false); }} />
      </label>
      {confirm && <p role="status">Publish {nominee?.nominee_name ?? "No award"} for this week? Both roles will see the public reason.</p>}
      <div>
        {confirm ? (
          <>
            <button type="submit" disabled={pending}>{pending ? "Publishing…" : "Confirm and publish"}</button>
            <button type="button" disabled={pending} onClick={() => setConfirm(false)}>Cancel</button>
          </>
        ) : <button type="button" disabled={!reason.trim()} onClick={() => setConfirm(true)}>Review publication</button>}
      </div>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
