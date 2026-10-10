import { useState } from "react";

const logos = import.meta.glob<string>("./assets/teams/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
});

export default function TeamBadge({
  team,
  small = false,
}: {
  team: string;
  small?: boolean;
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const abbreviation = team.trim().toUpperCase();
  const source = logos[`./assets/teams/${abbreviation}.svg`];

  return (
    <span className={`team-badge ${small ? "small" : ""}`}>
      {source && failedSource !== source ? (
        <img
          src={source}
          alt={`${abbreviation} logo`}
          width={48}
          height={48}
          onError={() => setFailedSource(source)}
        />
      ) : (
        <span aria-label={`${abbreviation} team`}>{abbreviation}</span>
      )}
    </span>
  );
}
