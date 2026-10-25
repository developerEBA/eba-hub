export type WorkspaceRole =
  "employee" | "department_lead" | "management" | "admin";
export const roles: readonly WorkspaceRole[] = [
  "employee",
  "department_lead",
  "management",
  "admin",
];
export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return roles.some((role) => role === value);
}
export function canAdminister(role: WorkspaceRole) {
  return role === "admin";
}
export function canManage(role: WorkspaceRole) {
  return role === "admin" || role === "management";
}
