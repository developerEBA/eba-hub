"use client";

import { useActionState, useState } from "react";
import { publishRecognition, submitRecognitionReview } from "./actions";

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

export function PublishWinner({ week, nominee }: { week: string; nominee: RecognitionNomination }) {
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [error, action, pending] = useActionState(publishRecognition, null);

  return (
    <form className="eba-recognition__form" action={action}>
      <h2>Publish Winner</h2>
      <p>Agreed nominee: <strong>{nominee.nominee_name}</strong></p>
      <input type="hidden" name="week" value={week} />
      <input type="hidden" name="winner" value={nominee.nominee_id} />
      {confirm && <input type="hidden" name="confirmed" value="yes" />}
      <label>Public reason
        <textarea name="reason" rows={3} maxLength={240} required value={reason}
          onChange={(event) => { setReason(event.target.value); setConfirm(false); }} />
      </label>
      {confirm && <p role="status">Publish {nominee.nominee_name} for this week? Both roles will see the public reason.</p>}
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
