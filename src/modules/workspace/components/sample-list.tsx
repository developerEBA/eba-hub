import { Card } from "@/components/ui/card";
import { sampleData } from "@/modules/workspace/sample-data";
export function SampleList({ module }: { module: string }) {
  const rows = sampleData[module];
  if (!rows) return null;
  return (
    <Card>
      <p className="eyebrow mb-4">SAMPLE DATA · FICTIONAL RECORDS</p>
      <ul className="divide-y divide-border">
        {rows.map((row) => (
          <li
            key={row.title}
            className="flex flex-wrap items-center justify-between gap-3 py-5"
          >
            <div>
              <h2 className="font-sans text-sm font-semibold">{row.title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{row.detail}</p>
            </div>
            <span className="status-chip">{row.status}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 border-t border-border pt-4 text-xs text-muted-foreground">
        Presentation only. No records are saved or sent.
      </p>
    </Card>
  );
}
