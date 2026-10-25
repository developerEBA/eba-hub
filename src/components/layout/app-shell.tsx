"use client";

import Link from "next/link";
import { DashboardShell, type DashboardHeader } from "./dashboard-shell";
import { WorkspaceTools } from "./workspace-tools";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  ArrowUpRight,
  Menu,
  X,
  CircleHelp,
  PanelLeftClose,
} from "lucide-react";
import { navigation } from "@/modules/workspace/config";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function AppShell({
  children,
  preview,
  header,
}: {
  children: React.ReactNode;
  preview: boolean;
  header?: DashboardHeader;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const current = navigation.find(
    (item) => pathname === `/dashboard${item.slug ? `/${item.slug}` : ""}`,
  );

  if (pathname === "/dashboard")
    return (
      <DashboardShell
        header={
          header ?? {
            displayName: "Setup required",
            role: "",
            ready: false,
            counts: null,
          }
        }
      >
        {children}
      </DashboardShell>
    );
  return (
    <div className="min-h-screen">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      {mobileOpen && (
        <button
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        id="workspace-sidebar"
        aria-label="Workspace sidebar"
        className={cn(
          "sidebar",
          collapsed && "sidebar-collapsed",
          mobileOpen && "sidebar-open",
        )}
      >
        <Link
          href="/dashboard"
          onClick={() => setMobileOpen(false)}
          className="brand"
          aria-label="EBA Hub overview"
        >
          <span className="brand-mark">
            e<span>ba</span>
            <i />
          </span>
          <span className="sidebar-copy border-l border-white/20 pl-3 text-lg font-medium tracking-tight">
            hub
            <span className="block text-[9px] tracking-[.19em] text-white/50">
              OUR WORKSPACE
            </span>
          </span>
        </Link>
        <button
          className="absolute right-3 top-5 p-2 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
        >
          <X size={20} />
        </button>
        <div className="sidebar-copy mb-4 px-6 text-[10px] font-medium tracking-[.17em] text-white/40">
          WORKSPACE
        </div>
        <nav
          aria-label="Main navigation"
          className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3"
        >
          {navigation.map(({ slug, label, icon: Icon }) => {
            const href = `/dashboard${slug ? `/${slug}` : ""}`;
            return (
              <Link
                key={href}
                href={href}
                title={collapsed ? label : undefined}
                aria-label={collapsed ? label : undefined}
                aria-current={pathname === href ? "page" : undefined}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "nav-link",
                  pathname === href && "nav-link-active",
                )}
              >
                <Icon size={19} aria-hidden="true" />
                <span className="sidebar-copy">{label}</span>
                {slug === "chat" && (
                  <span className="sidebar-copy ml-auto size-1.5 rounded-full bg-card/35" />
                )}
              </Link>
            );
          })}
        </nav>
        <div className="shrink-0 p-4">
          <div className="sidebar-copy hidden rounded-xl border border-white/10 bg-card/5 p-4">
            <span className="text-xl text-accent">✳</span>
            <p className="mt-3 text-sm font-medium">
              One team. Shared ambition.
            </p>
            <p className="mt-2 text-xs leading-5 text-white/55">
              A space to connect ideas and build something meaningful.
            </p>
            <div className="mt-4 flex items-center gap-2 text-[10px] tracking-widest text-white/40">
              <span className="size-1 rounded-full bg-accent" /> ENI BRAND
              ARCHITECT
            </div>
          </div>
          <button
            onClick={() => setCollapsed((value) => !value)}
            className="mt-5 hidden w-full items-center gap-3 rounded-lg px-3 py-2 text-xs text-white/60 hover:bg-card/10 lg:flex"
            aria-expanded={!collapsed}
            aria-controls="workspace-sidebar"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <PanelLeftClose
              size={18}
              className={cn(collapsed && "rotate-180")}
            />
            <span className="sidebar-copy">Collapse sidebar</span>
          </button>
        </div>
      </aside>
      <div
        className={cn(
          "workspace-content",
          collapsed && "workspace-content-expanded",
        )}
      >
        <header className="topbar">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
              aria-expanded={mobileOpen}
              aria-controls="workspace-sidebar"
            >
              <Menu size={21} />
            </Button>
            <span className="hidden text-sm text-muted-foreground sm:inline">
              Workspace
            </span>
            <span className="hidden text-border sm:inline">/</span>
            <span className="truncate text-sm font-medium">
              {current?.label ?? "Workspace"}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <WorkspaceTools />
            <span className="hidden rounded-full border border-border px-3 py-1.5 text-[11px] text-muted-foreground sm:inline">
              {preview ? "Setup required" : "Workspace session"}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Workspace help"
              aria-expanded={helpOpen}
              onClick={() => setHelpOpen((value) => !value)}
            >
              <CircleHelp size={19} />
            </Button>
          </div>
        </header>
        {helpOpen && (
          <div
            className="mx-5 mt-4 rounded-xl border border-border bg-card p-5 text-sm lg:mx-9"
            role="status"
          >
            <strong>Welcome to your workspace foundation.</strong>
            <p className="mt-1 text-muted-foreground">
              Data operations require an approved employee session and
              configured Supabase services. Contact your administrator for
              access and setup.
            </p>
          </div>
        )}
        {!header?.ready && (
          <div
            className="mx-5 mt-4 rounded-lg bg-secondary p-3 text-xs text-secondary-foreground lg:mx-9"
            role="status"
          >
            Setup required: live database records are unavailable.
          </div>
        )}
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto max-w-[1600px] p-5 outline-none lg:p-9"
        >
          {children}
        </main>
        <footer className="mx-5 flex flex-wrap items-center justify-between gap-2 border-t border-border py-5 text-[10px] text-muted-foreground lg:mx-9">
          <span>© ENI Brand Architect · EBA Hub</span>
          <span className="flex items-center gap-1">
            Built for the way we work <ArrowUpRight size={12} />
          </span>
        </footer>
      </div>
    </div>
  );
}
