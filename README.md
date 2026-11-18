# King of Chips 2.0

Finception's No-Limit Texas Hold'em tournament portal.

## Stack
- React + Vite + TypeScript
- Supabase Auth, Postgres, Row Level Security and Realtime
- Supabase Edge Functions: `koc-api` (registration/admin/state) and `koc-game` (server-authoritative dealing/actions/settlement)
- Vercel production hosting

## Local development
1. Install Node.js 20+.
2. Run `npm install`.
3. Copy `.env.example` to `.env.local`.
4. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to the Supabase project URL and publishable key.
5. Run `npm run dev`; production build: `npm run build`.

## Production defaults
- No-Limit Texas Hold'em
- Starting stack: 1,000 virtual chips
- Small blind / big blind: 10 / 20
- Three hands per room
- Eight-second action clock; timeout checks when legal, otherwise folds
- Room capacity default: six; admin can allocate balanced rooms
- Global qualification threshold: top 18
- Virtual chips only; no real-money play

## Supabase
The canonical database schema is in `supabase/schema.sql`. Production migrations are also recorded in Supabase. Edge functions are deployed as `koc-api` and `koc-game`.

The service-role key is used only inside Edge Functions and must never be added to Vercel's `VITE_*` variables or shipped to the browser. The browser receives only the publishable/anon key. Hole-card rows are protected by RLS; the deck column is not granted to authenticated clients.

## Granting tournament administrator access
Before the organiser signs up, add their exact email to the private allowlist in Supabase SQL Editor:

```sql
insert into public.admin_allowlist(email)
values (lower('ORGANISER_EMAIL'))
on conflict do nothing;
```

Then the organiser signs up using that exact email. The auth trigger assigns the admin role automatically. If the account already exists, use this one-time promotion instead:

```sql
update public.profiles set role = 'admin'
where user_id = (select id from auth.users where lower(email)=lower('ORGANISER_EMAIL'));
```

The allowlist is not readable by anon or authenticated users.

Never expose admin promotion as a public client-side action. Keep at least two trusted organisers as admins if appropriate.

## Important production validation
Before the event, test with multiple real accounts and separate devices:
- registration and duplicate prevention
- balanced room allocation and room isolation
- hole-card privacy (one account must not read another account's cards)
- blind/button rotation including heads-up tables
- all betting streets, minimum raises, short all-ins, side pots and split pots
- action timeout, disconnect/reconnect and refresh behaviour
- three-hand room completion and leaderboard tie handling
- load test for the expected concurrent participants

The UI and backend are deployed, but a live multi-device tournament rehearsal is still required before using this for a high-stakes college event. No system should be declared event-ready based on a successful build alone.
