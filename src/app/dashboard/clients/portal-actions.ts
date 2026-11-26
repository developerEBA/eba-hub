"use server";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireDashboardAccess } from "../access";
import { clientDirectoryPath, isClientId } from "./directory";
import { portalFileLimit } from "./portal-config";

export type PortalActionState = { message: string; invitation?: string } | null;

function value(form: FormData, key: string) {
  const entry = form.get(key);
  return typeof entry === "string" ? entry.trim() : "";
}

async function verifiedType(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (file.type === "application/pdf") return String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";
  if (file.type === "image/jpeg") return [255, 216, 255].every((byte, index) => byte === bytes[index]);
  if (file.type === "image/png") return [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => byte === bytes[index]);
  return false;
}

export async function managePortal(
  clientId: string,
  operation: string,
  _previous: PortalActionState,
  form: FormData,
): Promise<PortalActionState> {
  const { client, role } = await requireDashboardAccess();
  if (role !== "Admin") return { message: "Only an Admin can manage client access and sharing." };
  if (!isClientId(clientId)) return { message: "Client unavailable." };

  const payload: Record<string, string> = {};
  let invitation: string | undefined;
  let staged: string | undefined;
  const storage = client.storage.from("client-shared-files");

  if (operation === "invite_created" || operation === "access_granted") {
    const email = value(form, "email").toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { message: "Enter a valid email address." };
    payload.email = email;
    if (operation === "invite_created") {
      invitation = randomBytes(32).toString("hex");
      payload.token_hash = createHash("sha256").update(invitation).digest("hex");
    }
  } else if (["invite_revoked", "access_revoked", "share_revoked", "project_shared"].includes(operation)) {
    const id = value(form, "id");
    if (!isClientId(id)) return { message: "The selected record is unavailable." };
    payload.id = id;
  } else if (operation !== "file_shared") {
    return { message: "Action unavailable." };
  }

  if (operation === "project_shared" || operation === "file_shared") {
    payload.title = value(form, "title");
    payload.description = value(form, "description");
    if (!payload.title || payload.title.length > 160 || payload.description.length > 1500) {
      return { message: "Enter a client-facing title and keep the description to 1,500 characters." };
    }
  }

  if (operation === "file_shared") {
    const file = form.get("file");
    if (!(file instanceof File) || file.size < 1 || file.size > portalFileLimit || !(await verifiedType(file))) {
      return { message: "Choose a PDF, JPEG, or PNG up to 750 KB." };
    }
    payload.filename = Array.from(file.name.replace(/[\/\\\u0000-\u001f\u007f]/g, "_").trim()).slice(0, 180).join("");
    if (!payload.filename) return { message: "Choose a file with a valid name." };
    const path = clientId.toLowerCase() + "/" + randomUUID();
    const uploaded = await storage.upload(path, file, { contentType: file.type, upsert: false });
    if (uploaded.error) return { message: "The file could not be uploaded." };
    payload.object_path = path;
    staged = path;
  }

  const { data, error } = await client.rpc("manage_client_portal", {
    p_client: clientId, p_action: operation, p_data: payload,
  });
  if (error || data !== "ok") {
    if (staged) await storage.remove([staged]);
    return { message: data === "account-unavailable"
      ? "That verified account cannot be granted access to this client."
      : "The change could not be saved. Check whether the item has already changed." };
  }

  revalidatePath(clientDirectoryPath + "/" + clientId);
  return invitation ? { message: "Invitation created. Copy the link now.", invitation } : { message: "Change saved." };
}
