import { canAccess, useViewerAccess } from "../lib/access";
import { Link } from "@tanstack/react-router";
import {
  Gamepad2Icon,
  GlobeIcon,
  MessageSquareIcon,
  SettingsIcon,
  TelescopeIcon,
  UsersIcon,
} from "lucide-react";

const navigationLinkClass =
  "group inline-flex h-9 shrink-0 items-center gap-2 rounded-[0.625rem] px-3 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground";

export function AppNavigation() {
  const viewer = useViewerAccess();
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
          {canAccess("access_play", permissions) && (
            <Link to="/play" className={navigationLinkClass}>
              <Gamepad2Icon aria-hidden="true" />
              <span>Play</span>
            </Link>
          )}
          {canAccess("access_lab", permissions) && (
            <Link to="/chats" className={navigationLinkClass}>
              <MessageSquareIcon aria-hidden="true" />
              <span>Chats</span>
            </Link>
          )}
          {canAccess("access_scout_manage", permissions) && (
            <Link to="/scouts" className={navigationLinkClass}>
              <UsersIcon aria-hidden="true" />
              <span>Scouts</span>
            </Link>
          )}
          {canAccess("access_lab", permissions) && (
            <Link to="/sites" className={navigationLinkClass}>
              <GlobeIcon aria-hidden="true" />
              <span>Sites</span>
            </Link>
          )}
          {canAccess("access_review", permissions) && (
            <Link to="/review" className={navigationLinkClass}>
              Review
            </Link>
          )}
          {canAccess("access_members_manage", permissions) && (
            <Link to="/members" className={navigationLinkClass}>
              Members
            </Link>
          )}
        </nav>

        <Link to="/settings" className={`${navigationLinkClass} app-navigation__settings`}>
          <SettingsIcon aria-hidden="true" />
          <span className="sr-only sm:not-sr-only">Settings</span>
        </Link>
      </div>
    </header>
  );
}
