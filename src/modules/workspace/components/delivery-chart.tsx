"use client";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
const data = [
  { week: "Week 1", completed: 4 },
  { week: "Week 2", completed: 7 },
  { week: "Week 3", completed: 5 },
  { week: "Week 4", completed: 9 },
];
export function DeliveryChart() {
  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <h2 className="text-lg">Sample delivery overview</h2>
      <p className="my-3 text-sm text-muted-foreground">
        Fictional completed tasks per week. Not an employee performance score.
      </p>
      <div className="h-72 min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} accessibilityLayer>
            <XAxis dataKey="week" />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="completed" fill="#6e997d" radius={[5, 5, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="mt-4 w-full text-sm">
        <caption className="text-left">Sample chart data</caption>
        <thead>
          <tr>
            <th className="text-left">Week</th>
            <th className="text-right">Completed tasks</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.week}>
              <td>{row.week}</td>
              <td className="text-right">{row.completed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
