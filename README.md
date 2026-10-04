# gentle-shell-minimax-usage

Shows your MiniMax Token Plan quota inside Gentle Shell for Pi. It registers a
`gentle-pi:usage-source/v1` source for the `minimax` provider and returns data
only; Gentle Shell draws the meters, thresholds and countdowns.

## What you get

With a `minimax/*` model active, Alt+U (and the sidebar Usage group and footer
bar) shows one `general` limit with two windows:

- `5h`: percent used in the current 5-hour window and when it resets.
- `week`: percent used in the current weekly window and when it resets.

The data comes from `GET https://api.minimax.io/v1/token_plan/remains`, with the
legacy Coding Plan path as a fallback. Gentle Shell supplies the API key, so
this extension never reads credentials.

## Install locally

Copy the package into a Pi extension subdirectory:

```sh
mkdir -p ~/.pi/agent/extensions/minimax-usage
cp -r package.json extensions lib ~/.pi/agent/extensions/minimax-usage/
```

Pi loads one-level subdirectories of `~/.pi/agent/extensions/` that have a
`package.json` with a `pi.extensions` manifest. Restart Pi after copying.

## Test

```sh
npm install
npm test
npm run typecheck
```

Tests run on Node 24 with `--experimental-strip-types` and need no network.

## Known limits

- The meter appears only while a `minimax/*` model is active.
- The endpoint does not report the plan tier, so no plan name is shown.
