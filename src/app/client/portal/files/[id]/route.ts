import { isClientId } from "../../../../dashboard/clients/directory";
import { getPortalAccess } from "../../../access";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  const access = await getPortalAccess();
  if (!access) return new Response(null, { status: 404, headers });
  const { id } = await params;
  if (!isClientId(id)) return new Response(null, { status: 404, headers });

  const { data } = await access.client.from("client_portal_shares").select("object_path,filename")
    .eq("client_id", access.clientId).eq("id", id).eq("kind", "file").is("revoked_at", null).maybeSingle();
  if (!data?.object_path || !data.filename) return new Response(null, { status: 404, headers });

  const { data: file } = await access.client.storage.from("client-shared-files").download(data.object_path);
  if (!file) return new Response(null, { status: 404, headers });
  const filename = encodeURIComponent(data.filename).replace(/['()*]/g, (char) => "%" + char.charCodeAt(0).toString(16));
  return new Response(file, {
    headers: { ...headers, "Content-Type": "application/octet-stream", "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "attachment; filename*=UTF-8''" + filename },
  });
}
