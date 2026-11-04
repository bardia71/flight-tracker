# Where's Bardia? Family flight tracker

A small website that shows family where I'm flying. It reads my FLICA roster, follows my
aircraft on free ADS-B networks (adsb.lol, airplanes.live, adsb.fi) while I'm on a scheduled
flight, and saves the track. Family opens a secret link to see:

- my live position on a map while I'm flying (with an estimate when the plane is out of
  receiver range, e.g. over the ocean)
- "Not flying right now" with my last arrival airport otherwise
- recent flights, a date-range history, and stats (miles, hours, airports, countries)
- optional phone alerts on take-off and landing through the free ntfy app

Upcoming flights are never shown to family.

## Pages

| Address | Who | What |
| --- | --- | --- |
| `/f/<family key>` | Family | The map |
| `/f/demo` | Anyone | Preview with sample data |
| `/admin` | Me | Import roster, add/delete flights, copy the family link |

## How it runs (all on Cloudflare's free plan)

- `src/worker.js` serves the pages and the API.
- `src/tracker.js` runs every minute (cron). It only calls the ADS-B networks when one of my
  flights is between 1 hour before departure and 4 hours after scheduled arrival.
- `src/roster.js` reads pasted FLICA text (WestJet layout: `FR 02  712  YVR-YYZ 1620 2321`,
  local times) and calendar `.ics` files.
- Data lives in a Cloudflare D1 database (`schema.sql`).

## Deploying (one-time)

```sh
npm install
npx wrangler login
npx wrangler d1 create flight-tracker          # paste the database_id into wrangler.toml
npx wrangler d1 execute flight-tracker --remote --file schema.sql
npx wrangler secret put ADMIN_KEY              # your admin password
npx wrangler secret put FAMILY_KEY             # long random text for the family link
npx wrangler secret put NTFY_TOPIC             # optional: alerts topic name
npx wrangler deploy
```

## Local testing

```sh
npm run build                                  # rebuild airport + map data
npx wrangler d1 execute flight-tracker --local --file schema.sql
npx wrangler dev --test-scheduled              # uses .dev.vars for keys
```
