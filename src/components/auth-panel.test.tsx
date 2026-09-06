// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConvexError } from "convex/values";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { AUTH_EMAIL_COOLDOWN } from "../../shared/auth";
import { AuthPanel } from "./auth-panel";

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({
    signIn: async () => {
      throw new ConvexError(AUTH_EMAIL_COOLDOWN);
    },
  }),
}));
afterEach(cleanup);

test("an email cooldown shows retry guidance instead of a credentials error", async () => {
  const user = userEvent.setup();
  render(<AuthPanel />);
  await user.type(screen.getByRole("textbox", { name: "Email" }), "member@example.test");
  await user.type(screen.getByLabelText("Password", { exact: true }), "secure-password");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Wait a minute before requesting another code.",
  );
});
