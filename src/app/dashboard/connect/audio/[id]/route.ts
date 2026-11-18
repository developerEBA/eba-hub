import { requireDashboardAccess } from "../../../access";
import { audioTypes } from "../../media";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { client } = await requireDashboardAccess();
  const { id } = await params;
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
  });
  const missing = () => new Response(null, { status: 404, headers });
  if (!/^[1-9]\d{0,14}$/.test(id)) return missing();

  const { data } = await client.from("connect_messages").select("audio_path")
    .eq("id", id).eq("kind", "voice").maybeSingle();
  if (!data?.audio_path) return missing();

  const { data: file, error } = await client.storage.from("connect-voice").download(data.audio_path);
  if (error || !file || !audioTypes.includes(file.type)) return missing();

  headers.set("Content-Type", file.type);
  headers.set("Accept-Ranges", "bytes");
  const range = request.headers.get("range");
  if (!range) {
    headers.set("Content-Length", String(file.size));
    return new Response(file, { headers });
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  const start = match?.[1] ? Number(match[1]) : Math.max(0, file.size - Number(match?.[2]));
  const end = match?.[1] && match[2] ? Math.min(Number(match[2]), file.size - 1) : file.size - 1;
  if (!match || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end) {
    headers.set("Content-Range", "bytes */" + file.size);
    return new Response(null, { status: 416, headers });
  }
  headers.set("Content-Range", `bytes ${start}-${end}/${file.size}`);
  headers.set("Content-Length", String(end - start + 1));
  return new Response(file.slice(start, end + 1, file.type), { status: 206, headers });
}
