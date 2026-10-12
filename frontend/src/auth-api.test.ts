import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { request, setDataMode } from "./api";

const accessToken = vi.hoisted(() => vi.fn());
vi.mock("./auth", () => ({ authEnabled: true, accessToken }));
beforeEach(() => {
  setDataMode("live");
  accessToken.mockResolvedValue("user-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ ok: true }))),
  );
});
afterEach(() => {
  setDataMode("server");
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("sends refreshed bearer tokens and preserves JSON content headers", async () => {
  await request("/predictions", undefined, { player_id: "1", game_id: "1" });
  expect(fetch).toHaveBeenLastCalledWith(
    "/predictions",
    expect.objectContaining({
      headers: {
        Authorization: "Bearer user-token",
        "Content-Type": "application/json",
      },
      method: "POST",
    }),
  );
  accessToken.mockResolvedValue("refreshed-token");
  await request("/forecasts");
  expect(fetch).toHaveBeenLastCalledWith(
    "/forecasts",
    expect.objectContaining({
      headers: { Authorization: "Bearer refreshed-token" },
    }),
  );
});
it("keeps authenticated live history on the API instead of browser storage", async () => {
  const result = await request("/forecasts/refresh", undefined, {});
  expect(result).toEqual({ ok: true });
  expect(fetch).toHaveBeenCalledWith(
    "/forecasts/refresh",
    expect.objectContaining({ method: "POST" }),
  );
});
it("does not start an API request without a valid session", async () => {
  accessToken.mockRejectedValue(new Error("Please sign in"));
  await expect(request("/games")).rejects.toThrow("Please sign in");
  expect(fetch).not.toHaveBeenCalled();
});
it("keeps health public and explains expired sessions", async () => {
  await request("/health");
  expect(accessToken).not.toHaveBeenCalled();
  vi.mocked(fetch).mockResolvedValue(
    new Response("Unauthorized", { status: 401 }),
  );
  await expect(request("/games")).rejects.toThrow("Your session has expired");
});
