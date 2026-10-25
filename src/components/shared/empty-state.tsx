import type { LucideIcon } from "lucide-react";
export function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center px-4 py-6 text-center">
      <div className="mb-3 rounded-xl bg-muted p-3 text-primary">
        <Icon size={21} aria-hidden="true" />
      </div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1 max-w-64 text-xs leading-5 text-muted-foreground">
        {description}
      </p>
    </div>
  );
}
