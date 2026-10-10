import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import PlayerResearch from "./PlayerResearch";
import type { PlayerResearchReport } from "./api";

const report: PlayerResearchReport = {
  availability: "questionable",
  summary: "Participation remains uncertain.",
  status_as_of: "2026-10-10",
  status_source_ids: [0],
  updates: [
    {
      text: "Limited in practice.",
      reported_date: "2026-10-09",
      source_ids: [0],
    },
  ],
  context: {
    player_id: "1",
    player_name: "Alex Player",
    game_id: "game",
    game_date: "2026-10-11",
    team: "LAL",
    opponent: "BOS",
  },
  checked_at: "2026-10-10T10:00:00Z",
  expires_at: "2026-10-10T10:05:00Z",
  sources: [{ id: 0, title: "Team report", url: "https://www.nba.com/report" }],
  search_suggestions_html: "<div>Search suggestions</div>",
  stub_mode: false,
  cached: false,
  model: "gemini-3.1-flash-lite",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("only researches on demand and shows sourced news beside the status", async () => {
  const fetcher = vi.fn(async (_path: string, _init?: RequestInit) =>
    json(report),
  );
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(<PlayerResearch playerId="1" gameId="game" />);
  expect(fetcher).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Research player" }));
  expect(await screen.findByText("Questionable")).toBeTruthy();
  expect(JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string)).toEqual({
    player_id: "1",
    game_id: "game",
  });
  await user.click(screen.getByText("Recent updates (1)"));
  expect(screen.getByText(/Limited in practice/)).toBeTruthy();
  for (const link of screen.getAllByRole("link")) {
    expect(link.getAttribute("href")).toBe("https://www.nba.com/report");
    expect(link.getAttribute("rel")).toContain("noopener");
  }
  const suggestions = screen.getByTitle("Google Search suggestions");
  expect(suggestions.getAttribute("sandbox")).not.toContain("allow-scripts");
  expect(suggestions.getAttribute("sandbox")).not.toContain(
    "allow-same-origin",
  );
});

it("displays setup failures and allows retry", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      json(
        { detail: "Set GEMINI_API_KEY on the server to enable research." },
        503,
      ),
    )
    .mockResolvedValueOnce(json(report));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(<PlayerResearch playerId="1" gameId="game" />);
  await user.click(screen.getByRole("button", { name: "Research player" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    expect.stringContaining("GEMINI_API_KEY"),
  );
  await user.click(screen.getByRole("button", { name: "Research player" }));
  expect(await screen.findByText("Questionable")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("aborts and ignores late responses when the selected player changes", async () => {
  let resolve: (value: Response) => void = () => {};
  let signal: AbortSignal | null | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn((_path: string, init?: RequestInit) => {
      signal = init?.signal;
      return new Promise<Response>((res) => {
        resolve = res;
      });
    }),
  );
  const user = userEvent.setup();
  const { rerender } = render(
    <PlayerResearch key="1:game" playerId="1" gameId="game" />,
  );
  await user.click(screen.getByRole("button", { name: "Research player" }));
  expect(screen.getByRole("status")).toBeTruthy();
  rerender(<PlayerResearch key="2:game" playerId="2" gameId="game" />);
  expect(signal?.aborted).toBe(true);
  await act(async () => resolve(json(report)));
  expect(screen.queryByText("Questionable")).toBeNull();
});

it("labels offline research as synthetic and does not present live availability", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      json({
        ...report,
        stub_mode: true,
        availability: "unknown",
        updates: [],
        sources: [],
        status_as_of: null,
        status_source_ids: [],
        search_suggestions_html: "",
      }),
    ),
  );
  const user = userEvent.setup();
  render(<PlayerResearch playerId="demo-player" gameId="demo-game" />);
  await user.click(screen.getByRole("button", { name: "Research player" }));
  expect(await screen.findByText(/No live news searched/)).toBeTruthy();
  expect(screen.getByText("Unconfirmed")).toBeTruthy();
  expect(screen.queryByRole("link")).toBeNull();
});
