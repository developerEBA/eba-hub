import { notFound } from "next/navigation";
import { getModule } from "@/modules/workspace/config";
import { OperationsPage } from "@/modules/operations/operations-page";
export default async function ModulePage({
  params,
  searchParams,
}: {
  params: Promise<{ module: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const moduleSlug = (await params).module;
  const item = getModule(moduleSlug);
  if (!item) notFound();
  return (
    <div className="space-y-7">
      <div>
        <p className="eyebrow">EBA WORKSPACE</p>
        <h1 className="page-title">{item.label}</h1>
      </div>
      <OperationsPage
        module={moduleSlug}
        searchParams={Object.fromEntries(
          Object.entries(await searchParams).map(([key, value]) => [
            key,
            Array.isArray(value) ? value[0] : value,
          ]),
        )}
      />
    </div>
  );
}
