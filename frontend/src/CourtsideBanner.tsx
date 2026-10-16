import TeamBadge from "./TeamBadge";
import type { Game } from "./api";

export default function CourtsideBanner({ game }: { game?: Game }) {
  return (
    <section className="courtside-banner" aria-label="Courtside scouting desk">
      <div className="courtside-copy">
        <span className="courtside-kicker">
          Courtside / Basketball intelligence
        </span>
        <h2>
          Know the game.
          <br />
          <span>Read the numbers.</span>
        </h2>
        <p>Every matchup. Every minute. A closer look at the next box score.</p>
        <div className="courtside-matchup">
          <span className="scouting-label">On the scouting desk</span>
          {game ? (
            <span className="scouting-teams">
              <TeamBadge team={game.away_team} small />
              <strong>{game.away_team}</strong>
              <span>vs</span>
              <TeamBadge team={game.home_team} small />
              <strong>{game.home_team}</strong>
            </span>
          ) : (
            <span className="scouting-placeholder">Choose a matchup below</span>
          )}
        </div>
      </div>
      <div className="court-art" aria-hidden="true">
        <svg viewBox="0 0 500 360" fill="none">
          <defs>
            <pattern
              id="hardwood"
              width="58"
              height="120"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M0 0H58V120H0Z M0 60H29 M29 0V60 M29 60V120"
                stroke="currentColor"
                strokeWidth="0.5"
              />
            </pattern>
          </defs>
          <rect
            width="500"
            height="360"
            fill="url(#hardwood)"
            className="court-grain"
          />
          <g stroke="currentColor" strokeWidth="2">
            <path d="M35 335V25H465V335Z M35 335H465" />
            <path d="M183 25V165H317V25 M205 25V165H295V25" />
            <circle cx="250" cy="165" r="45" />
            <path d="M60 25V80C60 318 440 318 440 80V25" />
            <path d="M195 335A55 55 0 0 1 305 335" />
            <path d="M225 49H275 M250 49V60" />
            <circle cx="250" cy="68" r="8" className="court-rim" />
          </g>
          <g className="court-play" strokeWidth="2" strokeLinecap="round">
            <path d="M365 254Q400 155 324 112" strokeDasharray="6 8" />
            <path d="M325 127L324 112L340 115" />
            <circle cx="365" cy="265" r="14" />
            <path d="M128 176L144 192 M144 176L128 192" />
            <circle cx="250" cy="68" r="19" strokeDasharray="3 5" />
          </g>
        </svg>
        <span className="court-caption">The game, by the numbers.</span>
      </div>
    </section>
  );
}
