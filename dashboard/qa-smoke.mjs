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
    unlabeledFields: [...document.querySelectorAll("input,select,textarea")].filter(el => el.getClientRects().length && !el.disabled && !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby") && !el.getAttribute("title") && !el.placeholder && !(el.labels && [...el.labels].length) && !el.closest("label")).map(el => el.outerHTML.slice(0, 140))
  }));
  assert.deepEqual(audit.duplicateIds, [], label + ": duplicate HTML IDs found");
  assert.deepEqual(audit.unnamedButtons, [], label + ": visible buttons need accessible names");
  assert.deepEqual(audit.unlabeledFields, [], label + ": visible form controls need accessible labels");
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
  await page.locator(".team-identity-card").waitFor({ state: "visible", timeout: 30000 });
  await page.waitForFunction(() => /teams · refreshed/i.test(document.querySelector("#status")?.textContent || ""), null, { timeout: 120000 });
  await page.getByText("Recent league activity", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  assert.equal(await page.locator(".team-identity-card").count(), 1, "roster page should show exactly one consistent team identity card");
  assert.ok(await page.locator(".team-avatar").count() === 1, "roster page should show team avatar or fallback");
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
  for (const selector of ["#mt-add-give", "#mt-add-get", "#trade-view"]) {
    const control = page.locator(selector);
    if (await control.count()) await control.selectOption({ index: Math.min(1, (await control.locator("option").count()) - 1) }).catch(() => {});
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
  if (await future.count()) { await future.click(); await noHorizontalOverflow("future draft"); }

  await openTab("team", "Starters");
  const playerButton = page.locator("#content .player-name-open").first();
  if (await playerButton.count()) {
    await playerButton.click();
    await page.locator(".player-modal").waitFor({ state: "visible", timeout: 10000 });
    await page.getByText("Rostered in your league", { exact: true }).waitFor({ state: "visible" });
    await page.getByText("Started in your league", { exact: true }).waitFor({ state: "visible" });
    await page.locator(".player-modal-close").click();
    await page.locator(".player-modal").waitFor({ state: "detached" });
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
} finally {
  await browser.close();
}
