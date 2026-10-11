import { useEffect, useRef, useState } from "react";
import { LABELS, STATS, request, seasonFor, tipoff, utcToday } from "./api";
import type { Game, Player, Prediction, Stat } from "./api";
import TeamBadge from "./TeamBadge";

interface Candidate {
  key: string;
  game: Game;
  player: Player;
}
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Unable to retrieve data. Try again.";

export default function DailyForecasts() {
  const [date, setDate] = useState(utcToday);
  const [revision, setRevision] = useState(0);
  const [games, setGames] = useState<Game[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, Prediction>>({});
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [stub, setStub] = useState(false);
  const [search, setSearch] = useState("");
  const [team, setTeam] = useState("all");
  const [sort, setSort] = useState<Stat | "player">("player");
  const batch = useRef<AbortController | null>(null);
  const stop = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setGames([]);
    setCandidates([]);
    setSelected(new Set());
    setResults({});
    setFailures({});
    setErrors([]);
    setProgress({ completed: 0, total: 0 });
    setTeam("all");
    setSearch("");
    async function load() {
      try {
        const schedule = await request<{ games: Game[]; stub_mode: boolean }>(
          `/games?date=${date}`,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setGames(schedule.games);
        setStub(schedule.stub_mode);
        const rosters = await Promise.allSettled(
          schedule.games.flatMap((game) =>
            [
              [game.away_team_id, game.away_team],
              [game.home_team_id, game.home_team],
            ].map(async ([id, abbreviation]) => {
              try {
                const roster = await request<{
                  players: Omit<Player, "team">[];
                }>(
                  `/teams/${id}/players?season=${seasonFor(game.date)}`,
                  controller.signal,
                );
                return roster.players.map((player) => ({
                  key: JSON.stringify([game.game_id, String(player.PLAYER_ID)]),
                  game,
                  player: { ...player, team: abbreviation },
                }));
              } catch (error) {
                throw new Error(`${abbreviation}: ${message(error)}`);
              }
            }),
          ),
        );
        if (controller.signal.aborted) return;
        const available: Candidate[] = [];
        const unavailable: string[] = [];
        for (const roster of rosters) {
          if (roster.status === "fulfilled") available.push(...roster.value);
          else unavailable.push(message(roster.reason));
        }
        setCandidates([...new Map(available.map((c) => [c.key, c])).values()]);
        setErrors(unavailable);
      } catch (error) {
        if (!controller.signal.aborted) setErrors([message(error)]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [date, revision]);

  useEffect(() => () => batch.current?.abort(), []);

  const teams = [...new Set(candidates.map((c) => c.player.team))].sort();
  const visible = candidates.filter(
    (c) =>
      (team === "all" || c.player.team === team) &&
      c.player.PLAYER.toLowerCase().includes(search.toLowerCase()),
  );
  const pending = candidates.filter(
    (c) => selected.has(c.key) && !results[c.key],
  );
  const rows = visible
    .filter((c) => results[c.key] || failures[c.key])
    .sort((a, b) => {
      if (sort !== "player") {
        const difference =
          (results[b.key]?.stats[sort].prediction ?? -Infinity) -
          (results[a.key]?.stats[sort].prediction ?? -Infinity);
        if (difference && !Number.isNaN(difference)) return difference;
      }
      return a.player.PLAYER.localeCompare(b.player.PLAYER);
    });

  async function generate() {
    if (generating || !pending.length) return;
    const controller = new AbortController();
    batch.current = controller;
    stop.current = false;
    setGenerating(true);
    setProgress({ completed: 0, total: pending.length });
    for (const candidate of pending) {
      if (controller.signal.aborted || stop.current) break;
      setFailures((previous) => {
        const next = { ...previous };
        delete next[candidate.key];
        return next;
      });
      try {
        const prediction = await request<Prediction>(
          "/predictions",
          controller.signal,
          {
            player_id: String(candidate.player.PLAYER_ID),
            game_id: candidate.game.game_id,
          },
        );
        if (controller.signal.aborted) return;
        setResults((previous) => ({
          ...previous,
          [candidate.key]: prediction,
        }));
      } catch (error) {
        if (controller.signal.aborted) return;
        setFailures((previous) => ({
          ...previous,
          [candidate.key]: message(error),
        }));
      }
      setProgress((previous) => ({
        ...previous,
        completed: previous.completed + 1,
      }));
    }
    if (!controller.signal.aborted) setGenerating(false);
  }

  return (
    <section
      className="tracking-section daily-board"
      aria-label="Daily forecast board"
    >
      <div className="section-heading">
        <div>
          <h2>The day’s slate</h2>
          <p>Select players across matchups and compare their forecasts.</p>
        </div>
        <div className="tracking-actions">
          <label className="date-picker">
            Date (UTC)
            <input
              aria-label="Forecast date (UTC)"
              type="date"
              value={date}
              disabled={generating}
              onChange={(event) => {
                if (event.target.value) setDate(event.target.value);
              }}
            />
          </label>
          <button
            className="today-button"
            disabled={generating || loading}
            onClick={() => setRevision((n) => n + 1)}
          >
            Reload slate
          </button>
        </div>
      </div>
      <p>
        Forecasts assume the player plays, using recent minutes and full career
        history. Successful forecasts are saved to Forecast history. First-time
        training may take a while.
      </p>
      {stub && (
        <p className="synthetic-notice">
          Synthetic demo forecasts; these are not real NBA predictions.
        </p>
      )}
      {errors.map((error, index) => (
        <p key={index} className="error-notice" role="alert">
          {error}
        </p>
      ))}
      {loading && <p role="status">Loading matchups and rosters…</p>}
      {!loading && !games.length && !errors.length && (
        <div className="schedule-empty">No scheduled games for this date.</div>
      )}
      {!!candidates.length && (
        <>
          <div className="board-controls">
            <label>
              Search players
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <label>
              Team
              <select
                value={team}
                onChange={(event) => setTeam(event.target.value)}
              >
                <option value="all">All teams</option>
                {teams.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            <button
              className="today-button"
              disabled={generating || !visible.length}
              onClick={() =>
                setSelected(
                  (previous) =>
                    new Set([...previous, ...visible.map((c) => c.key)]),
                )
              }
            >
              Select visible players
            </button>
            <button
              className="today-button"
              disabled={generating || !selected.size}
              onClick={() => setSelected(new Set())}
            >
              Clear selection
            </button>
          </div>
          <div className="board-matchups">
            {games.map((game) => {
              const players = visible.filter(
                (c) => c.game.game_id === game.game_id,
              );
              if (!players.length) return null;
              return (
                <article className="panel board-matchup" key={game.game_id}>
                  <h3>
                    <TeamBadge team={game.away_team} small />
                    {game.away_team} at{" "}
                    <TeamBadge team={game.home_team} small />
                    {game.home_team}
                  </h3>
                  <p>{tipoff(game)}</p>
                  <div className="board-players">
                    {players.map((candidate) => (
                      <label key={candidate.key}>
                        <input
                          type="checkbox"
                          checked={selected.has(candidate.key)}
                          disabled={generating}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setSelected((previous) => {
                              const next = new Set(previous);
                              if (checked) next.add(candidate.key);
                              else next.delete(candidate.key);
                              return next;
                            });
                          }}
                        />
                        <span>
                          {candidate.player.PLAYER}
                          <small>
                            {candidate.player.team} ·{" "}
                            {candidate.player.POSITION || "Player"}
                          </small>
                        </span>
                      </label>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
          {!visible.length && <p>No players match these filters.</p>}
          <div className="tracking-actions board-generation">
            <span>
              {selected.size} selected · {Object.keys(results).length} forecasts
              ready
            </span>
            <button
              className="today-button"
              disabled={loading || generating || !pending.length}
              onClick={() => void generate()}
            >
              Generate selected forecasts ({pending.length})
            </button>
            {generating && (
              <button
                className="today-button"
                onClick={() => {
                  stop.current = true;
                }}
              >
                Stop after current player
              </button>
            )}
          </div>
        </>
      )}
      {!!progress.total && (
        <p role="status">
          {generating ? "Generating" : "Batch finished"}: {progress.completed}{" "}
          of {progress.total} players processed.
        </p>
      )}
      {(Object.keys(results).length > 0 ||
        Object.keys(failures).length > 0) && (
        <>
          <div className="board-controls">
            <label>
              Sort forecasts
              <select
                value={sort}
                onChange={(event) =>
                  setSort(event.target.value as Stat | "player")
                }
              >
                <option value="player">Player name</option>
                {STATS.map((stat) => (
                  <option key={stat} value={stat}>
                    {LABELS[stat]} (highest first)
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="table-scroll">
            <table className="tracking-table">
              <caption>Daily player forecasts · {date} UTC</caption>
              <thead>
                <tr>
                  <th scope="col">Player / matchup</th>
                  <th scope="col">Minutes</th>
                  {STATS.map((stat) => (
                    <th scope="col" key={stat}>
                      {LABELS[stat]}
                    </th>
                  ))}
                  <th scope="col">Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((candidate) => {
                  const prediction = results[candidate.key];
                  return (
                    <tr key={candidate.key}>
                      <th scope="row">
                        {candidate.player.PLAYER}
                        <small>
                          {candidate.player.team} · {candidate.game.away_team}{" "}
                          at {candidate.game.home_team}
                        </small>
                      </th>
                      {prediction ? (
                        <>
                          <td>{prediction.projected_minutes.toFixed(1)}</td>
                          {STATS.map((stat) => (
                            <td key={stat}>
                              <strong>
                                {prediction.stats[stat].prediction.toFixed(1)}
                              </strong>
                              <small>
                                {prediction.stats[stat].approximate_80pct_range
                                  .map((n) => n.toFixed(1))
                                  .join(" – ")}
                              </small>
                            </td>
                          ))}
                          <td className="board-detail">
                            <details>
                              <summary>Forecast details</summary>
                              <p>
                                Approximate 80% ranges. Last history:{" "}
                                {prediction.last_history_date}. Model trained
                                through: {prediction.model.trained_through}.
                              </p>
                              {prediction.saved_at && (
                                <p>Saved: {prediction.saved_at}</p>
                              )}
                              <ul>
                                {prediction.warnings.map((warning, index) => (
                                  <li key={index}>{warning}</li>
                                ))}
                              </ul>
                            </details>
                          </td>
                        </>
                      ) : (
                        <td colSpan={7} className="board-detail">
                          <span role="alert">{failures[candidate.key]}</span>
                          <p>
                            Keep this player selected and generate again to
                            retry.
                          </p>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!rows.length && <p>No generated forecasts match these filters.</p>}
        </>
      )}
    </section>
  );
}
