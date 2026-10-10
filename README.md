# Astra

A personal Dota 2 ranked coach. It reads your public ranked history from OpenDota after games, finds patterns (deaths, farm, tilt, time of day, hero pool, game length, party), and gives a prioritised plan with the numbers behind each point. A voice assistant runs the whole site: drafts, preferences, notes during the game, and questions. It never touches the game client.

## Run locally
Double-click `start-astra.bat`, or:
```
node scripts/serve.js   # http://localhost:3000 (this PC only)
npm test                # unit tests (node --test)
```
Needs Node 20+. No install step: there are no dependencies. Put `ASTRA_PASSCODE` and `GEMINI_API_KEY` in a `.env.local` file (git-ignored) to enable the AI locally. The local server only serves the site itself and only listens on this PC, so `.env.local` can never be downloaded.

Open the site, enter your player ID (or an OpenDota/Dotabuff/Steam profile link), confirm, and wait for the first sync. Later visits render from the local cache and fetch only new games. Your Dota 2 setting **Expose Public Match Data** must be on.

## The voice assistant
Talk from the **Live** page (full conversation) or the **Ask Astra** panel on any other page. Hold the orb or hold `V` to talk, or turn on **Conversation mode** to talk hands-free: Astra listens, stops while it thinks and speaks, then listens again. Typing works everywhere; voice input needs Chrome or Edge.

Things you can say:
- Draft: "enemy has Axe and Lina", "we have Crystal Maiden", "I'm playing Zeus", "remove Axe", "clear the draft", "what should I pick?"
- Preferences: "my role is carry", "my goal is Divine", "focus on deaths", "add Zeus to my favourites", "never recommend Techies"
- Memory: "remember that I struggle against Broodmother", "forget Broodmother"
- In game: "start game", "I just died to a gank", "note lost the fight at Roshan", "game finished" (reviews the game with your notes)
- Navigation: "open the draft", "show my last game"
- Questions about your data: "why do I lose so many games?"

How it works: `api/agent.js` sends what you said, a compact summary of your stats, the recent conversation (so follow-ups like "what about on Lina?" work), the current draft and your notes to Gemini, which returns a reply plus structured changes. The server drops changes you didn't talk about; the browser applies the rest, double-checks long sentences clause by clause, and shows exactly what changed. If the AI is unavailable, an offline parser still handles the commands and questions get rule-based answers. The API key never reaches the browser.

**Questions about your own data** are answered from your full ranked history, not just a summary. `js/query.js` computes any slice of your games: a hero you play, games with or against a hero (team compositions are stored on sync), a period, game length, role, solo/party, time of day, broken down by hero, enemy, ally, month, week, weekday, session game and more, or a list of games. Before calling the AI, the browser computes the slices your question obviously needs (every hero and period you name, your record against each enemy in the draft). If the AI needs anything else, it returns data requests; the browser runs them and asks once more with the results. Examples: "which heroes give me the most trouble?", "my Invoker this month vs last month", "do I play worse at night?", "list my worst Pudge games", "how am I on Lina against Axe?".

**Models:** coaching answers try the full `gemini-3.5-flash` first (much stronger reasoning) and fall back to the lite models when it is busy or slow. Override with `GEMINI_SMART_MODEL`, or set `LLM_PROVIDER=anthropic` with `ANTHROPIC_API_KEY` to use Claude (`ANTHROPIC_MODEL`, default `claude-sonnet-5-5`).

**Voice output:** replies are spoken with a natural Gemini voice through `/api/speak`. The default voice is Umbriel; set `ASTRA_VOICE` (for example `Iapetus`, `Charon`, `Algenib`). Short confirmations use the instant browser voice. Do not add style instructions to the spoken text: the TTS models read them aloud.

## Deploy to Vercel
1. Run `node scripts/build-upload.js`. It rebuilds `upload-to-github/` with exactly the files the site needs and checks them (no hidden byte-order marks, valid JSON, no secrets, every import present).
2. Upload the contents of `upload-to-github/` to your GitHub repo (see `UPLOAD-INSTRUCTIONS.txt`), or push with git.
3. In Vercel: Add New > Project > import the repo > Framework: Other > Deploy.
4. Settings > Environment Variables: add `ASTRA_PASSCODE` and `GEMINI_API_KEY` (Production), then redeploy.

Limits: 8 questions and 15 voice commands per minute per IP, 400 AI calls per day in total (`ASTRA_DAILY_LIMIT`), 120 spoken replies per day (`ASTRA_TTS_DAILY_LIMIT`), and 5 wrong passcodes per minute lock an IP out for a minute. Counters are in memory and reset when the server instance restarts; Gemini's own free-tier quota is the hard ceiling.

## Docs
BRIEF.md (requirements), PLAN.md (approved plan), CLAUDE.md (decisions, verified API findings, open items).
