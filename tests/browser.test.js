const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require("playwright");

const executablePath = process.env.BETTERNEM_BROWSER ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

async function setup(page, shouldFail = false) {
  await page.setContent(`<!doctype html><html><head></head><body>
    <main id="comments" data-testid="tid_scroll_container">
      <div id="hot" data-testid="tid_comment_card">blocked hot comment</div>
      <div id="normal" data-testid="tid_comment_card">normal comment</div>
      <div id="with-reply" data-testid="tid_comment_card">normal parent
        <div class="replay"><span id="blocked-reply">blocked reply</span><span id="normal-reply">normal reply</span></div>
      </div>
    </main><aside><div id="song-comment" data-testid="tid_comment_card">song comment</div></aside></body></html>`);
  await page.evaluate((fail) => {
    const attach = (id, userId, replies = []) => {
      const card = document.getElementById(id);
      card["__reactFiber$fixture"] = { memoizedProps: {}, return: {
        memoizedProps: { comment: { user: { id: userId }, beReplied: replies.map((id) => ({ user: { id } })) } },
        return: null
      } };
    };
    attach("hot", 42);
    attach("normal", 7);
    attach("with-reply", 7, [42, 7]);
    attach("song-comment", 42);
    let uid = 123;
    let accountListener;
    window.testSetAccount = (id) => { uid = id; accountListener?.(); };
    let blockedIds = [42];
    window.testSetBlacklist = (ids) => { blockedIds = ids; };
    window.testSetFailure = (value) => { fail = value; };
    let route = "/album/1";
    let routeListener = null;
    window.testSetRoute = (pathname) => { route = pathname; routeListener?.(); };
    const store = { getStore: () => ({ host: { uid, isAnonymous: false } }),
      app: { _store: { subscribe: (fn) => { accountListener = fn; return () => { accountListener = null; }; } } },
      getHistory: () => ({ location: { pathname: route }, listen: (fn) => { routeListener = fn; return () => { routeListener = null; }; } }) };
    const modules = { 8: { a: store }, 15: { K: async () => {
      if (fail) throw fail === true ? new Error("测试请求失败") : fail;
      return blockedIds.map((id) => ({ id }));
    } } };
    window.webpackJsonp = { push(args) {
      args[1][args[2][0][0]]({}, {}, (id) => modules[id]);
    } };
    window.betterncm = { ncm: { getNCMVersion: () => "3.1.41", getNCMBuild: () => 205529,
      getNCMPackageVersion: () => "83304b1" } };
  }, shouldFail);
  // BetterNCM supplies `plugin` as a function argument, not window.plugin.
  await page.evaluate(async (script) => {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    await new AsyncFunction("plugin", script)({ onLoad: (fn) => fn() });
  }, fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8"));
  assert.equal(await page.evaluate(() => !!window.BetterNEMCommentFilter), true,
    "BetterNCM's local plugin argument must start the filter");
}

test("hot comments, replies, dynamic load, toggle and unload", async () => {
  const browser = await chromium.launch({ executablePath, headless: true,
    args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await setup(page);
    await page.waitForFunction(() => window.BetterNEMCommentFilter.getState().state === "ready");
    let snapshot = await page.evaluate(() => ({
      hot: getComputedStyle(document.getElementById("hot")).display,
      normal: getComputedStyle(document.getElementById("normal")).display,
      reply: getComputedStyle(document.getElementById("blocked-reply")).display,
      normalReply: getComputedStyle(document.getElementById("normal-reply")).display,
      count: document.querySelector(".bnem-count").textContent
    }));
    assert.equal(snapshot.hot, "none");
    assert.notEqual(snapshot.normal, "none");
    assert.equal(snapshot.reply, "none");
    assert.notEqual(snapshot.normalReply, "none");
    assert.match(snapshot.count, /2 条/);
    assert.notEqual(await page.locator("#song-comment").evaluate((el) => getComputedStyle(el).display), "none");

    // React can reuse a card and update only a text node.
    await page.evaluate(() => {
      const card = document.getElementById("hot");
      card["__reactFiber$fixture"].return.memoizedProps.comment.user.id = 7;
      card.firstChild.nodeValue = "reused normal comment";
      const parent = document.getElementById("with-reply");
      parent["__reactFiber$fixture"].return.memoizedProps.comment.beReplied[0].user.id = 7;
      document.getElementById("blocked-reply").firstChild.nodeValue = "reused normal reply";
    });
    await page.waitForFunction(() => !document.getElementById("hot").classList.contains("bnem-comment-hidden"));
    assert.notEqual(await page.locator("#blocked-reply").evaluate((el) => getComputedStyle(el).display), "none");
    await page.evaluate(() => {
      const card = document.getElementById("hot");
      card["__reactFiber$fixture"].return.memoizedProps.comment.user.id = 42;
      card.firstChild.nodeValue = "blocked hot comment";
      const parent = document.getElementById("with-reply");
      parent["__reactFiber$fixture"].return.memoizedProps.comment.beReplied[0].user.id = 42;
      document.getElementById("blocked-reply").firstChild.nodeValue = "blocked reply";
    });
    await page.waitForFunction(() => document.getElementById("hot").classList.contains("bnem-comment-hidden"));

    await page.evaluate(() => {
      const card = document.createElement("div");
      card.id = "loaded";
      card.setAttribute("data-testid", "tid_comment_card");
      card.textContent = "loaded comment";
      card["__reactFiber$fixture"] = { memoizedProps: { comment: {
        user: { id: 42 }, beReplied: []
      } }, return: null };
      document.getElementById("comments").append(card);
    });
    await page.waitForFunction(() => document.getElementById("loaded").classList.contains("bnem-comment-hidden"));
    assert.match(await page.locator(".bnem-count").textContent(), /3 条/);

    await page.evaluate(() => {
      const card = document.createElement("div");
      card.id = "loaded-normal";
      card.setAttribute("data-testid", "tid_comment_card");
      card.textContent = "normal loaded comment";
      card["__reactFiber$fixture"] = { memoizedProps: { comment: {
        user: { id: 9 }, beReplied: []
      } }, return: null };
      document.getElementById("comments").append(card);
    });
    assert.notEqual(await page.locator("#loaded-normal").evaluate((el) => getComputedStyle(el).display), "none");

    await page.evaluate(() => window.testSetBlacklist([7]));
    await page.locator("#bnem-comment-filter-panel button").click();
    await page.waitForFunction(() => window.BetterNEMCommentFilter.getState().state === "ready");
    assert.notEqual(await page.locator("#hot").evaluate((el) => getComputedStyle(el).display), "none");
    assert.equal(await page.locator("#normal").evaluate((el) => getComputedStyle(el).display), "none");
    await page.evaluate(() => window.testSetBlacklist([42]));
    await page.locator("#bnem-comment-filter-panel button").click();
    await page.waitForFunction(() => window.BetterNEMCommentFilter.getState().state === "ready");

    await page.locator("#bnem-comment-filter-panel input").uncheck();
    assert.notEqual(await page.locator("#hot").evaluate((el) => getComputedStyle(el).display), "none");
    assert.notEqual(await page.locator("#blocked-reply").evaluate((el) => getComputedStyle(el).display), "none");
    assert.match(await page.locator(".bnem-count").textContent(), /0 条/);
    await page.locator("#bnem-comment-filter-panel input").check();
    assert.equal(await page.locator("#hot").evaluate((el) => getComputedStyle(el).display), "none");

    await page.evaluate(() => window.testSetRoute("/song/1"));
    assert.notEqual(await page.locator("#hot").evaluate((el) => getComputedStyle(el).display), "none");
    await page.evaluate(() => window.testSetRoute("/album/1"));
    assert.equal(await page.locator("#hot").evaluate((el) => getComputedStyle(el).display), "none");

    await page.evaluate(() => window.testSetAccount(null));
    await page.waitForFunction(() => window.BetterNEMCommentFilter.getState().state === "error");
    assert.notEqual(await page.locator("#hot").evaluate((el) => getComputedStyle(el).display), "none");
    await page.evaluate(() => window.testSetAccount(456));
    await page.waitForFunction(() => window.BetterNEMCommentFilter.getState().state === "ready");
    assert.equal(await page.locator("#hot").evaluate((el) => getComputedStyle(el).display), "none");

    await page.evaluate(() => window.testSetFailure({ name: "fetchStatusError", status: 503 }));
    await page.locator("#bnem-comment-filter-panel button").click();
    await page.waitForFunction(() => window.BetterNEMCommentFilter.getState().state === "error");
    assert.match(await page.locator(".bnem-status").textContent(), /503/);
    assert.notEqual(await page.locator("#hot").evaluate((el) => getComputedStyle(el).display), "none");
    assert.equal(await page.locator("html").evaluate((el) => el.classList.contains("bnem-comment-pending")), false);
    await page.evaluate(() => { window.testSetFailure(false); window.testSetBlacklist([]); });
    await page.locator("#bnem-comment-filter-panel button").click();
    await page.waitForFunction(() => window.BetterNEMCommentFilter.getState().state === "ready");
    assert.match(await page.locator(".bnem-status").textContent(), /0 位/);

    await page.evaluate(() => window.BetterNEMCommentFilter.destroy());
    assert.notEqual(await page.locator("#hot").evaluate((el) => getComputedStyle(el).display), "none");
    assert.equal(await page.locator("#bnem-comment-filter-style").count(), 0);
    assert.equal(await page.locator("#bnem-comment-filter-panel").count(), 0);
    await page.close();
  } finally { await browser.close(); }
});

test("blacklist request failure is explicit and restores comments", async () => {
  const browser = await chromium.launch({ executablePath, headless: true,
    args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await setup(page, true);
    await page.waitForFunction(() => window.BetterNEMCommentFilter.getState().state === "error");
    assert.match(await page.locator(".bnem-status").textContent(), /测试请求失败/);
    assert.notEqual(await page.locator("#hot").evaluate((el) => getComputedStyle(el).display), "none");
    await page.close();
  } finally { await browser.close(); }
});
