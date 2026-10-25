/** Server-side integration contracts. Implement adapters only after credentials and approvals. */
export type IntegrationResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "not_configured" | "forbidden" | "provider_error" };
export interface MeetingRequest {
  requestId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  attendeeEmployeeIds: string[];
}
export interface CalendarGateway {
  createMeeting(
    input: MeetingRequest,
  ): Promise<IntegrationResult<{ eventId: string; meetUrl: string }>>;
}
export interface DirectoryGateway {
  provisionEmployee(input: {
    requestId: string;
    employeeId: string;
    approvedDomain: string;
  }): Promise<IntegrationResult<{ externalId: string }>>;
}
export interface ReminderJob {
  id: string;
  employeeId: string;
  scheduledAt: string;
  entityId: string;
  attempts: number;
}
export interface ReminderGateway {
  enqueue(job: ReminderJob): Promise<IntegrationResult<{ jobId: string }>>;
}
export interface ChatAttachment {
  storagePath: string;
  kind: "voice_note" | "image" | "sticker";
  mimeType: string;
  bytes: number;
}
export interface RealtimeGateway {
  subscribe(
    conversationId: string,
    onMessage: (messageId: string) => void,
  ): () => void;
}
export interface AwardEvidence {
  employeeId: string;
  period: string;
  approvedContributionIds: string[];
  reviewerIds: string[];
}
export interface RecognitionGateway {
  nominate(
    evidence: AwardEvidence,
  ): Promise<IntegrationResult<{ nominationId: string }>>;
}
export interface ManagementReportGateway {
  generate(input: {
    period: string;
    departmentId?: string;
  }): Promise<IntegrationResult<{ reportId: string }>>;
}
