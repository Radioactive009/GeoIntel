🌍 GeoIntel AI — Geopolitical Intelligence System

GeoIntel AI collects global news, resolves which country each story is about, scores it for geopolitical risk, and renders the result as a live world alert map and intelligence feed.

🚀 Features

📰 Multi-Source News Ingestion
- RSS feeds from major international outlets (BBC, Al Jazeera, Guardian, DW, France 24, TASS and more)
- A per-country Google News search feed — keyless and unlimited, so the pipeline works with no API keys at all
- Optional NewsAPI and GNews providers when keys are configured
- Rotating ingestion across the full 249-country ISO catalog

🌐 Country Attribution
- Each article's country is resolved from its own text using a gazetteer of country names, aliases, demonyms and capitals
- Longest-match-wins ordering ("South Sudan" beats "Sudan"), with capitalisation checks for ambiguous terms ("US" vs "us")
- Articles that name no country stay unattributed rather than being misfiled

⚙️ Automated Data Pipeline
- APScheduler runs an ingest cycle every 30 minutes (configurable)
- Batched duplicate detection and one source row per outlet
- Configurable retention window purges stale articles

🧠 Risk Scoring
- Keyword event weights (tiered) combined with VADER sentiment and a mitigation layer
- Produces a 0–100 risk score, a level (low/medium/high), an event type and a category
- Deliberately lightweight so it runs on small free-tier instances — no transformer models

📊 Alert Engine
- Per-country alert levels computed in a single aggregate query
- Scores are shrunk toward the global mean by sample size, so a country with one alarming article does not top the world ranking

📺 Live Broadcasts
- Embeds broadcasters' 24/7 YouTube streams, tied to countries — selecting a country switches the player *and* filters the feed
- The current live video ID is resolved **server-side**: an embedded player is cross-origin, so the page cannot detect a dead stream on its own
- Channel IDs are resolved from handles at seed time rather than hardcoded, and unresolvable handles are skipped rather than breaking the seed
- Only the active player is mounted, so the page never boots a dozen video players at once

📈 Risk History & Escalation
- Every ingest cycle records where each country stands, one row per country per hour
- Sparklines on the alert ranking show each country's recent trajectory
- The escalation board ranks movers by **z-score against each country's own baseline**, not raw delta — so an unusual move in a normally quiet zone outranks routine noise somewhere volatile
- Countries without enough history are skipped rather than guessed at; the board says how much baseline it still needs

🏗️ System Architecture

```
News Sources (RSS + Google News + NewsAPI + GNews)
        ↓
Ingestion Pipeline  (app/services/ingest.py)
        ↓
Country Resolver    (app/services/country_resolver.py)
        ↓
Risk Engine         (app/services/risk_engine.py)
        ↓
Storage             (SQLite locally / PostgreSQL in production)
        ↓
FastAPI Backend     (app/main.py)
        ↓
React Dashboard     (frontend/)
```

🛠️ Tech Stack

- Backend: FastAPI, SQLAlchemy, APScheduler
- Scoring: vaderSentiment + rule-based event weights
- Data: feedparser, pycountry, requests
- Frontend: React 18, Vite, Tailwind, Recharts, react-simple-maps
- Storage: SQLite (dev) / PostgreSQL (prod)

📦 Setup

Backend:

```bash
git clone https://github.com/Radioactive009/GeoIntel.git
cd GeoIntel

python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate     # macOS/Linux

pip install -r requirements.txt

cp .env.example .env           # optional — the pipeline runs without any keys
uvicorn app.main:app --reload
```

The API starts on http://localhost:8000. On first run it creates the schema, syncs the country catalog and immediately ingests, so the dashboard has data within a minute.

Frontend:

```bash
cd frontend
npm install
npm run dev                    # http://localhost:3000
```

⚠️ Deploying the frontend: `VITE_API_URL` **must** be set at build time. Vite inlines it into the bundle, so a build without it ships `http://localhost:8000` and the deployed dashboard will load no news.

```bash
VITE_API_URL=https://your-backend.onrender.com npm run build
```

🔌 API

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/health` | Pipeline status: article counts, attribution rate, providers |
| GET | `/articles` | Paginated feed — `country`, `region`, `level`, `q`, `days`, `limit`, `offset` |
| GET | `/alert-analysis` | Per-country alert levels (`active_only=true` to skip empty countries) |
| GET | `/trends` | Risk history per country — `hours`, `points`, `country` |
| GET | `/movers` | Escalating / de-escalating countries — `hours`, `limit` |
| POST | `/snapshot` | Force a risk-history capture (runs automatically each cycle) |
| GET | `/channels` | Broadcaster live streams — `country`, `live_only` |
| GET | `/channels/preview` | Vet a YouTube handle before adding it (no write) |
| POST | `/channels` | Add a channel — `handle`, `name`, `country_iso`, `language` |
| PATCH | `/channels/{id}` | Enable/hide a channel (`enabled=true\|false`) |
| DELETE | `/channels/{id}` | Remove a channel |
| POST | `/channels/refresh` | Seed channels and re-resolve which are live |

### Adding a news channel

Check the handle first — `preview` tells you *why* a channel won't work, since
the three failure modes need different fixes:

```bash
curl "localhost:8000/channels/preview?handle=aljazeeraenglish"
```

| `reason` | Meaning |
|---|---|
| `ok` | Live and embeddable — safe to add |
| `handle_not_found` | Wrong handle. Copy it from the channel's URL (`youtube.com/@thehandle`) |
| `not_live` | Channel exists but isn't streaming now. Still fine to add if it runs a 24/7 stream — it appears once live |
| `not_embeddable` | Broadcaster disabled embedding; it can never play on the dashboard |

Then add it. No code change or redeploy needed:

```bash
curl -X POST "localhost:8000/channels?handle=aljazeeraenglish&name=Al%20Jazeera&country_iso=QA&language=en"
```

`country_iso` is what ties the stream to the map — selecting that country
switches the player to this channel. To ship a channel as a default for every
deployment instead, add a tuple to `SEED_CHANNELS` in
[app/services/channels.py](app/services/channels.py); handles are resolved to
channel IDs at seed time and unresolvable ones are skipped with a warning.
| GET | `/stats` | Counts by risk level, event type and provider |
| GET | `/countries` · `/sources` | Reference data |
| POST | `/ingest-batch?size=N` | Run one ingest cycle now |
| POST | `/ingest-news?country_iso=XX` | Ingest a single country |

⚙️ Configuration

All settings are environment variables — see [.env.example](.env.example). Notable ones:

- `INGEST_BATCH_SIZE`, `INGEST_INTERVAL_MINUTES` — ingestion cadence
- `RETENTION_DAYS` — how long articles are kept
- `ALERT_CONFIDENCE_WEIGHT` — how strongly low-sample countries are damped
- `TREND_RETENTION_DAYS` — how long risk-history snapshots are kept
- `ENABLE_SCHEDULER` — set `false` on extra web workers so only one runs ingestion
- `ALLOWED_ORIGINS` — CORS origins for production
- `DATABASE_URL` — Postgres URL; unset falls back to local SQLite

📌 Provider notes

- **RSS / Google News** — no key, no quota. This is the primary source.
- **NewsAPI** — free tier serves localhost only; returns 426/429 from a deployed server.
- **GNews** — free tier allows 100 requests/day with a 12-hour delay.

📊 Future Enhancements

- LLM-based country-wise daily intelligence summaries
- Trend and time-series analysis of risk scores
- Multi-country attribution per article (currently one primary country)
- Alerting/webhooks on threshold breaches
