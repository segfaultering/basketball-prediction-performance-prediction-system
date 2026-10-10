import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import TeamBadge from "./TeamBadge";

afterEach(cleanup);

it("uses bundled logos for all 30 teams", () => {
  const teams = [
    "ATL",
    "BOS",
    "BKN",
    "CHA",
    "CHI",
    "CLE",
    "DAL",
    "DEN",
    "DET",
    "GSW",
    "HOU",
    "IND",
    "LAC",
    "LAL",
    "MEM",
    "MIA",
    "MIL",
    "MIN",
    "NOP",
    "NYK",
    "OKC",
    "ORL",
    "PHI",
    "PHX",
    "POR",
    "SAC",
    "SAS",
    "TOR",
    "UTA",
    "WAS",
  ];
  render(
    <>
      {teams.map((team) => (
        <TeamBadge key={team} team={team} />
      ))}
    </>,
  );
  expect(screen.getAllByRole("img")).toHaveLength(30);
  expect(
    new Set(
      screen.getAllByRole("img").map((image) => image.getAttribute("src")),
    ).size,
  ).toBe(30);
  for (const team of teams) {
    expect(
      screen.getByRole("img", { name: `${team} logo` }).getAttribute("src"),
    ).toMatch(/^(data:image\/svg\+xml,|\/)/);
  }
});

it("falls back for unknown teams and failed images, then loads a different team's logo", () => {
  const { rerender } = render(<TeamBadge team="UNK" />);
  expect(screen.getByLabelText("UNK team")).toBeTruthy();
  expect(screen.queryByRole("img")).toBeNull();
  rerender(<TeamBadge team="lal" />);
  fireEvent.error(screen.getByRole("img", { name: "LAL logo" }));
  expect(screen.getByLabelText("LAL team")).toBeTruthy();
  expect(screen.queryByRole("img")).toBeNull();
  rerender(<TeamBadge team="BOS" />);
  expect(screen.getByRole("img", { name: "BOS logo" })).toBeTruthy();
});
