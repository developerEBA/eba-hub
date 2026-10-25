import {
  LayoutDashboard,
  CheckSquare2,
  FolderKanban,
  MessagesSquare,
  Video,
  Award,
  ShieldCheck,
  Users,
  Settings,
  Megaphone,
  Briefcase,
  CheckCheck,
  Files,
  ChartNoAxesCombined,
  Sparkles,
} from "lucide-react";
const definitions = [
  ["leave", "Leave Requests", Briefcase, "Submit and track leave requests."],
  [
    "workspace",
    "My Workspace",
    Briefcase,
    "Your personal workspace is coming soon.",
  ],
  [
    "notifications",
    "Notifications",
    MessagesSquare,
    "Live notifications are not connected.",
  ],
  ["tasks", "My Tasks", CheckSquare2, "Focus on the work that matters."],
  [
    "projects",
    "Projects",
    FolderKanban,
    "Shared direction. Meaningful progress.",
  ],
  [
    "chat",
    "EBA Connect",
    MessagesSquare,
    "Keep ideas and conversations together.",
  ],
  ["meetings", "Smart Calendar", Video, "Make time for good conversations."],
  [
    "recognition",
    "Employee Recognition",
    Award,
    "Celebrate the people behind the work.",
  ],
  [
    "directory",
    "Team Directory",
    Users,
    "Find your people and their expertise.",
  ],
  [
    "admin",
    "Admin Console",
    ShieldCheck,
    "Employee access and workspace governance.",
  ],
  ["settings", "Settings", Settings, "Make the workspace your own."],
  [
    "campaigns",
    "Campaigns & PR",
    Megaphone,
    "Campaign planning and media relations.",
  ],
  ["clients", "Clients", Briefcase, "A shared view of client relationships."],
  [
    "approvals",
    "Approvals",
    CheckCheck,
    "Clear decisions and accountable reviews.",
  ],
  ["files", "Files & Knowledge", Files, "A home for shared knowledge."],
  [
    "reports",
    "Reports & Analytics",
    ChartNoAxesCombined,
    "Understand team delivery.",
  ],
  [
    "assistant",
    "EBA Assistant",
    Sparkles,
    "Workspace assistance, coming soon.",
  ],
] as const;
export const modules = definitions.map(([slug, label, icon, title]) => ({
  slug,
  label,
  icon,
  title,
  eyebrow: "EBA WORKSPACE",
  empty: `${label} is coming soon`,
  description:
    "This integration is not connected. No production actions are available.",
}));
export const navigation = [
  { slug: "", label: "Overview", icon: LayoutDashboard },
  ...modules.filter(
    ({ slug }) => slug !== "workspace" && slug !== "notifications",
  ),
];
export function getModule(slug: string) {
  return modules.find((item) => item.slug === slug);
}
