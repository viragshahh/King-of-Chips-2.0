# King of Chips 2.0

Finception's timed Texas Hold'em hand-selection quiz.

## Quiz format
- 20 multiple-choice poker-hand questions, 20 seconds per question.
- Each question shows two private hole cards and four possible five-card community-card sets.
- 100 points per correct answer, plus up to 20 speed-bonus points based on response time; incorrect and timed-out answers score zero.
- Leaderboard order: correct answers first, then total points (speed bonus), then lowest total response time.
- Correct answers are checked server-side and never sent in the question payload.
- Correct, incorrect and timed-out answers show rotating poker-themed banter with animations.
- Admin can permanently delete an individual registration while registration is open.
- Full admin reset permanently deletes all participant registrations and quiz attempts, then reopens registration. Everyone must register again.

## Stack
- React + Vite + TypeScript
- Supabase Auth and Postgres
- Supabase Edge Functions: `koc-api` for existing registration/admin authentication and `koc-quiz` for server-authoritative quiz timing/scoring
- Vercel production hosting

## Local development
1. Install Node.js 20+.
2. Run `npm install`.
3. Copy `.env.example` to `.env.local`.
4. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
5. Run `npm run dev`; production build: `npm run build`.

## Supabase
- Base tournament/registration schema: `supabase/schema.sql`.
- Quiz tables and RLS: `supabase/quiz-schema.sql`.
- Quiz server function source: `supabase/functions/koc-quiz/index.ts`.
- Quiz attempts/settings are inaccessible directly to anon/authenticated clients; only the Edge Function service role reads/writes them.
- The service-role key must never be added to Vercel's `VITE_*` variables or shipped to the browser.

## Organiser workflow
1. Sign in through the existing Organiser Login using the configured admin password.
2. Check the registered-player list.
3. Click **Start Quiz for Everyone** when ready. This closes registration and starts the quiz.
4. Participants enter the quiz from their own browser session. Each participant gets one attempt.
5. Monitor the live leaderboard.
6. Use **Reset Quiz & Reopen Registration** only when you intentionally want to clear all quiz attempts and run a fresh round. Participant registrations are retained.

## Production validation
Before the event, test with multiple participant accounts on separate devices:
- registration and duplicate prevention
- simultaneous quiz start and 20-second question timers
- correct/incorrect answer feedback and timeout progression
- refresh/reconnect during an attempt
- leaderboard ordering and completion state
- expected concurrent participant load

A successful frontend build is not a substitute for a live multi-device rehearsal.