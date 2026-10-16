import { useCallback, useEffect, useRef, useState } from "react";

export function errorText(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}

export function useRequest<T>({
  keepDataOnRun = false,
  errorMessage = "Something went wrong. Please try again.",
}: { keepDataOnRun?: boolean; errorMessage?: string } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = useRef<AbortController | null>(null);
  const cancel = useCallback(() => current.current?.abort(), []);
  const reset = useCallback(() => {
    cancel();
    setData(null);
    setBusy(false);
    setError("");
  }, [cancel]);
  const run = useCallback(
    async (fetch: (signal: AbortSignal) => Promise<T>) => {
      current.current?.abort();
      const controller = new AbortController();
      current.current = controller;
      if (!keepDataOnRun) setData(null);
      setBusy(true);
      setError("");
      try {
        const result = await fetch(controller.signal);
        if (!controller.signal.aborted) setData(result);
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : errorMessage);
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    },
    [keepDataOnRun, errorMessage],
  );
  useEffect(() => cancel, [cancel]);
  return { data, busy, error, run, reset };
}
