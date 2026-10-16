import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { createClient, getDataMode } from "./api";
import type { DataMode, PredictionClient } from "./api";

const ApiContext = createContext<PredictionClient | null>(null);

export function ApiProvider({
  mode,
  children,
}: {
  mode: DataMode;
  children: ReactNode;
}) {
  const client = useMemo(() => createClient(mode), [mode]);
  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}

export function useApi() {
  const client = useContext(ApiContext);
  const fallback = useMemo(() => createClient(getDataMode()), []);
  return client ?? fallback;
}
