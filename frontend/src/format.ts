import type { Game } from "./types";

export const utcToday = () => new Date().toISOString().slice(0, 10);
export function seasonFor(date: string) {
  const [year, month] = date.split("-").map(Number);
  const start = month >= 7 ? year : year - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}
export function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function prettyDate(date: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}
export function tipoff(game: Game) {
  if (!game.tipoff_utc) return "Time to be confirmed";
  const date = new Date(
    /(?:Z|[+-]\d{2}:\d{2})$/i.test(game.tipoff_utc)
      ? game.tipoff_utc
      : `${game.tipoff_utc}Z`,
  );
  return Number.isNaN(date.getTime())
    ? "Time to be confirmed"
    : `${new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(date)} UTC`;
}

export function parseSeasons(value: string) {
  const seasons = [
    ...new Set(
      value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
  if (
    seasons.length > 5 ||
    seasons.some(
      (s) =>
        !/^\d{4}-\d{2}$/.test(s) ||
        (Number(s.slice(0, 4)) + 1) % 100 !== Number(s.slice(-2)),
    )
  ) {
    throw new Error(
      "Enter up to five consecutive-year seasons, such as 2024-25, 2025-26.",
    );
  }
  return seasons.length ? seasons : undefined;
}
