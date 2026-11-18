"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireDashboardAccess } from "../access";
import { clientDirectoryPath, clientLimits, isClientId } from "./directory";

function field(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function saveClient(id: string | null, _previous: string | null, form: FormData) {
  const { client, role } = await requireDashboardAccess();
  if (role !== "Admin") return "Only an Admin can save client records.";
  if (id !== null && (typeof id !== "string" || !isClientId(id))) return "Client unavailable.";

  const name = field(form, "name");
  const primaryContact = field(form, "primary_contact");
  const email = field(form, "email");
  const phone = field(form, "phone");
  const notes = field(form, "notes");
  if (!name || name.length > clientLimits.name) return "Enter a client or organization name up to 160 characters.";
  if (primaryContact.length > clientLimits.primary_contact) return "Keep the primary contact name to 120 characters or fewer.";
  if (email && (email.length > clientLimits.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return "Enter a valid email address.";
  }
  if (phone && (phone.length > clientLimits.phone || !/^[+\d(). -]+$/.test(phone) || !/\d/.test(phone))) {
    return "Enter a valid phone number.";
  }
  if (notes.length > clientLimits.notes) return "Keep notes to 4,000 characters or fewer.";

  const values = {
    name, primary_contact: primaryContact || null, email: email || null, phone: phone || null, notes: notes || null,
  };
  const table = client.from("client_directory");
  const mutation = id === null ? table.insert(values) : table.update(values).eq("id", id);
  const { data, error } = await mutation.select("id").maybeSingle();
  if (error || !data) return "Client could not be saved. Check your access and try again.";

  const path = clientDirectoryPath + "/" + data.id;
  revalidatePath(clientDirectoryPath);
  revalidatePath(path);
  redirect(path);
}

export async function deleteClient(id: string, _previous: string | null, form: FormData) {
  const { client, role } = await requireDashboardAccess();
  if (role !== "Admin") return "Only an Admin can delete a client.";
  if (typeof id !== "string" || !isClientId(id) || form.get("confirm") !== "yes") {
    return "Confirm that you want to delete this client.";
  }
  const { data, error } = await client.rpc("delete_client_record", { p_client: id });
  if (error || data !== true) return "The client could not be deleted. Try again or contact your workspace administrator.";
  await cleanClientFiles(client, id);
  revalidatePath(clientDirectoryPath);
  revalidatePath(clientDirectoryPath + "/" + id);
  redirect(clientDirectoryPath);
}

async function cleanClientFiles(client: Awaited<ReturnType<typeof requireDashboardAccess>>["client"], id?: string) {
  try {
    let query = client.from("client_file_cleanup").select("object_path").order("object_path").limit(100);
    if (id) query = query.eq("client_id", id);
    const { data, error } = await query;
    if (error) return false;
    if (!data.length) return true;

    const paths = data.map(({ object_path }) => object_path);
    const removal = await client.storage.from("client-shared-files").remove(paths);
    if (removal.error) return false;

    const finished = await client.rpc("finish_client_file_cleanup", { p_paths: paths });
    if (finished.error) return false;
    // Another request may have finished the same files in the meantime.
    const remaining = await client.from("client_file_cleanup").select("object_path").in("object_path", paths).limit(1);
    return !remaining.error && remaining.data.length === 0;
  } catch {
    return false;
  }
}

export async function retryClientFileCleanup() {
  const { client, role } = await requireDashboardAccess();
  if (role !== "Admin") return "Only an Admin can retry file cleanup.";
  const succeeded = await cleanClientFiles(client);
  revalidatePath(clientDirectoryPath);
  return succeeded ? "Cleanup batch completed." : "Some files could not be removed. You can retry cleanup.";
}
