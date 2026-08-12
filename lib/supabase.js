import { createClient } from "@supabase/supabase-js";

const supabaseUrl = __SUPABASE_URL__;
const supabasePublishableKey = __SUPABASE_PUBLISHABLE_KEY__;

export function getAppUrl() {
  return __APP_URL__ || window.location.origin;
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
