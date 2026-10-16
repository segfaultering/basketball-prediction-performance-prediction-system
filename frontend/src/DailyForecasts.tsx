import {
  ABBREVIATIONS,
  LABELS,
  STATS,
  seasonFor,
  tipoff,
  initialDate,
} from "./api";
import { useEffect, useRef, useState } from "react";
import type { Game, Player, Prediction, Stat } from "./api";
import { useApi } from "./ApiContext";
import TeamBadge from "./TeamBadge";
import { RefreshCw, Search, Sparkles } from "lucide-react";

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
  const api = useApi();
  const [date, setDate] = useState(() => initialDate(api.mode));
  const replay = api.mode === "replay";
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
        const schedule = await api.games(date, controller.signal);
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
                const roster = await api.players(
                  id,
                  seasonFor(game.date),
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
  }, [api, date, revision]);

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
        const prediction = await api.predict(
          {
            player_id: String(candidate.player.PLAYER_ID),
            game_id: candidate.game.game_id,
          },
          controller.signal,
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
      <div className="board-toolbar">
        <div className="board-date-controls">
          <label className="date-picker">
            <span className="board-date-label">
              {replay ? "REPLAY" : "UTC"}
            </span>
            <input
              aria-label={replay ? "Replay date (NBA)" : "Forecast date (UTC)"}
              type="date"
              value={date}
              disabled={generating || replay}
              onChange={(event) => {
                if (event.target.value) setDate(event.target.value);
              }}
            />
          </label>
          <button
            className="icon-button"
            aria-label="Reload slate"
            title="Reload slate"
            disabled={generating || loading}
            onClick={() => setRevision((n) => n + 1)}
          >
            <RefreshCw size={17} />
          </button>
        </div>
        <div className="board-generate-actions">
          <span className="board-selection-count">
            {selected.size} selected
          </span>
          {generating ? (
            <button
              className="board-stop"
              onClick={() => {
                stop.current = true;
              }}
            >
              Stop after current player
            </button>
          ) : (
            <button
              className="board-generate"
              disabled={loading || !pending.length}
              onClick={() => void generate()}
            >
              <Sparkles size={17} /> Generate selected forecasts (
              {pending.length})
            </button>
          )}
        </div>
      </div>
      {!!progress.total && (
        <div className="board-progress">
          <p role="status">
            {generating ? "Generating" : "Batch finished"}: {progress.completed}{" "}
            of {progress.total} players processed.
          </p>
          {generating && (
            <progress
              aria-label="Forecast generation"
              value={progress.completed}
              max={progress.total}
            />
          )}
        </div>
      )}
      {stub && (
        <p className="synthetic-notice">
          Synthetic demo · Not real NBA forecasts
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
          <div className="board-player-picker">
            <div className="board-picker-heading">
              <h2>
                Players <span>{games.length} matchups</span>
              </h2>
              <div className="board-selection-tools">
                <button
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
                  disabled={generating || !selected.size}
                  onClick={() => setSelected(new Set())}
                >
                  Clear selection
                </button>
              </div>
            </div>
            <div className="board-controls board-filters">
              <label className="board-search">
                <Search size={16} aria-hidden="true" />
                <input
                  aria-label="Search players"
                  placeholder="Search players…"
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <label>
                <select
                  aria-label="Team"
                  value={team}
                  onChange={(event) => setTeam(event.target.value)}
                >
                  <option value="all">All teams</option>
                  {teams.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="board-matchups">
              {games.map((game) => {
                const players = visible.filter(
                  (c) => c.game.game_id === game.game_id,
                );
                if (!players.length) return null;
                return (
                  <details className="board-matchup" key={game.game_id} open>
                    <summary>
                      <span className="board-matchup-name">
                        <TeamBadge team={game.away_team} small />
                        {game.away_team} at{" "}
                        <TeamBadge team={game.home_team} small />
                        {game.home_team}
                      </span>
                      <span className="board-matchup-time">
                        {game.replay_mode ? "Completed game" : tipoff(game)}
                      </span>
                    </summary>
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
                  </details>
                );
              })}
            </div>
            {!visible.length && <p>No players match these filters.</p>}
          </div>
        </>
      )}
      {(Object.keys(results).length > 0 ||
        Object.keys(failures).length > 0) && (
        <>
          <div className="board-results-heading board-controls">
            <h2>
              Forecasts <span>{Object.keys(results).length} ready</span>
            </h2>
            <label>
              <select
                aria-label="Sort forecasts"
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
              <caption className="board-table-caption">
                Daily player forecasts · {date}{" "}
                {replay ? "NBA game date" : "UTC"}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Player / matchup</th>
                  <th scope="col">Minutes</th>
                  {STATS.map((stat) => (
                    <th scope="col" key={stat}>
                      {ABBREVIATIONS[stat]}
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
                                <p>
                                  {prediction.replay_mode
                                    ? "Saved replay"
                                    : "Saved"}
                                  : {prediction.saved_at}
                                </p>
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
      <details className="board-help">
        <summary>About these forecasts</summary>
        <p>
          Forecasts assume the player plays, using recent minutes and full
          career history. Ranges are approximate 80% ranges. Successful
          forecasts are saved to Forecast history. First-time training may take
          a while.
        </p>
      </details>
    </section>
  );
}
