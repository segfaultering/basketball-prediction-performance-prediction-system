import { createClient } from "@supabase/supabase-js";

export const authEnabled = import.meta.env.VITE_AUTH_ENABLED === "1";
const url = import.meta.env.VITE_SUPABASE_URL || "";
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
export const authConfigurationError =
  authEnabled && (!url.startsWith("https://") || !key)
    ? "Sign-in is not configured. Set the Supabase URL and publishable key, then rebuild the application."
    : "";

export const supabase =
  authEnabled && !authConfigurationError
    ? createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null;

export async function accessToken(): Promise<string | undefined> {
  if (!authEnabled) return undefined;
  if (!supabase) throw new Error(authConfigurationError);
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session)
    throw new Error("Please sign in to access live forecasts.");
  return data.session.access_token;
}
