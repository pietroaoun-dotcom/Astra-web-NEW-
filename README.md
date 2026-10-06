# Astra

A personal Dota 2 ranked coach. It reads your public ranked history from OpenDota after games, finds patterns (deaths, farm, tilt, time of day, hero pool, game length, party), and gives a prioritised plan with the numbers behind each point. It never touches the game client.

## Run locally
```
npm run serve     # http://localhost:3000
npm test          # unit tests (node --test)
```
Needs Node 20+. No install step: there are no dependencies yet.

Open the site, enter your player ID (or an OpenDota/Dotabuff/Steam profile link), confirm, and wait for the first sync. Later visits render from the local cache and fetch only new games.

Your Dota 2 setting **Expose Public Match Data** must be on.

## Ask Astra (AI and voice)
A floating "Ask Astra" button opens a chat panel. Type or hold the orb (or hold `V`) to talk. Commands: `start game`, `note <text>`, `game finished`; anything else is a question answered from your synced data. If the AI is unavailable, Astra falls back to rule-based answers from the same numbers. Voice needs Chrome or Edge; typing works everywhere.

The AI runs in `api/ask.js` on the server. The browser sends your question, a compact summary of your stats and your notes; the API key never reaches the browser.

## Deploy to Vercel
1. Get a free Gemini key at https://aistudio.google.com/apikey (needs a Google account).
2. Install the CLI. In PowerShell use `npm.cmd i -g vercel` (plain `npm` can be blocked by script policy). Then `vercel login`.
3. In this folder run `vercel` and accept the defaults (framework: Other, no build command).
4. Add the secrets. In the Vercel dashboard open the project > Settings > Environment Variables and add `ASTRA_PASSCODE` and `GEMINI_API_KEY` for Production, or run `vercel env add ASTRA_PASSCODE production` and type the value when prompted.
5. Redeploy to production: `vercel --prod`. Open the URL, click Ask Astra, enter your passcode once per device.

**Voice:** replies are spoken with a natural Gemini voice through `/api/speak` (same passcode and limits; 12 per minute, 120 per day via `ASTRA_TTS_DAILY_LIMIT`). The default voice is Umbriel (easy-going); set `ASTRA_VOICE` in `.env.local` to try others, for example `Iapetus` (casual), `Charon` (calm and low) or `Algenib` (gravelly). Only the first sentence is spoken; the full answer stays on screen. If the voice service is busy or out of quota, the browser's best built-in voice is used instead. Do not add style instructions to the spoken text: the TTS models read them aloud.

Run the API locally: set the two variables in your terminal (`$env:ASTRA_PASSCODE='...'; $env:GEMINI_API_KEY='...'`), then `node scripts/serve.js`. `node scripts/serve-mock.js` runs a fake AI on port 3001 for testing (passcode `local-test`).

Limits: 8 questions/min per IP, 150/day total (`ASTRA_DAILY_LIMIT`), 5 wrong passcodes/min locks an IP out for a minute. Counters are in memory and reset when the server instance restarts; Gemini's own free-tier quota is the hard ceiling.

## Docs
BRIEF.md (requirements), PLAN.md (approved plan), CLAUDE.md (decisions, verified API findings, open items).
