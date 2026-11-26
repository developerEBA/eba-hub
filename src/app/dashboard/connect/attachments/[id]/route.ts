import { requireHodDashboardAccess } from "../../../access";
import { documentType, photoTypes } from "../config";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { client } = await requireHodDashboardAccess();
  const { id } = await params;
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  });
  const missing = () => new Response(null, { status: 404, headers });
  if (!/^[1-9]\d{0,14}$/.test(id)) return missing();

  const { data } = await client.from("connect_messages")
    .select("attachment_path,attachment_name,attachment_mime")
    .eq("id", id).in("kind", ["photo", "document"]).maybeSingle();
  if (!data?.attachment_path || !data.attachment_name) return missing();

  const { data: file, error } = await client.storage.from("connect-attachments").download(data.attachment_path);
  if (error || !file || file.type !== data.attachment_mime) return missing();
  const photo = photoTypes.includes(file.type);
  if (!photo && file.type !== documentType) return missing();
  const download = !photo || new URL(request.url).searchParams.has("download");
  const filename = encodeURIComponent(data.attachment_name).replace(/['()*]/g, (char) =>
    "%" + char.charCodeAt(0).toString(16),
  );
  headers.set("Content-Type", download ? "application/octet-stream" : file.type);
  headers.set("Content-Disposition", (download ? "attachment" : "inline") + "; filename*=UTF-8''" + filename);
  return new Response(file, { headers });
}
