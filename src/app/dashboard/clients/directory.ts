export const clientDirectoryPath = "/dashboard/clients";

export const clientLimits = {
  name: 160,
  primary_contact: 120,
  email: 254,
  phone: 40,
  notes: 4000,
};

export type ClientSummary = {
  id: string;
  name: string;
  primary_contact: string | null;
};

export type ClientRecord = ClientSummary & {
  email: string | null;
  phone: string | null;
  notes: string | null;
};

export function isClientId(id: string) {
  return /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id);
}
