/**
 * The sign-in screen's Supabase imports live in `@/lib/supabase`. This module
 * keeps the one name the sign-in screen and the auth hook both used to reach
 * for, so the change of identity provider does not ripple into every view.
 */

export {
  isSupabaseConfigured,
  getSupabaseBrowserClient,
} from "@/lib/supabase";
