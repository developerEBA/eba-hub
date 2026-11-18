export { requireDashboardAccess as requireApprovalsAccess } from "../access";

export const approvalTypes = {
  graphics: "Graphics design",
  marketing: "Marketing campaign",
  website: "Website review",
  leave: "Leave request",
  sick: "Sick notice",
  absence: "Absence notice",
};

export const approvalStatuses: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  changes_requested: "Changes requested",
  rejected: "Rejected",
};

export function isRequestId(id: string) {
  return /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id);
}

export function isAttachmentName(name: string) {
  return /^[a-z\d][a-z\d ._-]{0,199}$/i.test(name) && !name.endsWith(".");
}

export function validatedExternalUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
