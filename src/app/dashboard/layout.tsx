import type { ReactNode } from "react";
import { GalaxyBackground } from "./galaxy/galaxy-background";
import "./dashboard.css";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="eba-dashboard-backdrop">
      <GalaxyBackground />
      {children}
    </div>
  );
}
