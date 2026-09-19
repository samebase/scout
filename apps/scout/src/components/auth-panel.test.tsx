// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { AUTH_EMAIL_COOLDOWN } from "../../shared/auth";
import { AuthPanel } from "./auth-panel";
import { TERMS_ACCEPTANCE_LABEL } from "../../shared/terms";
import { SESSION_RECORDING_LABEL } from "../../shared/sessionRecording";

const remote = vi.hoisted(() => ({ signIn: vi.fn() }));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({
    signIn: remote.signIn,
  }),
}));
afterEach(cleanup);
beforeEach(() => {
  remote.signIn.mockReset().mockRejectedValue(new ConvexError(AUTH_EMAIL_COOLDOWN));
});

test("an email cooldown shows retry guidance instead of a credentials error", async () => {
  const user = userEvent.setup();
  const router = createRouter({
    routeTree: createRootRoute({
      staticData: { access: "access_public" },
      component: AuthPanel,
    }),
    history: createMemoryHistory(),
  });
  render(<RouterProvider router={router} />);
  await user.type(await screen.findByRole("textbox", { name: "Email" }), "member@example.test");
  await user.type(screen.getByLabelText("Password", { exact: true }), "secure-password");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Wait a minute before requesting another code.",
  );
});

test("signup requires an unchecked terms box and sends acceptance", async () => {
  remote.signIn.mockResolvedValue({ signingIn: false });
  const user = userEvent.setup();
  const router = createRouter({
    routeTree: createRootRoute({ staticData: { access: "access_public" }, component: AuthPanel }),
    history: createMemoryHistory(),
  });
  render(<RouterProvider router={router} />);
  await user.click(await screen.findByRole("button", { name: "Create account" }));
  const checkbox = screen.getByRole("checkbox", { name: TERMS_ACCEPTANCE_LABEL });
  expect(checkbox).toHaveProperty("checked", false);
  expect(checkbox).toHaveProperty("required", true);
  expect(screen.getByRole("link", { name: "Terms and conditions" }).getAttribute("href")).toBe(
    "/terms",
  );
  expect(screen.getByRole("link", { name: "Privacy policy" }).getAttribute("href")).toBe(
    "/privacy",
  );
  const recording = screen.getByRole("checkbox", { name: SESSION_RECORDING_LABEL });
  expect(recording).toHaveProperty("checked", false);
  expect(recording).toHaveProperty("required", false);
  expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  await user.type(screen.getByRole("textbox", { name: "Email" }), "member@example.test");
  await user.type(screen.getByLabelText("Password", { exact: true }), "secure-password");
  await user.click(screen.getByRole("button", { name: "Create account" }));
  expect(remote.signIn).not.toHaveBeenCalled();
  await user.click(checkbox);
  await user.click(screen.getByRole("button", { name: "Create account" }));
  expect(remote.signIn).toHaveBeenCalledOnce();
  const data: unknown = remote.signIn.mock.calls[0]?.[1];
  expect(data).toBeInstanceOf(FormData);
  if (!(data instanceof FormData)) throw new Error("Expected signup form data");
  expect(data.get("termsAccepted")).toBe("true");
  expect(data.get("sessionRecordingConsent")).toBeNull();
  expect(data.get("flow")).toBe("signUp");
  expect(await screen.findByRole("button", { name: "Verify email" })).toBeTruthy();
});

test("returning to signup clears acceptance, and sign-in has no acceptance checkbox", async () => {
  const user = userEvent.setup();
  const router = createRouter({
    routeTree: createRootRoute({ staticData: { access: "access_public" }, component: AuthPanel }),
    history: createMemoryHistory(),
  });
  render(<RouterProvider router={router} />);
  await user.click(await screen.findByRole("button", { name: "Create account" }));
  await user.click(screen.getByRole("checkbox", { name: TERMS_ACCEPTANCE_LABEL }));
  await user.click(screen.getByRole("checkbox", { name: SESSION_RECORDING_LABEL }));
  await user.click(screen.getByRole("button", { name: "Sign in instead" }));
  expect(screen.queryByRole("checkbox")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Create account" }));
  expect(screen.getByRole("checkbox", { name: TERMS_ACCEPTANCE_LABEL })).toHaveProperty(
    "checked",
    false,
  );
  expect(screen.getByRole("checkbox", { name: SESSION_RECORDING_LABEL })).toHaveProperty(
    "checked",
    false,
  );
});
