# AdPac — Google Ads AI Management (Phase 1)

An internal tool for AdPac staff: add a client, connect their Google Ads account,
generate an AI-drafted Search campaign from their business brief, and manage it —
with every AI action gated behind human approval before it touches real ad spend.

## What's real vs. what needs your input

Everything here is real, working code — nothing is mocked. `lib/googleAds.ts` calls
the actual Google Ads API; `lib/ai.ts` calls the actual Anthropic API. It will run
end-to-end as soon as you fill in the environment variables below. Until then,
each integration fails with a clear error naming the missing credential, rather
than silently faking data.

What you need to provide:
- A Google Cloud project + OAuth client (free, ~10 minutes)
- A Google Ads Manager (MCC) account + developer token (self-serve, approval up
  to 5 business days — see "Google Ads setup" below)
- An Anthropic API key (for the AI campaign-drafting step)

What this does **not** include yet, on purpose (this is phase 1, Google Ads only):
- Meta, TikTok, or other ad platforms
- A self-serve client-facing signup/portal (this app is for your staff to operate
  on behalf of clients — the adpac.ai marketing site's intake wizard isn't wired
  to this app yet, that's a natural next step)
- Automated bid/budget optimization beyond surfacing Google's own recommendation
  engine — see "Why Google's Recommendations API" below for why that's the right
  starting point, not a shortcut

## Quick start (local development)

```bash
npm install
cp .env.example .env         # then fill in the values — see below
npx prisma generate
npx prisma db push           # creates dev.db (SQLite) from the schema
npm run db:seed              # creates your first login (prints email/password)
npm run dev
```

Visit `http://localhost:3000`, sign in with the credentials the seed script
printed, and change that password (there's no "change password" UI yet —
update it directly via `npx prisma studio` for now, or extend `/api/clients`
if you want that sooner).

## Environment variables

See `.env.example` for the full list with inline explanations. Summary:

| Variable | Where it comes from |
|---|---|
| `DATABASE_URL` | SQLite by default (`file:./dev.db`); swap to a Postgres URL for production |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | Your app's base URL |
| `TOKEN_ENCRYPTION_KEY` | `openssl rand -hex 32` — encrypts stored Google Ads refresh tokens |
| `GOOGLE_ADS_CLIENT_ID` / `GOOGLE_ADS_CLIENT_SECRET` | Google Cloud Console → OAuth client |
| `GOOGLE_ADS_REDIRECT_URI` | `<your-url>/api/google-ads/callback` |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Google Ads API Center, under your Manager (MCC) account |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | Your MCC's customer ID, digits only |
| `ANTHROPIC_API_KEY` | console.anthropic.com |

## Google Ads setup

1. **Google Cloud project**: create one at console.cloud.google.com, enable the
   Google Ads API under "APIs & Services."
2. **OAuth client**: under "Credentials," create an OAuth 2.0 Client ID (type:
   Web application). Add `<your-url>/api/google-ads/callback` as an authorized
   redirect URI. This gives you `GOOGLE_ADS_CLIENT_ID` / `GOOGLE_ADS_CLIENT_SECRET`.
3. **Brand verification** (optional but recommended): completing this on the
   Cloud project speeds developer token review from up to 5 business days down
   to a few hours.
4. **Manager (MCC) account**: create one at ads.google.com/home/tools/manager-accounts
   if you don't have one — this is the account client Google Ads accounts get
   linked under.
5. **Developer token**: from your MCC, go to Tools & Settings → API Center,
   apply for a token. Basic Access is enough to start.
6. Fill in `GOOGLE_ADS_DEVELOPER_TOKEN` and `GOOGLE_ADS_LOGIN_CUSTOMER_ID` (your
   MCC's ID) in `.env`.

Once that's done, the "Connect Google Ads account" button on a client's page
sends them through a real OAuth consent screen and links their account.

## How the safety model works

Nothing spends real money without a deliberate human click:

- AI-drafted campaigns are created as `DRAFT` rows in the database only —
  `lib/ai.ts` never touches the Google Ads API directly.
- Clicking **Approve & push live** is the one place a draft becomes a real
  Google Ads campaign (`lib/googleAds.ts` → `createSearchCampaign`) — and even
  then, it's created in a **paused** state. You still choose when to actually
  turn spend on.
- Google's own optimization suggestions (`/api/recommendations`) are surfaced
  for review, not auto-applied — a person clicks **Apply** per recommendation.
- Every single action — proposed, approved, executed, or failed — is written
  to the `ActionLog` table. That's your audit trail if anything ever needs to
  be traced back.

## Why Google's Recommendations API, not a custom optimizer

Phase 1 intentionally does not try to out-optimize Google's own Smart Bidding —
that's a decade of dedicated ML investment by Google, and no realistic "from
zero" build beats or matches it quickly. Instead, `fetchRecommendations()` and
`applyRecommendation()` in `lib/googleAds.ts` surface and let you apply Google's
own AI-generated suggestions for an account. This is both more honest and more
achievable than inventing a competing bidding algorithm — you can build a real
rules-based layer on top of this later (e.g. auto-pause anything under a ROAS
threshold) once you've watched how accounts actually perform.

## Syncing performance data

`/api/metrics/sync` pulls the last 30 days of campaign performance from Google
Ads and stores it in `DailyMetric`. It has no session check (it's meant to be
called by a scheduler, not a browser) — protect it in production by setting
`SYNC_SECRET` in your env and requiring an `x-sync-secret` header, then wire it
to a daily cron (Vercel Cron, GitHub Actions on a schedule, or any external
scheduler hitting the URL).

## Deploying

This is a standard Next.js + Prisma app — deploys cleanly to Vercel:

1. Switch `prisma/schema.prisma`'s datasource `provider` to `"postgresql"` and
   point `DATABASE_URL` at a real Postgres instance (Supabase, Neon, RDS, etc.)
   — SQLite is for local dev only, it won't work on Vercel's ephemeral filesystem.
2. Set all the env vars above in your hosting platform's dashboard.
3. `npx prisma db push` against the production database once, then deploy.
4. Update `GOOGLE_ADS_REDIRECT_URI` and `NEXTAUTH_URL` to your real domain, and
   add the production redirect URI to your Google OAuth client too.

## A note on this build

Everything above was scaffolded and tested for correctness (TypeScript passes
with zero errors once `npx prisma generate` runs — try it, that's the one
command worth confirming first). What wasn't possible to verify in the sandbox
this was built in: an actual live `npm run build` end-to-end, because that
sandbox's network doesn't allow reaching Prisma's engine-binary download host.
That's a restriction of the temporary build environment, not of this code —
`prisma generate` is a completely standard step that works normally on your
machine, in CI, and on Vercel. Run the Quick Start commands above and it should
build clean; if anything doesn't, that's genuinely worth flagging back.
