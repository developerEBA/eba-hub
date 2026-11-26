import Image from "next/image";
import type { ReactNode } from "react";
import { OverviewCard } from "./overview-card";
import { departmentNames } from "./connect/model";

export type OverviewAward = {
  award_type: string;
  period_start: string;
  outcome: "winner" | "no_award";
  result_label: string;
  public_reason: string;
};
export type OverviewWinner = { user_id: string; display_name: string; avatar_path: string | null; departments: string[] };
export type OverviewWinnerLookup = { data: OverviewWinner[]; error: boolean };

const categories = [
  { type: "employee_month", label: "Employee of the Month" },
  { type: "teamwork_month", label: "Best Teamwork" },
  { type: "most_improved_month", label: "Most Improved Employee" },
];

export function OverviewRecognition({ awards, profiles, unavailable = [], action }: { awards: OverviewAward[]; profiles: Map<string, OverviewWinnerLookup>; unavailable?: string[]; action?: ReactNode }) {
  return <OverviewCard title="Employee Recognition" action={action} className="overview-recognition-card">
    <div className="overview-recognition overview-recognition--three" aria-label="Published monthly recognition">
      {categories.map(({ type, label }) => {
        const award = awards.find((item) => item.award_type === type);
        const lookup = award?.outcome === "winner" ? profiles.get(type) : undefined;
        return <article className="overview-recognition__award" key={type}>
          <h3>{label}</h3>
          {unavailable.includes(type) ? <p role="status">Published result unavailable.</p> : !award ? <p>No published result.</p> : award.outcome === "no_award" ? <><strong>No award</strong><small>{award.period_start} · Africa/Lagos</small><p>{award.public_reason}</p></> : !lookup || lookup.error ? <><p role="status">Winner details unavailable.</p><small>{award.period_start} · Africa/Lagos</small></> : !lookup.data.length ? <><p>Winner profile is unavailable.</p><small>{award.period_start} · Africa/Lagos</small></> : <>
            <div className="overview-recognition__people">{lookup.data.map((person) => <div className="overview-recognition__person" key={person.user_id}>
              {person.avatar_path ? <Image className="overview-recognition__photo" src={person.avatar_path} alt="" width={56} height={56} unoptimized/> : <span className="overview-recognition__photo overview-recognition__photo--initials" aria-hidden="true">{person.display_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span>}
              <strong>{person.display_name}</strong><small>{person.departments.length ? person.departments.map((department) => departmentNames[department] ?? department).join(", ") : "Department not assigned"}</small>
            </div>)}</div>
            <small>{award.period_start} · Africa/Lagos</small>
            <p className="overview-recognition__reason">{award.public_reason}</p>
          </>}
        </article>;
      })}
    </div>
    <p className="overview-recognition__period">Latest published result for each category · Africa/Lagos</p>
  </OverviewCard>;
}
