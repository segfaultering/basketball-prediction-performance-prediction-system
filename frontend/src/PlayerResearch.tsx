import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Search } from "lucide-react";
import { prettyDate, request } from "./api";
import type { PlayerResearchReport } from "./api";

const statusLabels: Record<PlayerResearchReport["availability"], string> = {
  available: "Available",
  probable: "Probable",
  questionable: "Questionable",
  doubtful: "Doubtful",
  out: "Out",
  unknown: "Unconfirmed",
};

export default function PlayerResearch({
  playerId,
  gameId,
}: {
  playerId: string;
  gameId: string;
}) {
  const [report, setReport] = useState<PlayerResearchReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function research() {
    const abort = new AbortController();
    controller.current?.abort();
    controller.current = abort;
    setBusy(true);
    setError("");
    setReport(null);
    try {
      const result = await request<PlayerResearchReport>(
        "/player-research",
        abort.signal,
        { player_id: playerId, game_id: gameId },
      );
      if (!abort.signal.aborted) setReport(result);
    } catch (e) {
      if (!abort.signal.aborted)
        setError(e instanceof Error ? e.message : "Research unavailable.");
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  }

  function citations(ids: number[]) {
    return ids.map((id) => {
      const source = report?.sources.find((item) => item.id === id);
      if (!source || !source.url.startsWith("https://")) return null;
      return (
        <a
          key={id}
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="research-citation"
        >
          [{id + 1}] <span className="sr-only">{source.title}</span>
        </a>
      );
    });
  }

  return (
    <section className="player-research panel" aria-label="Player research">
      <div className="research-heading">
        <h3>Player status</h3>
        <button className="outline-button" disabled={busy} onClick={research}>
          {busy ? (
            <LoaderCircle size={18} className="spin" />
          ) : (
            <Search size={18} />
          )}
          {busy ? "Researching…" : "Research player"}
        </button>
      </div>
      {!report && !busy && !error && <p>Check recent news and availability.</p>}
      {busy && <p role="status">Searching recent reports…</p>}
      {error && (
        <p className="error-notice" role="alert">
          {error}
        </p>
      )}
      {report && (
        <>
          {report.stub_mode ? (
            <p className="synthetic-notice">
              Synthetic demo · No live news searched.
            </p>
          ) : (
            <div className="research-meta">
              <span>
                Gemini · {report.cached ? "Cached" : "Checked"}{" "}
                {new Date(report.checked_at).toLocaleString()}
              </span>
              <span>For {prettyDate(report.context.game_date)}</span>
            </div>
          )}
          <p
            className={`research-status research-status-${report.availability}`}
          >
            <strong>{statusLabels[report.availability]}</strong>
            {report.status_as_of && (
              <span> · Reported {prettyDate(report.status_as_of)}</span>
            )}
            {citations(report.status_source_ids)}
          </p>
          <p>{report.summary}</p>
          {report.updates.length > 0 && (
            <details className="prediction-details">
              <summary>Recent updates ({report.updates.length})</summary>
              <ul className="research-updates">
                {report.updates.map((update, index) => (
                  <li key={index}>
                    {update.text} {citations(update.source_ids)}
                    {update.reported_date && (
                      <small>Reported {prettyDate(update.reported_date)}</small>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {!report.stub_mode && (
            <p className="table-note">
              Reported status can change before tipoff. Forecast numbers remain
              unchanged.
            </p>
          )}
          {report.search_suggestions_html && (
            <iframe
              title="Google Search suggestions"
              srcDoc={report.search_suggestions_html}
              sandbox="allow-popups allow-popups-to-escape-sandbox"
              referrerPolicy="no-referrer"
              className="research-search-suggestions"
            />
          )}
        </>
      )}
    </section>
  );
}
