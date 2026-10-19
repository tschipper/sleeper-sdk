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
async function openTab(tab, expectedText) {
  await page.locator('nav [data-tab="' + tab + '"]').click();
  await page.locator("#content").getByText(expectedText, { exact: false }).first().waitFor({ state: "visible", timeout: 15000 });
  await noHorizontalOverflow(tab);
}

try {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.locator("#status").waitFor();
  await page.waitForFunction(() => document.querySelectorAll("#team option").length > 1 && (document.querySelector("#content")?.textContent || "").trim().length > 20, null, { timeout: 120000 });
  assert.ok(await page.locator("#team option").count() > 1, "team selector should populate");
  assert.ok((await page.locator("#content").innerText()).trim().length > 20, "initial team page should render");
  await noHorizontalOverflow("My Team");

  await openTab("matchup", "Starters");
  const score = page.locator(".matchup-team-header .matchup-score").first();
  if (await score.count()) {
    const actual = await score.locator("strong").boundingBox();
    const projection = await score.locator("span").boundingBox();
    assert.ok(actual && projection, "actual and projected scores should both render");
    assert.ok(projection.y > actual.y && Math.abs((projection.x + projection.width / 2) - (actual.x + actual.width / 2)) < 4,
      "projected score should be directly underneath actual score");
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
  const mode = page.locator("[data-waiver-mode]").last();
  if (await mode.count()) { await mode.click(); await noHorizontalOverflow("waiver mode change"); }
  const search = page.locator("#waiver-search");
  if (await search.count()) { await search.fill("xyz-no-match-test"); await noHorizontalOverflow("waiver search"); await search.fill(""); }

  await openTab("trades", "Trade");
  for (const selector of ["#mt-add-give", "#mt-add-get", "#trade-view"]) {
    const control = page.locator(selector);
    if (await control.count()) await control.selectOption({ index: Math.min(1, (await control.locator("option").count()) - 1) }).catch(() => {});
  }
  await noHorizontalOverflow("trade analyzer");

  await openTab("draft", "Future Draft");
  const recap = page.locator('[data-draft-section="recaps"]');
  if (await recap.count()) { await recap.click(); await noHorizontalOverflow("draft recaps"); }
  const future = page.locator('[data-draft-section="future"]');
  if (await future.count()) { await future.click(); await noHorizontalOverflow("future draft"); }

  await openTab("team", "Starters");
  const ranking = page.locator("#content [data-ranking]").first();
  if (await ranking.count()) {
    await ranking.click();
    await page.locator(".player-modal").waitFor({ state: "visible", timeout: 10000 });
    await page.locator(".player-modal-close").click();
    await page.locator(".player-modal").waitFor({ state: "detached" });
  }
  await page.locator("#refresh").click();
  await page.waitForFunction(() => /loaded/i.test(document.querySelector("#status")?.textContent || "") && !/loading league/i.test(document.querySelector("#status")?.textContent || ""), null, { timeout: 120000 });
  assert.deepEqual(pageErrors, [], "browser errors detected: " + pageErrors.join(" | "));
  console.log("PASS: app load, five tabs, matchup score stacking/week navigation/bench expansion, waiver filters/search, trade view, draft tabs, ranking modal, refresh, mobile overflow.");
} finally {
  await browser.close();
}
