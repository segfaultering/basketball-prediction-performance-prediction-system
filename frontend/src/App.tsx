import { useEffect, useState } from "react";
import CourtsideBanner from "./CourtsideBanner";
import ForecastTracking from "./ForecastTracking";
import DailyForecasts from "./DailyForecasts";
import ThemeToggle from "./ThemeToggle";
import Sidebar from "./Sidebar";
import type { View } from "./Sidebar";
import { getDataMode, setDataMode, portfolioEnabled } from "./api";
import type { DataMode } from "./api";
import { ApiProvider, useApi } from "./ApiContext";
import { useRequest } from "./useRequest";
import { usePredictionWorkflow } from "./usePredictionWorkflow";
import { ErrorNotice } from "./WorkflowUi";
import ScheduleSection from "./ScheduleSection";
import PlayerSelection from "./PlayerSelection";
import ForecastPanel from "./ForecastPanel";
import HelpDialog from "./HelpDialog";
import ReplaySpotlight from "./ReplaySpotlight";

export default function App() {
  const [mode, setMode] = useState<DataMode>(getDataMode);
  return (
    <ApiProvider mode={mode}>
      <Dashboard
        key={mode}
        mode={mode}
        changeMode={(next) => {
          setDataMode(next);
          setMode(next);
        }}
      />
    </ApiProvider>
  );
}

function Dashboard({
  mode,
  changeMode,
}: {
  mode: DataMode;
  changeMode: (mode: DataMode) => void;
}) {
  const api = useApi();
  const workflow = usePredictionWorkflow();
  const { game, refresh, setRefresh } = workflow;
  const [view, setView] = useState<View>("predictions");
  const viewTitle = {
    board: "Daily forecasts",
    tracking: "Forecast history",
    insights: "Model insights",
    predictions: "Predictions",
  }[view];
  const [help, setHelp] = useState(false);
  const {
    data: health,
    error: healthError,
    run: checkHealth,
  } = useRequest<{ stub_mode: boolean }>();
  useEffect(() => {
    void checkHealth((signal) => api.health(signal));
  }, [api, refresh, checkHealth]);

  return (
    <div className="app-shell">
      <main className="main-content">
        <header className="page-header">
          <div className="header-left">
            <Sidebar
              view={view}
              navigate={setView}
              help={() => setHelp(true)}
              online={health !== null}
            />
            <h1>
              {viewTitle}
              <span className="title-dot">.</span>
            </h1>
          </div>
          <div className="header-right">
            {portfolioEnabled && (
              <div
                className="experience-switch"
                role="group"
                aria-label="Data experience"
              >
                <button
                  aria-pressed={mode === "replay"}
                  onClick={() => changeMode("replay")}
                >
                  NBA replay
                </button>
                <button
                  aria-pressed={mode === "live"}
                  onClick={() => changeMode("live")}
                >
                  Live NBA
                </button>
              </div>
            )}
            <ThemeToggle />
            <span className={`mode-pill ${health?.stub_mode ? "demo" : ""}`}>
              <span />
              {mode === "replay"
                ? "Historical replay"
                : health
                  ? health.stub_mode
                    ? "Synthetic demo"
                    : "Live NBA data"
                  : "Connecting"}
            </span>
          </div>
        </header>
        {mode === "replay" && view === "predictions" ? (
          <ReplaySpotlight />
        ) : (
          <CourtsideBanner game={game} />
        )}
        {mode === "replay" && view !== "predictions" && (
          <div className="replay-notice">
            <span>
              <strong>March 8, 2025 replay</strong> · Real NBA history, six
              featured players. Predictions were rebuilt after the games using
              earlier data.
            </span>
            <a href="https://github.com/segfaultering/basketball-prediction-performance-prediction-system#portfolio-demo">
              How it works ↗
            </a>
          </div>
        )}
        {mode === "live" && (
          <p className="live-notice">
            {health
              ? "Live NBA data can be delayed or unavailable. Your saved history stays in this browser."
              : "Connecting to the live API. The free server may take about a minute to wake up; NBA replay stays available."}
          </p>
        )}
        {healthError && (
          <ErrorNotice
            message={`Cannot reach the prediction engine: ${healthError}`}
            retry={() => setRefresh((n) => n + 1)}
          />
        )}

        {view === "board" ? (
          <DailyForecasts />
        ) : view === "tracking" ? (
          <ForecastTracking />
        ) : (
          <>
            {mode === "replay" && view === "predictions" && (
              <div
                className="forecast-workspace-heading"
                id="forecast-workspace"
                tabIndex={-1}
              >
                <div>
                  <span>KEEP EXPLORING</span>
                  <h2>Your forecast workspace</h2>
                </div>
                <p>
                  Choose a matchup, make a projection, and inspect the model
                  behind it.
                </p>
              </div>
            )}
            <ScheduleSection workflow={workflow} mode={mode} />
            <div className="workspace-grid">
              <PlayerSelection workflow={workflow} mode={mode} />
              <ForecastPanel
                workflow={workflow}
                mode={mode}
                view={view}
                setView={setView}
              />
            </div>
          </>
        )}
      </main>
      <HelpDialog open={help} close={() => setHelp(false)} />
    </div>
  );
}
