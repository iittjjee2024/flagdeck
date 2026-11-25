# flagdeck demo video script (about 3 minutes)

The video has to show three things: the problem, what you built, and how Flagsmith fits in. The script follows that order.

## Before recording

1. `docker compose up -d` and wait about 2 minutes. Check `docker compose ps`.
2. Run `node bin/flagdeck.js experiment reset` so the shop starts with empty results.
3. Arrange the screen: browser on the left, terminal on the right. Font size at least 16 so it is readable at 720p.
4. Open these tabs: Flagsmith UI (`localhost:8000`, log in with `admin@example.com` / `flagdeck-demo-1`), `localhost:3000` (storefront), `localhost:3000/dashboard`, `localhost:3000/shop`.
5. Run `node bin/flagdeck.js ls` once to confirm it connects.

## Script

### 0:00 to 0:25. The problem

**Show:** the Flagsmith UI on the Features page of one environment.

**Say:**
"Flagsmith is a great open-source feature flag platform, but its dashboard shows one environment at a time. Before a release I want to know what is different between Staging and Production, and fix it without clicking through every flag. Setting up a local Flagsmith with realistic data also takes manual work. I built flagdeck to solve both, on self-hosted Flagsmith."

### 0:25 to 0:50. One-command setup

**Show:** terminal, run `docker compose up -d`, then `docker compose ps`.

**Say:**
"One command starts self-hosted Flagsmith with Postgres, runs a seed job that creates an admin, an organisation, a project, three environments and six flags, and starts a demo app. Anyone can clone the repo and have the same setup."

### 0:50 to 1:40. Terminal dashboard

**Show:** run `node bin/flagdeck.js` in the terminal. Keep the storefront (`localhost:3000`, environment set to Development) visible next to it.

**Do and say:**
1. "This is a flags by environments matrix. The `≠` column marks flags that differ between environments." Point at `ai_assistant` and `new_checkout`.
2. Press `d`. "Drift filter: only the flags that differ."
3. Click the `ai_assistant` cell under Development (or press space). "I click a cell to toggle it. The change goes to Flagsmith's Management API." Watch the chat bubble on the storefront appear or disappear within about 2 seconds.
4. Select `new_checkout` under Staging and press `>`. When the Production prompt appears, press `y`. "Copying a state to the next environment. Production asks for confirmation."
5. Press `q`.

### 1:40 to 2:10. CLI for scripts and CI

**Show:** terminal.

**Run:**
```
node bin/flagdeck.js diff staging production
node bin/flagdeck.js promote staging production --dry-run
node bin/flagdeck.js ls --json
```

**Say:**
"The same logic is a CLI. `diff` exits with code 1 when two environments differ, so it works as a pre-release check in CI. Promote is a dry run by default for Production, and `--json` gives machine-readable output."

### 2:10 to 2:40. Web dashboard

**Show:** `localhost:3000/dashboard`.

**Do and say:**
1. Click a toggle switch. "Every control is live: toggles, copy to the next environment, drift filter, diff and promote."
2. Click `Diff` between Staging and Production, then `Promote differences` and confirm the Production prompt.
3. "Teammates who do not use a terminal get the same tool in the browser. It is bound to localhost because it can change flags."

### 2:40 to 3:10. Sample app with a multivariate flag

**Show:** `localhost:3000/shop`.

**Do and say:**
1. "This is a sample app that doubles as a starter template. A multivariate flag called `paypal_button` has two variations. Flagsmith assigns each visitor one, and only the `show-paypal` group sees a PayPal button."
2. Click **Add to cart**. Point at the strip: flag, identity, variant. Click **Pay by card**. The event log shows the exposure and the counted `checkout_completed` event.
3. Click **Simulate 1000 users**. "Visitor IDs go through Flagsmith for real. The panel shows exposures, rate, win probability and a credible interval."
4. In the terminal run `node bin/flagdeck.js rollout paypal_button show-paypal --env Production --yes`. "Roll the winning variation out to everyone through the Management API."

### 3:10 to 3:30. How Flagsmith fits, and close

**Show:** the README on GitHub, scrolled to "How Flagsmith is used".

**Say:**
"Flagsmith is the core of everything here: the Management API for environments, features and feature states, the Flags and identities API for evaluation, multivariate bucketing for the variations, and self-hosting through the official Docker image. flagdeck has no dependencies, 14 tests, and one command to start. The repo is github.com/iittjjee2024/flagdeck. Thanks for watching."

## Recording tips

- Keep it under 3 minutes 30 seconds. Cut any step that fails and re-record it.
- If a Production prompt appears, say out loud why it is there. Judges look for the safety design.
- Do not read the README aloud. Show the screen and talk about what it does.
- Upload to YouTube as unlisted (or Loom) and paste the link into the submission form.

## Submission checklist

- [ ] Repo `iittjjee2024/flagdeck` is public
- [ ] README has setup steps and how Flagsmith is used (done)
- [ ] Demo video link added to the submission
- [ ] Starred `Flagsmith/flagsmith`
- [ ] Submitted before 8:00 PM IST on Nov 29
