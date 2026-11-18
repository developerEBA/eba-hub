import { requireDashboardAccess } from "../../../access";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { client } = await requireDashboardAccess();
  const { id } = await params;
  const headers = { "Cache-Control": "private, no-store" };
  if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id)) {
    return new Response(null, { status: 404, headers });
  }

  const { data: attachment } = await client
    .from("department_plan_attachments")
    .select("filename, object_path")
    .eq("id", id)
    .maybeSingle();

  if (!attachment) return new Response(null, { status: 404, headers });

  const { data: file, error } = await client.storage
    .from("department-plan-files")
    .download(attachment.object_path);
  if (error || !file) return new Response(null, { status: 404, headers });

  const filename = encodeURIComponent(attachment.filename).replace(/['()*]/g, (char) =>
    "%" + char.charCodeAt(0).toString(16),
  );
  return new Response(file, {
    headers: {
      ...headers,
      "Content-Type": "application/octet-stream",
      "Content-Disposition": "attachment; filename*=UTF-8''" + filename,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
