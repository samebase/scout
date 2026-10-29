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
import { AuthPanel } from "./auth-panel";

const remote = vi.hoisted(() => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  startPasswordRecovery: vi.fn(),
}));

vi.mock("@convex-dev/auth/methods/email-password/react", () => ({
  useSignInWithEmailPassword: () => ({ signIn: remote.signIn, pending: false }),
  useSignUpWithEmailPassword: () => ({ signUp: remote.signUp, pending: false }),
  useStartPasswordRecovery: () => ({
    startPasswordRecovery: remote.startPasswordRecovery,
    pending: false,
  }),
}));
afterEach(cleanup);
beforeEach(() => {
  remote.signIn.mockReset();
  remote.signUp.mockReset();
  remote.startPasswordRecovery.mockReset();
});

async function renderPanel() {
  const router = createRouter({
    routeTree: createRootRoute({ staticData: { access: "access_public" }, component: AuthPanel }),
    history: createMemoryHistory(),
  });
  render(<RouterProvider router={router} />);
  return await screen.findByRole("textbox", { name: "Email" });
}

test("sign-in shows the method's error codes as guidance", async () => {
  const user = userEvent.setup();
  remote.signIn
    .mockResolvedValueOnce({ status: "error", userError: { error: "INVALID_CREDENTIALS" } })
    .mockResolvedValueOnce({
      status: "error",
      userError: { error: "RATE_LIMITED", retryAfterMs: 42_100 },
    });
  await user.type(await renderPanel(), "member@example.test");
  await user.type(screen.getByLabelText("Password", { exact: true }), "secure-password");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Email or password is incorrect.");
  expect(remote.signIn).toHaveBeenCalledWith({
    email: "member@example.test",
    password: "secure-password",
  });
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Too many attempts. Try again in 43 seconds.",
  );
});

test("sign-up sends only the email and password, then asks for the link in this browser", async () => {
  const user = userEvent.setup();
  remote.signUp
    .mockResolvedValueOnce({
      success: false,
      userError: {
        error: "OTHER_ERROR",
        cause: new ConvexError("This password is too common. Choose another one."),
      },
    })
    .mockResolvedValueOnce({ success: true });
  await renderPanel();
  await user.click(screen.getByRole("button", { name: "Create account" }));
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.getByLabelText("Password", { exact: true }).getAttribute("minlength")).toBe("10");
  await user.type(screen.getByRole("textbox", { name: "Email" }), " member@example.test ");
  await user.type(screen.getByLabelText("Password", { exact: true }), "secure-password");
  await user.click(screen.getByRole("button", { name: "Create account" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "This password is too common. Choose another one.",
  );
  await user.click(screen.getByRole("button", { name: "Create account" }));
  expect(remote.signUp).toHaveBeenLastCalledWith({
    email: "member@example.test",
    password: "secure-password",
  });
  expect(await screen.findByRole("heading", { name: "Check your email" })).toBeTruthy();
  expect(
    screen.getByText("Open the link sent to member@example.test in this browser."),
  ).toBeTruthy();
});

test("a recovery link is sent to the address that the server returns", async () => {
  const user = userEvent.setup();
  remote.startPasswordRecovery
    .mockResolvedValueOnce({ success: false, userError: { error: "EMAIL_NOT_FOUND" } })
    .mockResolvedValueOnce({ success: true, sentTo: "Member@example.test" });
  await renderPanel();
  await user.click(screen.getByRole("button", { name: "Forgot password?" }));
  await user.type(screen.getByRole("textbox", { name: "Email" }), "member@example.test");
  await user.click(screen.getByRole("button", { name: "Send reset link" }));
  expect((await screen.findByRole("alert")).textContent).toBe("No account uses this email.");
  await user.click(screen.getByRole("button", { name: "Send reset link" }));
  expect(
    await screen.findByText("Open the link sent to Member@example.test in this browser."),
  ).toBeTruthy();
});
