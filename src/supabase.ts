import { createClient } from '@supabase/supabase-js'

// The standard client with its default settings: the session lives in localStorage
// and is renewed by the client itself. There is no backend of our own.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
)
