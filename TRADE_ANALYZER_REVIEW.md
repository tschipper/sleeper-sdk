# Trade Analyzer Review

## Changes made
- Reworked the manual trade calculator to separate team selections, incoming/outgoing assets, source totals, and a visual value-share bar.
- Shortened explanatory copy and clarified that values are market estimates, not a definitive trade verdict.
- Added direct links to KeepTradeCut's trade calculator and FantasyPros' dynasty trade value chart.
- Displays StatsGuy values and KTC values separately and counts how many selected assets have values from each source.
- Uses a full KTC comparison only when every selected asset on both sides has a KTC value. Otherwise the primary balance uses the available StatsGuy values; the app never blends the two sources into one total.
- KTC pick values are explicitly shown as unavailable because the repository's latest KTC snapshot has player values but does not include pick values. The existing pick estimates remain illustrative only in the automated suggestion engine.

## Data-source findings
- The repository's latest KTC snapshot is dated 2026-10-17 and contains player value/rank fields, including Superflex and one-QB values. It does not contain draft-pick values.
- KeepTradeCut's terms prohibit automated scraping/data extraction; the integration should not attempt to scrape its live website. Continue using a data snapshot only where its acquisition and use are authorized.
- FantasyPros publishes dynasty value charts, including player and rookie-pick values. A supported API requires a FantasyPros API key. Do not depend on brittle HTML scraping in the app.
- Next improvement: replace the illustrative pick formula with values from a licensed/authorized source that supports rookie-pick year, round, position/range, and Superflex scoring. Until then, clearly label those values estimates and keep them out of any source-labeled market comparison.

## Validation
- Inspected the updated HTML/JS after committing and confirmed the new balance controls, source links, missing-pick-value label, and balanced braces/parentheses.
- Browser-based runtime/screenshot testing was not executed from this GitHub-connected environment. Run `dashboard/qa-smoke.mjs` against the deployed preview and test mobile-width overflow, selecting/removing assets, changing teams, clearing trades, and copying a trade summary.
