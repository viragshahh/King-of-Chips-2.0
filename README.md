# King of Chips 2.0

Responsive tournament registration, random-room allocation, room progress and leaderboard interface for Finception.

## Run
```bash
npm install
cp .env.example .env
npm run dev
```
Node.js 20+ recommended. Build: `npm run build`.

## Deploy on Vercel
Import this repository, choose Vite, build command `npm run build`, output directory `dist`. Set `VITE_ADMIN_PIN` before public deployment. The deployed URL can be encoded as the participant QR code; everyone scans the same join URL.

## What this first release does
- Public registration: team name and captain name, with a generated Team ID.
- Organiser PIN-protected dashboard (default demo PIN: 2468; set `VITE_ADMIN_PIN` to override).
- Open/close registration; random balanced room allocation with adjustable capacity.
- Room progress monitor with three-hand cap per room.
- Global leaderboard view, top-10 qualifier labels, tie-break description and CSV export.
- Responsive dark green / gold design.

## Important limitation
This is a front-end operations prototype. State is persisted in the participant's browser only (localStorage); **it is not shared between devices**. The room advance button is an organiser progress control, not a poker hand engine. No real cards are shuffled/dealt; no private hole cards, turn synchronisation, betting, blinds, pot calculations or side-pot settlement are implemented. Therefore, do not yet use this build for live multi-device gameplay or as a source of official chip balances.

## Production backend required before the event
Connect a Supabase project and implement server-side Edge Functions for registration, room allocation, hand dealing, action validation, street transitions, settlement and tournament finalisation. Use Postgres transactions/locking and Realtime for shared state. Generate and keep deck/hole cards server-side; expose only a captain's own hole cards through an authenticated function. Enable RLS and test captain/admin access separately. Do not store an admin secret in frontend code as the production auth mechanism.

Tournament defaults: Texas Hold'em, one captain per team, 1,000 virtual starting chips, 10/20 blinds, three hands per room, target five or six teams per room, top ten qualify. Tie-break: final chips, then highest single pot won, then sudden-death hand. Play-money only: no deposits, real-money wagering or cashout.
