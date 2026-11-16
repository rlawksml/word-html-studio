// D1 is an optional starter binding; application data continues to use Supabase.
// This declaration describes types only and does not provision a database.
declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
  }
}
