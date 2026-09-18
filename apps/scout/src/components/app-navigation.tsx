import { canAccess, useViewerAccess } from "../lib/access";
import { CreditBalanceLink } from "./credits-panel";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  BotIcon,
  EllipsisIcon,
  FocusIcon,
  SettingsIcon,
  TelescopeIcon,
  UsersIcon,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { Button } from "./ui/button";

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
        <LegalMenu />
      </div>
    </header>
  );
}

function LegalMenu() {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 text-muted-foreground"
          aria-label="More options"
        >
          <EllipsisIcon aria-hidden="true" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          collisionPadding={8}
          className="z-50 min-w-52 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <DropdownMenu.Item asChild>
            <Link
              to="/privacy"
              className="flex min-h-11 items-center rounded-md px-3 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
            >
              Privacy policy
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild>
            <Link
              to="/terms"
              className="flex min-h-11 items-center rounded-md px-3 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
            >
              Terms and conditions
            </Link>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
