"use client";

import { useState } from "react";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <>
      <Header onMenuClick={() => setMobileNavOpen((v) => !v)} />
      <div className="flex min-h-0 flex-1">
        <Sidebar mobileOpen={mobileNavOpen} onNavigate={() => setMobileNavOpen(false)} />
        <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6">{children}</main>
      </div>
    </>
  );
}
