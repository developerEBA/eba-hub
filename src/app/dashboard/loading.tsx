import { Skeleton } from "@/components/ui/skeleton";
export default function Loading() {
  return (
    <div role="status" aria-label="Loading workspace" className="space-y-6">
      <span className="sr-only">Loading workspace…</span>
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-44 w-full" />
      <div className="grid gap-5 md:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-64" />
        ))}
      </div>
    </div>
  );
}
