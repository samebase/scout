import { canAccess, useViewerAccess } from "../lib/access";
import { CreditBalanceLink } from "./credits-panel";
import { Link, useRouterState } from "@tanstack/react-router";
import { BotIcon, FocusIcon, SettingsIcon, TelescopeIcon, UsersIcon } from "lucide-react";

const navigationLinkClass =
  "group inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground";

export function AppNavigation() {
  const viewer = useViewerAccess();
  const reviewPage = useRouterState({
    select: (state) =>
      state.location.pathname === "/" ||
      state.location.pathname.startsWith("/tasks/") ||
      state.location.pathname.startsWith("/sites/"),
  });
  const permissions = viewer?.kind === "account" ? viewer.accessKeys : [];
  return (
    <header className="app-navigation">
      <div className="app-navigation__inner">
        <Link
          to="/"
          activeOptions={{ exact: true }}
          className="app-navigation__brand"
          aria-label="Scout home"
        >
          <span className="app-navigation__mark" aria-hidden="true">
            <TelescopeIcon />
          </span>
          <span className="hidden font-semibold tracking-[-0.02em] sm:inline">Scout</span>
        </Link>

        <nav className="app-navigation__routes" aria-label="Primary navigation">
          <Link
            to="/"
            activeOptions={{ exact: true }}
            aria-current={reviewPage ? "page" : undefined}
            className={navigationLinkClass}
          >
            <FocusIcon aria-hidden="true" />
            <span>Reviews</span>
          </Link>
          {canAccess("access_scout_view", permissions) && (
            <Link to="/scouts" className={navigationLinkClass}>
              <UsersIcon aria-hidden="true" />
              <span>Scouts</span>
            </Link>
          )}
          {canAccess("access_lab", permissions) && (
            <Link to="/agents" search={{}} className={navigationLinkClass}>
              <BotIcon aria-hidden="true" />
              <span>Agents</span>
            </Link>
          )}
          {canAccess("access_members_manage", permissions) && (
            <Link to="/members" className={navigationLinkClass}>
              Members
            </Link>
          )}
        </nav>

        {viewer?.kind === "account" && (
          <>
            <CreditBalanceLink />
            <Link to="/settings" className={`${navigationLinkClass} app-navigation__settings`}>
              <SettingsIcon aria-hidden="true" />
              <span className="sr-only sm:not-sr-only">Settings</span>
            </Link>
          </>
        )}
        {viewer?.kind === "anonymous" && (
          <Link to="/settings" className={navigationLinkClass}>
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
