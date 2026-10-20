# Sleeper GM — Product and QA Audit

**Reviewed:** 2026-10-20  
**Live dashboard:** https://tschipper.github.io/sleeper-sdk/dashboard/  
**Rollback point:** `backup/pre-full-qa-2026-10-19`

## Quality bar

- Keep the same team identity (team name first, owner handle secondary) across the roster selector, roster page, matchup, and trade views.
- Use concise labels and one consistent visual language. Player names are the interaction target; avoid unexplained info icons.
- Never show contradictory states, especially `BYE WEEK` alongside `Kickoff TBD`.
- Do not expose raw trade-market totals in selected-asset lists or plain-language suggestions.
- Keep the future rookie draft focused on the next available draft year; keep historical draft recaps in their own view.
- All visible buttons and form fields must have accessible names; avoid duplicate IDs and horizontal overflow.
- Run browser smoke tests at phone, tablet, and desktop widths before treating a UI change as done.

## What is currently covered

- **My Team:** roster, player details, lineup-change suggestions, team identity, recent league activity, league usage indicators, standings / Max PF / dynasty outlook.
- **Matchup:** team avatars and names, actual and projected scores, estimated win chance (clearly labeled as an estimate), week navigation, starters, and a combined collapsible bench / IR / taxi list.
- **Waivers:** available-player search and modes, roster-aware recommendations, rookie indicators, injury and bye labels, and Sleeper-wide trending adds/drops when available.
- **Trades:** qualitative market comparison, positional-needs and depth analysis, partner activity/history, suggested packages, asset removal/clear, and copyable plain-language trade summaries.
- **Draft:** future picks and rookie recommendations for the next available year, plus historical draft recaps with NFL draft-team, college, college PPG, NFL current-season PPG, fantasy drafting team, and rookie indicators where data is available.
- **Player details:** concise position and overall ranks calculated from season PPG, Sleeper rostered / started rates where available, weekly projection / actual / season-average PPG, game-by-game stats, and fantasy news.
- **Load behavior:** render the core dashboard before slower stats and projection feeds finish, then update when the full refresh completes.

## Competitive comparison and deliberate scope

Sleeper's own product emphasizes chat/social features, team customization, player research, live scoring, and commissioner controls. FantasyPros emphasizes scoring-aware trade and waiver advice; Dynasty Daddy highlights multi-market trade comparison, three-team trades, shareable trade cards, power rankings, and playoff simulation.

This dashboard should **complement Sleeper as a decision assistant**, not attempt to rebuild league chat, commissioner settings, or the live draft room. The most valuable gaps to address next are:

1. **Trade analysis depth:** scoring-aware adjustments, transparent source/as-of dates, and eventually multi-market comparisons and three-team trades. Keep the default verdict plain-language.
2. **Season outlook:** add playoff odds / scenario simulation only when schedule, standings, and league rules can be sourced reliably.
3. **Data reliability:** monitor every external data feed and show a clear stale/unavailable state instead of implying missing data is zero.
4. **Actionable alerts:** optional, narrowly scoped alerts for meaningful injury, lineup, or waiver changes; avoid noisy notifications.
5. **Further functional QA:** exercise every mode switch, filter, selector, and modal close path; add regression cases whenever a real bug is found.

## Known external blocker

The **KTC Daily Snapshot** workflow generated its dated data branch on 2026-10-19 but failed while creating a pull request because the repository's GitHub Actions settings do not permit Actions to create pull requests. This is a repository permission setting, not a dashboard JavaScript failure. Do not claim the scheduled KTC merge pipeline is healthy until that setting or the workflow's approved merge path is resolved.

## Current automated QA

The Playwright smoke workflow syntax-checks the inline dashboard JavaScript before launching Chromium. It then loads a real league, waits for the explicit full-refresh status, exercises all five main tabs, switches teams and checks identity consistency, verifies actual/projected scores are vertically stacked for both matchup teams, tests week navigation and reserve expansion, exercises every waiver mode and trade add/remove/copy/clear action, checks trade-result evaluation and uses a controlled traded-pick scenario to verify that a future pick appears under its current owner—not the original owner—checks the trade market-source/freshness disclosure, next-year-only draft headings and research links, validates draft-recap metadata when picks exist, and refreshes data. Rookie markers are included across roster, matchup, waiver, draft recap, player details, transaction history, and trade views; native trade-asset dropdowns use a text Rookie marker. Player details are tested with close button, Escape, and backdrop dismissal; PPG-based position/overall rank labels, Sleeper rostered/started usage, the concise weekly projection/actual/season-average line, and the game-by-game heading are verified, and standings, Max PF, and dynasty-outlook detail modals are opened and closed. It audits duplicate IDs, accessible names on buttons and fields, missing rookie markers on player-name buttons, contradictory bye-week labels, browser errors, and horizontal overflow at 320px, phone, tablet, and desktop widths.

The October 20 audit fixed runtime blockers involving position normalization scope and scoring-metadata initialization order, corrected malformed string concatenation in the compact player-projection panel, and made the core roster render before slower stats/projection requests finish.

Latest verified UI smoke run: https://github.com/tschipper/sleeper-sdk/actions/runs/39358942677  
Latest verified dashboard deployment: https://github.com/tschipper/sleeper-sdk/actions/runs/39358942724

## Public references used for the comparison

- Sleeper feature overview: https://sleeper.com/fantasy-football/
- FantasyPros trade analyzer: https://www.fantasypros.com/nfl/myplaybook/trade-analyzer.php
- Dynasty Daddy trade calculator and multi-market / three-team workflows: https://www.dynasty-daddy.com/help/trade-calculator
- Dynasty Daddy product suite: https://dynasty-daddy.com/
