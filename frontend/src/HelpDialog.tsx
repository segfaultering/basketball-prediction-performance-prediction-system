import { useEffect, useRef } from "react";
import { ArrowRight, Info, X } from "lucide-react";

export default function HelpDialog({
  open,
  close,
}: {
  open: boolean;
  close: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [open]);
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="help-title"
      onCancel={() => close()}
      onClick={(e) => {
        if (e.target === dialogRef.current) close();
      }}
      className="help-dialog"
    >
      <button
        className="icon-button close-dialog"
        aria-label="Close explanation"
        onClick={() => close()}
      >
        <X size={20} />
      </button>

      <h2 id="help-title">How forecasts work</h2>
      <div className="help-step">
        <span>01</span>
        <div>
          <h3>Baseline: the starting estimate</h3>
          <p>
            Use past stats per minute and expected playing time to make a
            starting estimate. More expected minutes usually means higher
            projected stats.
          </p>
        </div>
      </div>
      <div className="help-step">
        <span>02</span>
        <div>
          <h3>Correction: a learned adjustment</h3>
          <p>
            Learn from the player’s history to adjust the baseline using recent
            stats, minutes, home court, and rest.
          </p>
        </div>
      </div>
      <div className="help-step">
        <span>03</span>
        <div>
          <h3>Validation: choose which method to use</h3>
          <p>
            Only use a correction when it lowers error on later historical
            games. Otherwise, keep the baseline.
          </p>
        </div>
      </div>
      <div className="help-step">
        <span>04</span>
        <div>
          <h3>Backtest: check against past results</h3>
          <p>
            Rebuild forecasts for past games using only earlier history, then
            compare them with what happened. Open Model insights to run a
            backtest. This checks the process across past games; validation
            chooses whether to use a correction.
          </p>
        </div>
      </div>
      <div className="help-step">
        <span>05</span>
        <div>
          <h3>Forecast history: follow saved predictions</h3>
          <p>
            Compare saved predictions with final stats when results are
            available. NBA replay uses completed games and forecasts rebuilt
            afterward from earlier data. Those comparisons do not show
            predictions actually made before tipoff.
          </p>
        </div>
      </div>
      <div className="help-caveat">
        <Info size={17} />
        <p>
          The projected value is an estimate, not an exact result. The 80% range
          shows possible variation, but is not a verified 80% chance.
        </p>
      </div>
      <button className="predict-button" onClick={() => close()}>
        Done <ArrowRight size={17} />
      </button>
    </dialog>
  );
}
