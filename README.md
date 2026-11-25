# flagdeck

A terminal dashboard and CLI for **self-hosted [Flagsmith](https://github.com/Flagsmith/flagsmith)**, plus a one-command Docker setup with seeded data and a live demo app.

Built for the Toggle Wars hackathon, Track 03: Build on Open Source Flagsmith.

## The problem

Flagsmith's dashboard shows one environment at a time. Before a release you want to answer "what is different between Staging and Production?" and fix it without clicking through every flag in every environment. Getting a local Flagsmith with realistic data to try this against also takes manual setup.

## What it does

| Piece | What you get |
| --- | --- |
| `docker compose up` | Self-hosted Flagsmith (Postgres, API, task processor), a seed job that creates the admin, org, project, 3 environments and 5 flags, and a demo storefront at <http://localhost:3000> |
| `flagdeck` (TUI) | A flags × environments matrix. Move with arrows, toggle with space, copy a cell to the neighbouring environment with `<` / `>`, filter to drifted flags with `d`. It refreshes every 4 seconds, so changes made in the Flagsmith UI show up. |
| `flagdeck diff/promote` | Show or apply the difference between two environments. Promoting to a production-like environment is a dry run unless you pass `--yes`. The TUI asks for `y/N` before touching Production. |
| `flagdeck ls --json` | Machine-readable matrix for CI checks (`flagdeck diff staging production` exits 1 when they differ). |
| Demo storefront | Reads flags through the Flagsmith SDK API. Toggle `dark_mode`, `new_checkout`, `ai_assistant`, `maintenance_banner` or edit `hero_headline` in the TUI and the page changes within 1.5 seconds. |

It uses the Management API (login token or organisation API key) and the public Flags API. No runtime dependencies, Node 18.3 or newer.

## Quick start

```bash
git clone https://github.com/iittjjee2024/flagdeck.git && cd flagdeck
docker compose up -d          # first run takes about 2 minutes while Flagsmith migrates
node bin/flagdeck.js          # open the dashboard
```

- Flagsmith UI: <http://localhost:8000> (`admin@example.com` / `flagdeck-demo-1`)
- Demo app: <http://localhost:3000>

Install the command globally with `npm link`, then run `flagdeck`.

### Use it with your own Flagsmith

```bash
export FLAGSMITH_URL=https://flags.example.com
export FLAGSMITH_ORG_TOKEN=...        # organisation API key (or FLAGDECK_TOKEN for a user token)
flagdeck --project 12
```

## Experiment demo: PayPal button A/B test on self-hosted Flagsmith

Follows [Flagsmith's PayPal button example](https://docs.flagsmith.com/experimentation/example-paypal-button) end to end. Open the shop at `/shop` on the demo app (port 3000).

![Flagsmith Shop experiment](docs/shop.png)

| Step in the docs | What flagdeck does |
| --- | --- |
| Create a multivariate flag `paypal_button` | `flagdeck seed` creates it: `control` plus a `show-paypal` option at 50%. |
| Create the metric | `checkout_completed`, occurrence, higher is better. |
| Hypothesis | "Offering PayPal at checkout will increase checkout completion by at least 10%." |
| Serve variations | The shop asks Flagsmith for the flag per identity (`/api/v1/identities/`). Flagsmith's multivariate bucketing decides who sees PayPal. |
| Record exposures | When the checkout page is shown, the shop records an exposure. It is counted once per identity, first variant wins, and identities served two variants are excluded. |
| Track conversions | `checkout_completed` counts only after the identity's first exposure. |
| Read results | Exposures, rate, delta, 95% credible interval, win probability, sample ratio mismatch warning and "collecting data" thresholds, using a Beta-Binomial Bayesian model (`src/stats.js`). |
| Roll out the winner | `flagdeck rollout paypal_button show-paypal --env Production --yes` sets the allocation to 100%. |

Click **Simulate 1000 users** (or run `flagdeck experiment simulate --users 1000`) to generate traffic with a real difference between variants (8% control, 11.5% PayPal). Open the checkout yourself to see the PayPal button appear for the show-paypal bucket and the event log update.

**What is and is not Flagsmith here.** Variation assignment, the flag and the rollout all run on your self-hosted Flagsmith. Flagsmith's built-in Experiments results page needs a connected warehouse, so flagdeck records exposures and conversions itself and computes the statistics locally. It does not send events to Flagsmith's event ingestion.

## Commands

```
flagdeck                           interactive matrix
flagdeck ls [--drift] [--json]
flagdeck toggle <flag> <env> [on|off] [--yes]
flagdeck diff <from> <to>
flagdeck promote <from> <to> [flag…] [--dry-run] [--yes]
flagdeck seed                      idempotent demo data
flagdeck demo [--port 3000]
flagdeck rollout <flag> <variant> [--env Production] [--yes]
flagdeck experiment [results|simulate|reset] [--users N]
```

Environment names match by prefix and ignore case (`prod` means `Production`).

## Demo script (for the video)

1. `docker compose up -d`, then show the Flagsmith UI and the storefront side by side.
2. `flagdeck`: point out that `new_checkout` and `ai_assistant` differ between environments (the `≠` column).
3. Press `d` to show only drifted flags. Toggle `ai_assistant` in Development and watch the chat bubble appear on the storefront.
4. Select `new_checkout` in Staging, press `>`. Confirm the Production prompt with `y` and watch the checkout button change when the storefront is set to Production.
5. Show `flagdeck diff staging production` exiting 0 and how it fits in a CI pipeline.

## How Flagsmith is used

- Management API: organisations, projects, environments, features, per-environment feature states (read, PATCH).
- Flags API with environment keys: the demo app evaluates flags exactly as an SDK would.
- Self-hosted via the official Docker image and Postgres.

## Tests

```bash
node --test test/flagdeck.test.js
```

Unit tests cover drift detection, promote (including dry run), production confirmation and rendering. The integration path (seed, toggle, promote, demo) is exercised by `docker compose up`.

## License

BSD-3-Clause, matching Flagsmith.
