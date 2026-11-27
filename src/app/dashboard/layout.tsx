import type { ReactNode } from "react";
import "./dashboard.css";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="eba-dashboard-backdrop">
      {children}
    </div>
  );
}
