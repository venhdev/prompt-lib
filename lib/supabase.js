import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://cfhokbtzarhfjhmcdncv.supabase.co";
const supabasePublishableKey = "sb_publishable_esvgNgOVjEyyOVsFMS61WA_8Fs9GFG0";

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
