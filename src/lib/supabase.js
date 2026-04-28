// frontend/src/lib/supabase.js
/**
 * Supabase client — anon key only (read operations from frontend).
 * All writes go through FastAPI backend (service role key stays server-side).
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL  ?? 'https://hznlajeimpjciejerjqc.supabase.co'
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh6bmxhamVpbXBqY2llamVyanFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2OTQ1MzIsImV4cCI6MjA5MjI3MDUzMn0.SlI8-lX-03yCNjWfpxHMNmcpcq-2jG9awWH2HcgcHdc'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON)
