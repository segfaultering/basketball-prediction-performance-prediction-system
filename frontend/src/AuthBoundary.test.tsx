import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AuthBoundary from "./AuthBoundary";

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
}));
vi.mock("./auth", () => ({
  authEnabled: true,
  authConfigurationError: "",
  supabase: { auth },
}));
let changed: (event: AuthChangeEvent, session: Session | null) => void;
const unsubscribe = vi.fn();
const session: Session = {
  access_token: "token",
  refresh_token: "refresh",
  expires_in: 3600,
  token_type: "bearer",
  user: {
    id: "user-one",
    email: "one@example.com",
    aud: "authenticated",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-10-12T00:00:00Z",
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  auth.onAuthStateChange.mockImplementation((callback) => {
    changed = callback;
    return { data: { subscription: { unsubscribe } } };
  });
  auth.signInWithPassword.mockResolvedValue({ error: null });
  auth.signUp.mockResolvedValue({ data: { session: null }, error: null });
  auth.resetPasswordForEmail.mockResolvedValue({ error: null });
  auth.updateUser.mockResolvedValue({ error: null });
});
afterEach(cleanup);
function mount(required = true) {
  const replay = vi.fn();
  render(
    <AuthBoundary required={required} replay={replay}>
      {(session) => <p>Dashboard: {session?.user.email || "visitor"}</p>}
    </AuthBoundary>,
  );
  return replay;
}
it("allows anonymous replay without a login form", () => {
  mount(false);
  expect(screen.getByText("Dashboard: visitor")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
});
it("signs in with email/password and clears account content on sign-out", async () => {
  mount();
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "Sign in" });
  await user.type(screen.getByLabelText("Email"), "one@example.com");
  await user.type(screen.getByLabelText("Password"), "password123");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  expect(auth.signInWithPassword).toHaveBeenCalledWith({
    email: "one@example.com",
    password: "password123",
  });
  act(() => changed("SIGNED_IN", session));
  expect(screen.getByText("Dashboard: one@example.com")).toBeTruthy();
  act(() => changed("SIGNED_OUT", null));
  expect(screen.queryByText("Dashboard: one@example.com")).toBeNull();
  expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
});
it("asks new users to confirm their email", async () => {
  mount();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Create an account" }),
  );
  await user.type(screen.getByLabelText("Email"), "one@example.com");
  await user.type(screen.getByLabelText("Password"), "password123");
  await user.click(screen.getByRole("button", { name: "Create account" }));
  expect((await screen.findByRole("status")).textContent).toContain(
    "confirmation link",
  );
  expect(auth.signUp).toHaveBeenCalledWith(
    expect.objectContaining({
      email: "one@example.com",
      options: { emailRedirectTo: `${location.origin}${location.pathname}` },
    }),
  );
});
it("explains incorrect credentials without exposing an upstream error", async () => {
  auth.signInWithPassword.mockResolvedValue({
    error: { code: "invalid_credentials", message: "internal detail" },
  });
  mount();
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "Sign in" });
  await user.type(screen.getByLabelText("Email"), "one@example.com");
  await user.type(screen.getByLabelText("Password"), "wrong");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "The email or password is incorrect. Please try again.",
  );
});
it("sends password reset links and accepts a new password after recovery", async () => {
  mount();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Forgot password?" }),
  );
  await user.type(screen.getByLabelText("Email"), "one@example.com");
  await user.click(screen.getByRole("button", { name: "Send reset email" }));
  expect((await screen.findByRole("status")).textContent).toContain(
    "If an account exists",
  );
  act(() => changed("PASSWORD_RECOVERY", session));
  await user.type(screen.getByLabelText("Password"), "newpassword123");
  await user.click(screen.getByRole("button", { name: "Update password" }));
  expect(auth.updateUser).toHaveBeenCalledWith({ password: "newpassword123" });
  await screen.findByText("Dashboard: one@example.com");
});
it("offers replay when session restoration fails and unsubscribes on unmount", async () => {
  auth.getSession.mockRejectedValue(new Error("Network failure"));
  const replay = mount();
  await screen.findByRole("alert");
  await userEvent.click(
    screen.getByRole("button", { name: "Explore NBA replay" }),
  );
  expect(replay).toHaveBeenCalled();
  cleanup();
  expect(unsubscribe).toHaveBeenCalled();
});
