import { isAttachmentName, isRequestId } from "../../review";
import { requireHodDashboardAccess } from "../../../access";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { client } = await requireHodDashboardAccess();
  const { id } = await params;
  const url = new URL(request.url);
  const name = url.searchParams.get("name") ?? "";
  const headers = { "Cache-Control": "private, no-store" };
  const missing = () => new Response(null, { status: 404, headers });
  if (!isRequestId(id) || !isAttachmentName(name)) return missing();

  const { data } = await client.from("approval_requests").select("attachment_names").eq("id", id).maybeSingle();
  if (!data?.attachment_names.includes(name)) return missing();

  const { data: file, error } = await client.storage.from("approval-request-files").download(id + "/" + name);
  if (error || !file) return missing();

  const inline = url.searchParams.has("preview") &&
    ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type);
  return new Response(file, {
    headers: {
      ...headers,
      "Content-Type": inline ? file.type : "application/octet-stream",
      "Content-Disposition": (inline ? "inline" : "attachment") + "; filename*=UTF-8''" + encodeURIComponent(name),
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
