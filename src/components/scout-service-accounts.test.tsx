// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { api } from "../../convex/_generated/api";
import { ServiceAccountsSection } from "./scout-service-accounts";

const remote = vi.hoisted(() => ({ savePassword: vi.fn(), saveOAuth: vi.fn() }));
vi.mock("convex/react", () => ({
  useAction: () => remote.savePassword,
  useMutation: () => remote.saveOAuth,
}));

const scout: NonNullable<FunctionReturnType<typeof api.scout.scouts.get>> = {
  // @ts-expect-error This rendering fixture uses an opaque string in place of a database-issued Scout ID.
  _id: "scout-magda",
  displayName: "Magda",
  slug: "magda",
  status: "active",
  websiteIdentity: { firstName: "Magda", lastName: "Scout" },
  agentMail: { inboxId: "magda", address: "magda@example.test" },
  firecrawl: { profileName: "magda" },
};
const github: FunctionReturnType<typeof api.scout.serviceAccounts.list>[number] = {
  // @ts-expect-error This rendering fixture uses an opaque string in place of a database-issued account ID.
  _id: "account-github",
  scoutId: scout._id,
  serviceName: "GitHub",
  serviceDomain: "github.com",
  identifier: "magda-scout",
  authenticationEvidence: { kind: "none" },
  lastObserved: null,
  loginMethod: { kind: "managed_password", credentialHost: "github.com", createdAt: 1 },
};

beforeEach(() => {
  remote.savePassword.mockReset().mockResolvedValue({ serviceAccountId: github._id });
  remote.saveOAuth.mockReset().mockResolvedValue({ serviceAccountId: github._id });
});
afterEach(() => cleanup());

describe("Scout profile account form", () => {
  test("saves the password the user entered and clears it after success", async () => {
    const user = userEvent.setup();
    render(<ServiceAccountsSection scout={scout} accounts={[]} />);
    await user.click(screen.getByRole("button", { name: "Add account" }));
    await user.type(screen.getByLabelText("Service name"), "GitHub");
    await user.type(screen.getByLabelText("Service domain"), "github.com");
    const password = screen.getByLabelText("Password", {
      exact: true,
      selector: 'input[type="password"]',
    });
    expect(password.getAttribute("type")).toBe("password");
    await user.type(password, "  chosen password  ");
    await user.click(screen.getByRole("button", { name: "Save account" }));
    expect(remote.savePassword).toHaveBeenCalledExactlyOnceWith({
      account: {
        kind: "create",
        scoutId: scout._id,
        serviceName: "GitHub",
        serviceDomain: "github.com",
        identifier: scout.agentMail.address,
      },
      credentialHost: "github.com",
      password: { kind: "provided", value: "  chosen password  " },
    });
    expect(remote.saveOAuth).not.toHaveBeenCalled();
    expect(screen.queryByRole("form")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Add account" }));
    expect(
      screen
        .getByLabelText("Password", { exact: true, selector: 'input[type="password"]' })
        .getAttribute("value"),
    ).toBe("");
  });

  test("records the selected provider account and discards any password when switching methods", async () => {
    const user = userEvent.setup();
    render(<ServiceAccountsSection scout={scout} accounts={[github]} />);
    await user.click(screen.getByRole("button", { name: "Add account" }));
    await user.type(screen.getByLabelText("Service name"), "Cloudflare");
    await user.type(screen.getByLabelText("Service domain"), "cloudflare.com");
    await user.type(
      screen.getByLabelText("Password", { exact: true, selector: 'input[type="password"]' }),
      "discard this password",
    );
    await user.click(screen.getByRole("radio", { name: "Sign in with another account" }));
    expect(
      screen.queryByLabelText("Password", { exact: true, selector: 'input[type="password"]' }),
    ).toBeNull();
    await user.selectOptions(screen.getByLabelText("Provider account"), github._id);
    await user.click(screen.getByRole("button", { name: "Save account" }));
    expect(remote.saveOAuth).toHaveBeenCalledExactlyOnceWith({
      account: {
        kind: "create",
        scoutId: scout._id,
        serviceName: "Cloudflare",
        serviceDomain: "cloudflare.com",
        identifier: scout.agentMail.address,
      },
      providerAccountId: github._id,
    });
    expect(remote.savePassword).not.toHaveBeenCalled();
  });

  test("edits the existing account, displays safe errors, and clears a cancelled password", async () => {
    const user = userEvent.setup();
    remote.savePassword.mockRejectedValueOnce(
      new ConvexError("Password storage is not configured for this deployment."),
    );
    render(<ServiceAccountsSection scout={scout} accounts={[github]} />);
    await user.click(screen.getByRole("button", { name: "Edit GitHub login" }));
    await user.type(screen.getByLabelText("New password"), "replacement password");
    await user.click(screen.getByRole("button", { name: "Save account" }));
    expect(remote.savePassword).toHaveBeenCalledWith({
      account: { kind: "update", serviceAccountId: github._id, identifier: github.identifier },
      credentialHost: "github.com",
      password: { kind: "provided", value: "replacement password" },
    });
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Password storage is not configured for this deployment.",
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Edit GitHub login" }),
      ),
    );
    await user.click(screen.getByRole("button", { name: "Edit GitHub login" }));
    expect(screen.getByLabelText("New password").getAttribute("value")).toBe("");
    await user.click(screen.getByRole("radio", { name: "Sign in with another account" }));
    expect(screen.getByText("Add the provider account to this Scout first.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save account" }).hasAttribute("disabled")).toBe(
      true,
    );
  });
});
