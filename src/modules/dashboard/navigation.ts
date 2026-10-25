import type { LucideIcon } from "lucide-react";
import {
  House,
  BriefcaseBusiness,
  Bot,
  FolderKanban,
  SquareCheckBig,
  CalendarDays,
  Trophy,
  UsersRound,
  ContactRound,
  Megaphone,
  File,
  CircleCheck,
  ChartNoAxesColumn,
  Bell,
  Settings,
} from "lucide-react";
export const dashboardNavigation: {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: number;
}[] = [
  { label: "Overview", href: "/dashboard", icon: House },
  {
    label: "My Workspace",
    href: "/dashboard/workspace",
    icon: BriefcaseBusiness,
  },
  { label: "EBA Connect", href: "/dashboard/chat", icon: Bot, badge: 3 },
  { label: "Projects", href: "/dashboard/projects", icon: FolderKanban },
  { label: "My Tasks", href: "/dashboard/tasks", icon: SquareCheckBig },
  { label: "Smart Calendar", href: "/dashboard/meetings", icon: CalendarDays },
  { label: "Recognition", href: "/dashboard/recognition", icon: Trophy },
  { label: "Employees", href: "/dashboard/directory", icon: UsersRound },
  { label: "Clients", href: "/dashboard/clients", icon: ContactRound },
  { label: "Campaigns", href: "/dashboard/campaigns", icon: Megaphone },
  { label: "Files & Documents", href: "/dashboard/files", icon: File },
  {
    label: "Approvals",
    href: "/dashboard/approvals",
    icon: CircleCheck,
    badge: 2,
  },
  { label: "Analytics", href: "/dashboard/reports", icon: ChartNoAxesColumn },
  { label: "EBA Assistant", href: "/dashboard/assistant", icon: Bot },
  {
    label: "Notifications",
    href: "/dashboard/notifications",
    icon: Bell,
    badge: 5,
  },
  { label: "Settings", href: "/dashboard/settings", icon: Settings },
];
