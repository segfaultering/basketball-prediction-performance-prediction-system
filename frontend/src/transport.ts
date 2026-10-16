export const apiBase = (import.meta.env.VITE_API_BASE_URL || "").replace(
  /\/$/,
  "",
);

export async function httpRequest<T>(
  mode: "server" | "live",
  path: string,
  signal?: AbortSignal,
  body?: object,
): Promise<T> {
  signal?.throwIfAborted();
  const deadline = mode === "live" ? AbortSignal.timeout(90_000) : undefined;
  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      signal: deadline
        ? signal
          ? AbortSignal.any([signal, deadline])
          : deadline
        : signal,
      ...(body
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    });
  } catch (error) {
    if (mode === "live" && !signal?.aborted)
      throw new Error(
        "Live data could not be reached. The API may be waking up; retry or switch to NBA replay.",
      );
    throw error;
  }
  if (!response.ok) {
    const retryHeader = response.headers.get("Retry-After");
    const retrySeconds = retryHeader ? Number(retryHeader) : NaN;
    const wait =
      Number.isFinite(retrySeconds) && retrySeconds > 0
        ? retrySeconds >= 60
          ? `about ${Math.ceil(retrySeconds / 60)} ${retrySeconds <= 60 ? "minute" : "minutes"}`
          : `about ${Math.ceil(retrySeconds)} ${retrySeconds <= 1 ? "second" : "seconds"}`
        : "a minute";
    if (response.status === 429)
      throw new Error(
        `Forecast limit reached. Please wait ${wait} before trying again. Your saved forecasts are still available.`,
      );
    if (response.status === 503 && retryHeader)
      throw new Error(
        `Forecast service is busy. Another forecast is being prepared. Please try again in ${Number.isFinite(retrySeconds) && retrySeconds > 0 ? wait : "a few seconds"}.`,
      );
    let detail: unknown;
    try {
      detail = (await response.json()).detail;
    } catch {
      /* Non-JSON upstream errors use the status below. */
    }
    if (Array.isArray(detail))
      detail =
        detail
          .flatMap((item: unknown) =>
            item &&
            typeof item === "object" &&
            "msg" in item &&
            typeof item.msg === "string"
              ? [item.msg]
              : [],
          )
          .join("; ") || undefined;
    throw new Error(
      typeof detail === "string"
        ? detail
        : `Request failed (${response.status}). Please try again.`,
    );
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(
      mode === "live"
        ? "The live API is not ready. Retry shortly or switch to NBA replay."
        : "The API returned an invalid response. Please try again.",
    );
  }
  signal?.throwIfAborted();
  return result as T;
}
