import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = process.env.DASHBOARD_URL || "http://127.0.0.1:4173/";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const pageErrors = [];
page.on("pageerror", error => pageErrors.push(error.message));
page.on("console", message => { if (message.type() === "error") pageErrors.push("console: " + message.text()); });

async function noHorizontalOverflow(label) {
  const result = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth
  }));
  assert.ok(result.document <= result.viewport + 1 && result.body <= result.viewport + 1,
    label + " has horizontal overflow: " + JSON.stringify(result));
}
async function assertByeLabels(label) {
  const violations = await page.locator(".waiver-card, .player-row, .matchup-player").evaluateAll(nodes => nodes.filter(el => /BYE WEEK/.test(el.innerText || "") && /Kickoff TBD/.test(el.innerText || "")).map(el => (el.innerText || "").slice(0, 180)));
  assert.deepEqual(violations, [], label + ": bye-week players must not also show Kickoff TBD");
}
async function auditPage(label) {
  const audit = await page.evaluate(() => ({
    duplicateIds: [...document.querySelectorAll("[id]")].map(el => el.id).filter((id, i, all) => all.indexOf(id) !== i),
    unnamedButtons: [...document.querySelectorAll("button")].filter(el => el.getClientRects().length && !(el.innerText || "").trim() && !el.getAttribute("aria-label") && !el.getAttribute("title") && !el.getAttribute("aria-labelledby")).map(el => el.outerHTML.slice(0, 140)),
    unlabeledFields: [...document.querySelectorAll("input,select,textarea")].filter(el => el.getClientRects().length && !el.disabled && !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby") && !el.getAttribute("title") && !el.placeholder && !(el.labels && [...el.labels].length) && !el.closest("label")).map(el => el.outerHTML.slice(0, 140)),
    missingRookieMarkers: [...document.querySelectorAll(".player-name-open[data-player]")].filter(el => isRookiePlayer(el.dataset.player) && !el.querySelector(".rookie-icon")).map(el => (el.innerText || "").trim()).slice(0, 20)
  }));
  assert.deepEqual(audit.duplicateIds, [], label + ": duplicate HTML IDs found");
  assert.deepEqual(audit.unnamedButtons, [], label + ": visible buttons need accessible names");
  assert.deepEqual(audit.unlabeledFields, [], label + ": visible form controls need accessible labels");
  assert.deepEqual(audit.missingRookieMarkers, [], label + ": rookie players in name buttons need the R marker");
}
async function openTab(tab, expectedText) {
  await page.locator('nav [data-tab="' + tab + '"]').click();
  await page.locator("#content").getByText(expectedText, { exact: false }).first().waitFor({ state: "visible", timeout: 15000 });
  await noHorizontalOverflow(tab);
  await assertByeLabels(tab);
  await auditPage(tab);
}

try {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
  await page.locator("#status").waitFor();
  await page.waitForFunction(() => document.querySelectorAll("#team option").length > 1 && (document.querySelector("#content")?.textContent || "").trim().length > 20, null, { timeout: 120000 });
  await page.waitForFunction(() => typeof state !== "undefined" && Object.keys(state.schedule || {}).length > 0, null, { timeout: 20000 });
  assert.ok(await page.locator("#team option").count() > 1, "team selector should populate");
  assert.ok((await page.locator("#content").innerText()).trim().length > 20, "initial team page should render");
  await page.waitForFunction(() => /finishing stats and projections|teams · refreshed|Could not load data/i.test(document.querySelector("#status")?.textContent || ""), null, { timeout: 120000 });
  const initialStatus = (await page.locator("#status").innerText()).trim();
  assert.ok(!/Could not load data/i.test(initialStatus), "initial dashboard load failed: " + initialStatus + "; content: " + (await page.locator("#content").innerText()).slice(0, 500));
  await page.locator(".team-identity-card").waitFor({ state: "visible", timeout: 30000 });
  await page.waitForFunction(() => /teams · refreshed/i.test(document.querySelector("#status")?.textContent || ""), null, { timeout: 120000 });
  await page.getByText("Recent league activity", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  const liveDataCounts = await page.evaluate(() => ({
    projections: Object.keys(state.weeklyProjection || {}).length,
    seasonPpg: Object.keys(state.weeklyPPG || {}).length,
    marketRanks: Object.values(state.marketPlayers || {}).filter(m => Number(m?.rank?.sf_dynasty ?? m?.rank?.sfDynasty ?? m?.rank?.sfDynastyRank ?? m?.rank?.sf_dynasty_rank ?? m?.sf_dynasty_rank ?? m?.sfDynastyRank) > 0).length
  }));
  assert.ok(liveDataCounts.projections > 0, "live Sleeper projection feed should produce usable player projections");
  assert.ok(liveDataCounts.seasonPpg > 0, "live Sleeper stats feed should produce season PPG values for ranking");
  assert.ok(liveDataCounts.marketRanks > 0, "dynasty market feed should produce rankings");
  assert.equal(await page.locator(".team-identity-card").count(), 1, "roster page should show exactly one consistent team identity card");
  assert.ok(await page.locator(".team-avatar").count() === 1, "roster page should show team avatar or fallback");
  const marketAvailabilityScenario = await page.evaluate(() => {
    const roster = state.rosters.find(r => String(r.roster_id) === String(state.selectedRoster));
    const hasRosterValues = (roster?.players || []).some(id => {
      const m = state.marketPlayers[String(id)] || {};
      const raw = m.value?.sf_dynasty ?? m.value?.sfDynasty ?? m.sf_dynasty ?? m.sfDynasty ?? (typeof m.value === "number" || typeof m.value === "string" ? m.value : null);
      const value = Number(raw);
      return Number.isFinite(value) && value > 0;
    });
    const savedAsOf = state.marketAsOf;
    state.marketAsOf = "";
    render();
    const futureOutlook = document.querySelector('[data-ranking="dynasty"] strong')?.textContent.trim();
    state.marketAsOf = savedAsOf;
    render();
    return { hasRosterValues, futureOutlook };
  });
  if (marketAvailabilityScenario.hasRosterValues) {
    assert.notEqual(marketAvailabilityScenario.futureOutlook, "Unavailable",
      "missing market update-date metadata must not hide a roster outlook when usable team values exist");
  }
  const accessibilityAudit = await page.evaluate(() => ({
    duplicateIds: [...document.querySelectorAll("[id]")].map(el => el.id).filter((id, i, all) => all.indexOf(id) !== i),
    unnamedButtons: [...document.querySelectorAll("button")].filter(el => el.getClientRects().length && !(el.innerText || "").trim() && !el.getAttribute("aria-label") && !el.getAttribute("title") && !el.getAttribute("aria-labelledby")).map(el => el.outerHTML.slice(0, 140))
  }));
  assert.deepEqual(accessibilityAudit.duplicateIds, [], "duplicate HTML IDs found");
  assert.deepEqual(accessibilityAudit.unnamedButtons, [], "visible buttons need accessible names");
  await auditPage("My Team");
  const teamSelect = page.locator("#team");
  const originalTeamId = await teamSelect.inputValue();
  const otherTeamOption = teamSelect.locator("option").nth(1);
  if (await otherTeamOption.count()) {
    const otherTeamId = await otherTeamOption.getAttribute("value");
    const otherTeamLabel = (await otherTeamOption.innerText()).trim();
    await teamSelect.selectOption(otherTeamId);
    await page.waitForFunction(label => document.querySelector(".team-identity-copy strong")?.textContent.trim() === label, otherTeamLabel, { timeout: 10000 });
    await openTab("matchup", "Starters");
    assert.equal((await page.locator(".matchup-team-title").first().innerText()).trim(), otherTeamLabel, "selected team identity must stay consistent after changing teams");
    await teamSelect.selectOption(originalTeamId);
    await page.locator('nav [data-tab="team"]').click();
    await page.waitForFunction(id => document.querySelector("#team")?.value === id && document.querySelector(".team-identity-copy strong"), originalTeamId, { timeout: 10000 });
  }
  await noHorizontalOverflow("My Team");

  await openTab("matchup", "Starters");
  const selectedTeamLabel = await page.locator("#team option:checked").innerText();
  const matchupTeamLabel = await page.locator(".matchup-team-title").first().innerText();
  assert.equal(matchupTeamLabel, selectedTeamLabel, "team name should match between roster selector and matchup header");
  const scoreStacks = page.locator(".matchup-team-header .matchup-score");
  assert.ok(await scoreStacks.count() >= 2, "both matchup teams should show score stacks");
  for (let i = 0; i < await scoreStacks.count(); i++) {
    const score = scoreStacks.nth(i);
    const actual = await score.locator("strong").boundingBox();
    const projection = await score.locator("span").boundingBox();
    assert.ok(actual && projection, "team " + i + " actual and projected scores should both render");
    assert.ok(projection.y > actual.y && Math.abs((projection.x + projection.width / 2) - (actual.x + actual.width / 2)) < 4,
      "team " + i + " projected score should be centered directly underneath actual score");
  }
  const nextWeek = page.locator('[data-week="1"]').first();
  if (await nextWeek.count()) {
    const before = await page.locator(".week-control strong").innerText();
    await nextWeek.click();
    await page.waitForFunction(prev => document.querySelector(".week-control strong")?.textContent !== prev, before, { timeout: 15000 });
    await noHorizontalOverflow("matchup after week change");
    await page.locator('[data-week="-1"]').first().click();
  }
  const expand = page.locator("#content [data-expand]").first();
  if (await expand.count()) { await expand.click(); await noHorizontalOverflow("matchup expanded bench"); }

  await openTab("waivers", "Waiver Wire");
  const waiverModes = page.locator("[data-waiver-mode]");
  for (let i = 0, count = await waiverModes.count(); i < count; i++) {
    const mode = waiverModes.nth(i);
    const label = (await mode.innerText()).trim() || ("mode " + i);
    await mode.click();
    await noHorizontalOverflow("waiver mode " + label);
    await assertByeLabels("waiver mode " + label);
  }
  const cutSuggestion = page.locator(".cut-suggest").first();
  if (await cutSuggestion.count()) { await cutSuggestion.click(); await page.locator(".waiver-cut").waitFor({ state: "visible", timeout: 10000 }); }
  const search = page.locator("#waiver-search");
  if (await search.count()) { await search.fill("xyz-no-match-test"); await noHorizontalOverflow("waiver search"); await search.fill(""); }

  await openTab("trades", "Trade");
  const marketDataNote = page.locator(".market-data-note");
  assert.equal(await marketDataNote.count(), 1, "trade calculator should disclose market-data source/freshness or unavailability");
  assert.match(await marketDataNote.innerText(), /Market source: StatsGuyFantasy|Market data unavailable/, "trade market note should explain its source or unavailable state");
  assert.equal(await page.getByText(/adjusts Sleeper’s published points using your league’s scoring rules/).count(), 1,
    "trade scouting should explain league scoring adjustments and standard-format fallback");
  for (const selector of ["#mt-add-give", "#mt-add-get", "#trade-view"]) {
    const control = page.locator(selector);
    if (await control.count()) await control.selectOption({ index: Math.min(1, (await control.locator("option").count()) - 1) }).catch(() => {});
  }
  const selectedTradeAssets = page.locator("[data-mt-remove]");
  if (await selectedTradeAssets.count() >= 2) {
    const tradeResult = (await page.locator(".pick-recommendation h3").first().innerText()).trim();
    assert.ok(tradeResult.length > 0 && tradeResult !== "Add assets to both sides to compare",
      "trade calculator should evaluate both selected sides");
  }
  const copyTrade = page.locator("#mt-copy");
  if (await copyTrade.count()) {
    await copyTrade.click();
    await page.waitForFunction(() => /trade summary copied/i.test(document.querySelector("#status")?.textContent || ""), null, { timeout: 10000 });
  }
  const removeAsset = page.locator("[data-mt-remove]").first();
  if (await removeAsset.count()) { await removeAsset.click(); await noHorizontalOverflow("trade asset removal"); }
  const clearTrade = page.locator("#mt-clear");
  if (await clearTrade.count()) { await clearTrade.click(); await noHorizontalOverflow("clear trade"); }
  await noHorizontalOverflow("trade analyzer");

  await openTab("draft", "Future Draft");
  const futureHeading = await page.locator("#content h2").filter({ hasText: "Future Rookie Draft" }).innerText();
  const expectedFutureYear = await page.evaluate(() => Math.max(Number(state.league?.season) || 0, new Date().getFullYear()) + 1);
  assert.equal(futureHeading.trim(), expectedFutureYear + " Future Rookie Draft", "future draft should focus on the next available year only");
  assert.equal(await page.locator("#content h2").filter({ hasText: "Future Rookie Draft" }).count(), 1, "only one future rookie draft year should be displayed");
  const recap = page.locator('[data-draft-section="recaps"]');
  if (await recap.count()) {
    await recap.click();
    await noHorizontalOverflow("draft recaps");
    const historicalPick = page.locator(".draft-pick").first();
    if (await historicalPick.count()) {
      const details = await historicalPick.innerText();
      assert.match(details, /NFL drafted by:/, "draft recap should show NFL draft team context");
      assert.match(details, /College PPG:/, "draft recap should show college PPG or an explicit unavailable value");
      assert.match(details, /NFL Avg PPG:/, "draft recap should show NFL PPG or an explicit unavailable value");
    }
  }
  const future = page.locator('[data-draft-section="future"]');
  if (await future.count()) {
    await future.click();
    await noHorizontalOverflow("future draft");
    const researchLinks = page.locator('#content a[href*="dynastydatabase.com/classes/"]');
    for (let i = 0; i < await researchLinks.count(); i++) {
      assert.equal(await researchLinks.nth(i).getAttribute("href"), "https://dynastydatabase.com/classes/" + expectedFutureYear, "future draft research should link only to the next available class");
    }
  }

  await openTab("team", "Starters");
  const pickOwnershipScenario = await page.evaluate(selectedId => {
    const current = Math.max(Number(state.league?.season) || 0, new Date().getFullYear());
    const original = state.rosters.find(r => String(r.roster_id) === selectedId);
    const owner = state.rosters.find(r => String(r.roster_id) !== selectedId);
    if (!original || !owner) return null;
    const ownerId = String(owner.roster_id), originalId = String(original.roster_id);
    const ownerName = [...document.querySelectorAll("#team option")].find(o => o.value === ownerId)?.textContent.trim();
    const originalName = [...document.querySelectorAll("#team option")].find(o => o.value === originalId)?.textContent.trim();
    if (!ownerName || !originalName) return null;
    const savedTradedPicks = state.tradedPicks;
    const season = current + 1, round = 1;
    state.tradedPicks = [...(savedTradedPicks || []), { season: String(season), round, roster_id: Number(original.roster_id), owner_id: Number(owner.roster_id), previous_owner_id: Number(original.roster_id) }];
    render();
    return { ownerId, originalId, ownerName, originalName, season, round, savedTradedPicks };
  }, originalTeamId);
  if (pickOwnershipScenario) {
    await teamSelect.selectOption(pickOwnershipScenario.ownerId);
    await page.waitForFunction(({ id, name }) => document.querySelector("#team")?.value === id && document.querySelector(".team-identity-copy strong")?.textContent.trim() === name, { id: pickOwnershipScenario.ownerId, name: pickOwnershipScenario.ownerName }, { timeout: 10000 });
    const ownedPickTexts = await page.locator("#content .future-picks").allInnerTexts();
    assert.ok(ownedPickTexts.some(value => value.includes("Round " + pickOwnershipScenario.round) && value.includes("via " + pickOwnershipScenario.originalName)),
      "a traded future pick should appear under its current owner and identify its original team");
    await teamSelect.selectOption(pickOwnershipScenario.originalId);
    await page.waitForFunction(id => document.querySelector("#team")?.value === id && document.querySelector(".team-identity-copy strong"), pickOwnershipScenario.originalId, { timeout: 10000 });
    const originalPickTexts = await page.locator("#content .future-picks").allInnerTexts();
    assert.ok(!originalPickTexts.some(value => value.includes("via " + pickOwnershipScenario.originalName)),
      "the original team should not retain a traded-away pick");
    await page.evaluate(saved => { state.tradedPicks = saved; render(); }, pickOwnershipScenario.savedTradedPicks);
    await page.waitForFunction(id => document.querySelector("#team")?.value === id && document.querySelector(".team-identity-copy strong"), originalTeamId, { timeout: 10000 });
  }
  const ppgRankScenario = await page.evaluate(() => {
    const button = document.querySelector("#content [data-player][data-panel=\"projections\"]");
    const id = button?.dataset.player;
    if (!id) return null;
    const savedPPG = state.weeklyPPG, savedMarket = state.marketPlayers;
    state.weeklyPPG = { ...state.weeklyPPG };
    Object.keys(state.players).forEach(playerId => { state.weeklyPPG[playerId] = 0; });
    state.weeklyPPG[id] = 100;
    state.marketPlayers = { ...state.marketPlayers, [id]: { ...(state.marketPlayers[id] || {}), rank: { sf_dynasty: 9999 } } };
    return { savedPPG, savedMarket };
  });
  const playerButton = page.locator('#content [data-player][data-panel="projections"]').first();
  if (await playerButton.count()) {
    await playerButton.click();
    await page.locator(".player-modal").waitFor({ state: "visible", timeout: 10000 });
    await page.getByText("Fantasy PPG rank:", { exact: true }).waitFor({ state: "visible" });
    await page.getByText("Sleeper:", { exact: true }).waitFor({ state: "visible" });
    const summaryLines = await page.locator(".player-summary-line").allInnerTexts();
    assert.match(summaryLines[0] || "", /Fantasy PPG rank:.*Overall/, "player details should label position and overall fantasy PPG ranks clearly");
    assert.match(summaryLines[0] || "", /#1.*Overall #1/, "the displayed ranks should follow season PPG even when the dynasty market rank conflicts");
    assert.match(summaryLines[1] || "", /Sleeper:.*rostered.*started/, "player details should show rostered and started percentages on one concise line");
    assert.equal(summaryLines.length, 3, "player details should keep the summary to rank, Sleeper usage, and weekly PPG lines");
    assert.equal(await page.locator(".player-summary-note, .player-summary-details").count(), 0, "player details should omit extra ranking/projection explanations");
    assert.match(summaryLines[2] || "", /Week \d+: Projection .* · Actual .* · Season avg .* PPG/, "player details should show the concise weekly projection, actual, and season PPG line");
    assert.equal(await page.getByRole("heading", { name: "Game-by-game stats, projection & actual" }).count(), 1, "player details should show the game-by-game stats heading");
    await page.locator(".player-modal-close").click();
    await page.locator(".player-modal").waitFor({ state: "detached" });
    if (ppgRankScenario) await page.evaluate(saved => { state.weeklyPPG = saved.savedPPG; state.marketPlayers = saved.savedMarket; render(); }, ppgRankScenario);
    await playerButton.click();
    await page.locator(".player-modal").waitFor({ state: "visible", timeout: 10000 });
    await page.keyboard.press("Escape");
    await page.locator(".player-modal").waitFor({ state: "detached" });
    await playerButton.click();
    await page.locator(".player-modal").waitFor({ state: "visible", timeout: 10000 });
    await page.locator(".player-modal-backdrop").click({ position: { x: 3, y: 3 } });
    await page.locator(".player-modal").waitFor({ state: "detached" });
  }
  for (const kind of ["standings", "maxpf", "dynasty"]) {
    const ranking = page.locator("#content [data-ranking=\"" + kind + "\"]").first();
    if (await ranking.count()) {
      await ranking.click();
      await page.locator(".player-modal").waitFor({ state: "visible", timeout: 10000 });
      assert.ok((await page.locator(".player-modal").innerText()).trim().length > 10, kind + " detail modal should contain useful content");
      await page.locator(".player-modal-close").click();
      await page.locator(".player-modal").waitFor({ state: "detached" });
    }
  }
  await page.locator("#refresh").click();
  await page.waitForFunction(() => /teams · refreshed/i.test(document.querySelector("#status")?.textContent || ""), null, { timeout: 120000 });
  await page.setViewportSize({ width: 320, height: 740 });
  for (const [tab, label] of [["team","Starters"],["matchup","Starters"],["waivers","Waiver Wire"],["trades","Trade"],["draft","Future Draft"]]) await openTab(tab, label);
  await page.setViewportSize({ width: 768, height: 1024 });
  for (const [tab, label] of [["team","Starters"],["matchup","Starters"],["waivers","Waiver Wire"],["trades","Trade"],["draft","Future Draft"]]) await openTab(tab, label);
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const [tab, label] of [["team","Starters"],["matchup","Starters"],["waivers","Waiver Wire"],["trades","Trade"],["draft","Future Draft"]]) await openTab(tab, label);
  await auditPage("desktop final state");
  assert.deepEqual(pageErrors, [], "browser errors detected: " + pageErrors.join(" | "));
  console.log("PASS: app load, five tabs at mobile and desktop widths, matchup score stacking/week navigation/bench expansion, waiver filters/search, trade view, draft tabs, ranking modal/Escape, refresh, and overflow checks.");
} catch (error) {
  console.error("SMOKE FAILURE:", error?.message || error);
  console.error("STATUS:", await page.locator("#status").innerText().catch(() => "(unavailable)"));
  console.error("CONTENT:", (await page.locator("#content").innerText().catch(() => "(unavailable)")).slice(0, 1000));
  console.error("BROWSER ERRORS:", pageErrors.join(" | ") || "(none captured)");
  throw error;
} finally {
  await browser.close();
}
