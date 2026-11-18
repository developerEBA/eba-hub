import type { Meeting } from "./model";
export const joinEarlyMs=0;
export const joinGraceMs=3*60*60_000;
export type JoinState="waiting"|"open"|"expired"|"closed"|"cancelled";
export function joinWindow(meeting:Pick<Meeting,"starts_at"|"ends_at"|"status"|"joining_closed_at">,now=Date.now()){
 const opens=Date.parse(meeting.starts_at)-joinEarlyMs,closes=Date.parse(meeting.ends_at)+joinGraceMs;
 const state:JoinState=meeting.status==="cancelled"?"cancelled":meeting.joining_closed_at?"closed":!Number.isFinite(opens)||!Number.isFinite(closes)?"closed":now<opens?"waiting":now>=closes?"expired":"open";
 return {state,opens,closes};
}
