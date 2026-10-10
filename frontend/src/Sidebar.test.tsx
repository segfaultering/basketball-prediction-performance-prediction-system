import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Sidebar from "./Sidebar";

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
});
afterEach(cleanup);

it("opens from the hamburger and closes after navigation or the close button", async () => {
  const user = userEvent.setup();
  const navigate = vi.fn();
  render(
    <Sidebar view="predictions" navigate={navigate} help={vi.fn()} online />,
  );
  const toggle = screen.getByRole("button", { name: "Open navigation" });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("dialog")).toBeNull();
  await user.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(
    screen
      .getByRole("button", { name: "Player predictions" })
      .getAttribute("aria-current"),
  ).toBe("page");
  await user.click(screen.getByRole("button", { name: "Model insights" }));
  expect(navigate).toHaveBeenCalledWith("insights");
  expect(screen.queryByRole("dialog")).toBeNull();
  await user.click(toggle);
  await user.click(screen.getByRole("button", { name: "Close navigation" }));
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
});

it("dismisses on Escape cancellation and backdrop clicks, but keeps interior clicks open", async () => {
  const user = userEvent.setup();
  render(
    <Sidebar view="predictions" navigate={vi.fn()} help={vi.fn()} online />,
  );
  const toggle = screen.getByRole("button", { name: "Open navigation" });
  await user.click(toggle);
  let dialog = screen.getByRole("dialog");
  vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    right: 320,
    bottom: 800,
  } as DOMRect);
  fireEvent.click(dialog, { clientX: 100, clientY: 300 });
  expect(screen.getByRole("dialog")).toBeTruthy();
  fireEvent.click(dialog, { clientX: 400, clientY: 300 });
  expect(screen.queryByRole("dialog")).toBeNull();
  await user.click(toggle);
  dialog = screen.getByRole("dialog");
  fireEvent(dialog, new Event("cancel"));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("closes navigation before opening help", async () => {
  const user = userEvent.setup();
  const help = vi.fn();
  render(
    <Sidebar view="tracking" navigate={vi.fn()} help={help} online={false} />,
  );
  await user.click(screen.getByRole("button", { name: "Open navigation" }));
  await user.click(screen.getByRole("button", { name: "How it works" }));
  expect(help).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).toBeNull();
});
