import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const keepSignedInKey = "amig.keepSignedIn";
const legacyKeepSignedInKey = "icrackedsahil.keepSignedIn";

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export function getKeepSignedIn() {
  const value = localStorage.getItem(keepSignedInKey) ?? localStorage.getItem(legacyKeepSignedInKey);
  return value !== "false";
}

export function setKeepSignedIn(keepSignedIn) {
  localStorage.setItem(keepSignedInKey, String(Boolean(keepSignedIn)));
  localStorage.removeItem(legacyKeepSignedInKey);
}

const sessionStoragePolicy = {
  getItem(key) {
    const storage = getKeepSignedIn() ? localStorage : sessionStorage;
    return storage.getItem(key);
  },
  setItem(key, value) {
    const persistent = getKeepSignedIn();
    const target = persistent ? localStorage : sessionStorage;
    const other = persistent ? sessionStorage : localStorage;

    target.setItem(key, value);
    other.removeItem(key);
  },
  removeItem(key) {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  },
};

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: "pkce",
        persistSession: true,
        storage: sessionStoragePolicy,
      },
    })
  : null;
