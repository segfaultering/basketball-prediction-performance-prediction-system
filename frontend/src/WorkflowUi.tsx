import { Info, RefreshCw } from "lucide-react";

export function StepTitle({
  step,
  title,
  subtitle,
}: {
  step: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="step-title">
      <span className="step-number">{step}</span>
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
    </div>
  );
}
export function ErrorNotice({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  const title = message.startsWith("Forecast limit reached.")
    ? "Forecast limit reached"
    : message.startsWith("Forecast service is busy.")
      ? "Forecast service is busy"
      : "";
  return (
    <div className="error-notice" role="alert">
      <Info size={17} />
      <span>
        {title ? (
          <>
            <strong>{title}</strong>
            <span className="error-description">
              {message.slice(title.length + 1).trim()}
            </span>
          </>
        ) : (
          message
        )}
      </span>
      {retry && (
        <button onClick={retry}>
          Try again <RefreshCw size={13} />
        </button>
      )}
    </div>
  );
}
