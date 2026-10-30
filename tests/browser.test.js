const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require("playwright");

const executablePath = process.env.NCM_COMMENT_FILTER_BROWSER ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

async function setup(page, shouldFail = false) {
  await page.setContent(`<!doctype html><html><head></head><body>
    <main id="comments" data-testid="tid_scroll_container">
      <div id="hot" data-testid="tid_comment_card">blocked hot comment</div>
      <div id="normal" data-testid="tid_comment_card">normal comment</div>
      <div id="with-reply" data-testid="tid_comment_card">normal parent
        <div class="replay"><span id="blocked-reply">blocked reply</span><span id="normal-reply">normal reply</span></div>
      </div>
    </main><aside data-testid="tid_vinyl_commentarea" style="display:none"><div id="song-comment" data-testid="tid_comment_card">song comment</div></aside></body></html>`);
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
    window.testSetRoute = (pathname) => {
      route = pathname;
      document.querySelector('aside').style.display = pathname === '/' ? '' : 'none';
      routeListener?.();
    };
    window.testSetVinylVisible = (visible) => {
      document.querySelector('aside').style.display = visible ? '' : 'none';
      accountListener?.();
    };
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
    window.betterncm = { ncm: { getNCMVersion: () => "3.1.42", getNCMBuild: () => 205594,
      getNCMPackageVersion: () => "14827e8" } };
  }, shouldFail);
  // BetterNCM supplies `plugin` as a function argument, not window.plugin.
  await page.evaluate(async (script) => {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    await new AsyncFunction("plugin", script)({ onLoad: (fn) => fn() });
  }, fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8"));
  assert.equal(await page.evaluate(() => !!window.NCMCommentFilter), true,
    "BetterNCM's local plugin argument must start the filter");
}

test("hot comments, replies, dynamic load, toggle and unload", async () => {
  const browser = await chromium.launch({ executablePath, headless: true,
    args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await setup(page);
    await page.waitForFunction(() => window.NCMCommentFilter.getState().state === "ready");
    let snapshot = await page.evaluate(() => ({
      hot: getComputedStyle(document.getElementById("hot")).display,
      normal: getComputedStyle(document.getElementById("normal")).display,
      reply: getComputedStyle(document.getElementById("blocked-reply")).display,
      normalReply: getComputedStyle(document.getElementById("normal-reply")).display,
      count: document.querySelector(".ncmcf-count").textContent
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
    await page.waitForFunction(() => !document.getElementById("hot").classList.contains("ncmcf-comment-hidden"));
    assert.notEqual(await page.locator("#blocked-reply").evaluate((el) => getComputedStyle(el).display), "none");
    await page.evaluate(() => {
      const card = document.getElementById("hot");
      card["__reactFiber$fixture"].return.memoizedProps.comment.user.id = 42;
      card.firstChild.nodeValue = "blocked hot comment";
      const parent = document.getElementById("with-reply");
      parent["__reactFiber$fixture"].return.memoizedProps.comment.beReplied[0].user.id = 42;
      document.getElementById("blocked-reply").firstChild.nodeValue = "blocked reply";
    });
    await page.waitForFunction(() => document.getElementById("hot").classList.contains("ncmcf-comment-hidden"));

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
    await page.waitForFunction(() => document.getElementById("loaded").classList.contains("ncmcf-comment-hidden"));
    assert.match(await page.locator(".ncmcf-count").textContent(), /3 条/);

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
    await page.getByRole("button", { name: "刷新黑名单" }).click();
    await page.waitForFunction(() => window.NCMCommentFilter.getState().state === "ready");
    assert.notEqual(await page.locator("#hot").evaluate((el) => getComputedStyle(el).display), "none");
    assert.equal(await page.locator("#normal").evaluate((el) => getComputedStyle(el).display), "none");
    await page.evaluate(() => window.testSetBlacklist([42]));
    await page.getByRole("button", { name: "刷新黑名单" }).click();
    await page.waitForFunction(() => window.NCMCommentFilter.getState().state === "ready");

    await page.locator("#ncmcf-comment-filter-panel input").uncheck();
    assert.notEqual(await page.locator("#hot").evaluate((el) => getComputedStyle(el).display), "none");
    assert.notEqual(await page.locator("#blocked-reply").evaluate((el) => getComputedStyle(el).display), "none");
    assert.match(await page.locator(".ncmcf-count").textContent(), /0 条/);
    await page.locator("#ncmcf-comment-filter-panel input").check();
    assert.equal(await page.locator("#hot").evaluate((el) => getComputedStyle(el).display), "none");

    await page.evaluate(() => window.testSetRoute("/"));
    assert.equal(await page.locator("#song-comment").evaluate((el) => getComputedStyle(el).display), "none");
    await page.evaluate(() => window.testSetRoute("/search"));
    await page.waitForFunction(() => getComputedStyle(document.getElementById("song-comment")).display !== "none");
    assert.notEqual(await page.locator("#hot").evaluate((el) => getComputedStyle(el).display), "none");
    await page.evaluate(() => window.testSetRoute("/album/1"));
    assert.equal(await page.locator("#hot").evaluate((el) => getComputedStyle(el).display), "none");
    assert.notEqual(await page.locator("#song-comment").evaluate((el) => getComputedStyle(el).display), "none");
    await page.evaluate(() => window.testSetVinylVisible(true));
    await page.waitForFunction(() => getComputedStyle(document.getElementById("song-comment")).display === "none");
    await page.evaluate(() => window.testSetVinylVisible(false));
    await page.waitForFunction(() => getComputedStyle(document.getElementById("song-comment")).display !== "none");

    await page.evaluate(() => window.testSetAccount(null));
    await page.waitForFunction(() => window.NCMCommentFilter.getState().state === "error");
    assert.notEqual(await page.locator("#hot").evaluate((el) => getComputedStyle(el).display), "none");
    await page.evaluate(() => window.testSetAccount(456));
    await page.waitForFunction(() => window.NCMCommentFilter.getState().state === "ready");
    assert.equal(await page.locator("#hot").evaluate((el) => getComputedStyle(el).display), "none");

    await page.evaluate(() => window.testSetFailure({ name: "fetchStatusError", status: 503 }));
    await page.getByRole("button", { name: "刷新黑名单" }).click();
    await page.waitForFunction(() => window.NCMCommentFilter.getState().state === "error");
    assert.match(await page.locator(".ncmcf-status").textContent(), /503/);
    assert.notEqual(await page.locator("#hot").evaluate((el) => getComputedStyle(el).display), "none");
    assert.equal(await page.locator("html").evaluate((el) => el.classList.contains("ncmcf-comment-pending")), false);
    await page.evaluate(() => { window.testSetFailure(false); window.testSetBlacklist([]); });
    await page.getByRole("button", { name: "刷新黑名单" }).click();
    await page.waitForFunction(() => window.NCMCommentFilter.getState().state === "ready");
    assert.match(await page.locator(".ncmcf-status").textContent(), /0 位/);

    await page.evaluate(() => window.NCMCommentFilter.destroy());
    assert.notEqual(await page.locator("#hot").evaluate((el) => getComputedStyle(el).display), "none");
    assert.equal(await page.locator("#ncmcf-comment-filter-style").count(), 0);
    assert.equal(await page.locator("#ncmcf-comment-filter-panel").count(), 0);
    await page.close();
  } finally { await browser.close(); }
});

test("panel collapses to a movable plus button and stays within the viewport", async () => {
  const browser = await chromium.launch({ executablePath, headless: true,
    args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await setup(page);
    const panel = page.locator("#ncmcf-comment-filter-panel");
    await page.getByRole("button", { name: "最小化" }).click();
    assert.equal(await panel.locator(".ncmcf-row").isVisible(), false);
    const plus = page.getByRole("button", { name: "展开" });
    assert.equal(await plus.textContent(), "+");
    const small = await panel.boundingBox();
    assert.ok(small.width <= 40 && small.height <= 40);

    await page.mouse.move(small.x + small.width / 2, small.y + small.height / 2);
    await page.mouse.down();
    await page.mouse.move(10, 10, { steps: 5 });
    await page.mouse.up();
    const moved = await panel.boundingBox();
    assert.ok(moved.x >= 0 && moved.x < 20 && moved.y >= 0 && moved.y < 20);
    assert.equal(await panel.locator(".ncmcf-row").isVisible(), false);
    await plus.click();
    assert.equal(await panel.locator(".ncmcf-row").isVisible(), true);
    assert.ok((await panel.boundingBox()).x >= 0);

    const title = panel.locator(".ncmcf-title");
    const handle = await title.boundingBox();
    await page.mouse.move(handle.x + 20, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(1000, 1000, { steps: 5 });
    await page.mouse.up();
    const final = await panel.boundingBox();
    assert.ok(final.x + final.width <= 800 && final.y + final.height <= 600);
    assert.equal(await panel.locator(".ncmcf-row").isVisible(), true);
  } finally { await browser.close(); }
});

test("renaming keeps the existing filter preference and saves future changes under the new name", async () => {
  const browser = await chromium.launch({ executablePath, headless: true,
    args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.route("https://ncm-comment-filter.test/**", (route) => route.fulfill({
      contentType: "text/html", body: "<!doctype html><body></body>"
    }));
    await page.goto("https://ncm-comment-filter.test/");
    await page.evaluate(() => localStorage.setItem("betternem.commentFilter.enabled", "0"));
    await setup(page);
    assert.equal(await page.evaluate(() => window.NCMCommentFilter.getState().enabled), false);
    await page.locator("#ncmcf-comment-filter-panel input").check();
    assert.equal(await page.evaluate(() => localStorage.getItem("ncmCommentFilter.enabled")), "1");
    await page.evaluate(() => {
      window.NCMCommentFilter.destroy();
      window.NCMCommentFilter = window.NCMCommentFilterApi.createController(window);
      window.NCMCommentFilter.start();
    });
    assert.equal(await page.evaluate(() => window.NCMCommentFilter.getState().enabled), true);
  } finally { await browser.close(); }
});

test("hidden virtualized comments release their cached row height", async () => {
  const browser = await chromium.launch({ executablePath, headless: true,
    args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await setup(page);
    await page.waitForFunction(() => window.NCMCommentFilter.getState().state === "ready");
    await page.locator("#ncmcf-comment-filter-panel input").uncheck();
    await page.evaluate(() => {
      const list = document.getElementById("comments");
      const hot = document.getElementById("hot");
      const normal = document.getElementById("normal");
      list.style.position = "relative";
      list.style.height = "160px";
      hot.style.height = normal.style.height = "80px";
      const hotRow = document.createElement("div");
      const normalRow = document.createElement("div");
      hotRow.style.cssText = "position:absolute;top:0;height:80px;width:100%";
      normalRow.style.cssText = "position:absolute;top:80px;height:80px;width:100%";
      hot.before(hotRow);
      hotRow.append(hot);
      normal.before(normalRow);
      normalRow.append(normal);
      const owner = hot["__reactFiber$fixture"].return;
      const cache = { height: 80, clear() { this.height = 80; } };
      const parent = { recomputeGridSize() {
        hotRow.style.height = `${cache.height}px`;
        normalRow.style.top = `${cache.height}px`;
        list.style.height = `${cache.height + normal.offsetHeight}px`;
      } };
      owner.return = { memoizedProps: { cache, rowIndex: 0, columnIndex: 0, parent },
        stateNode: { _measure() {
          cache.height = hot.offsetHeight;
          parent.recomputeGridSize();
        } }, return: null };
    });
    await page.locator("#ncmcf-comment-filter-panel input").check();
    await page.waitForFunction(() => document.getElementById("normal").parentElement.offsetTop === 0);
    assert.equal(await page.locator("#comments").evaluate((el) => el.offsetHeight), 80);
    await page.locator("#ncmcf-comment-filter-panel input").uncheck();
    await page.waitForFunction(() => document.getElementById("normal").parentElement.offsetTop === 80);
    assert.equal(await page.locator("#comments").evaluate((el) => el.offsetHeight), 160);
    await page.locator("#ncmcf-comment-filter-panel input").check();
    await page.waitForFunction(() => document.getElementById("normal").parentElement.offsetTop === 0);
    await page.evaluate(() => document.getElementById("hot").parentElement.remove());
    await page.locator("#ncmcf-comment-filter-panel input").uncheck();
    await page.waitForFunction(() => document.getElementById("normal").parentElement.offsetTop === 80);
    assert.equal(await page.locator("#comments").evaluate((el) => el.offsetHeight), 160);
  } finally { await browser.close(); }
});

test("song comment page filters its own cards on the client's real route", async () => {
  const browser = await chromium.launch({ executablePath, headless: true,
    args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await setup(page);
    await page.waitForFunction(() => window.NCMCommentFilter.getState().state === "ready");
    await page.evaluate(() => {
      const scroll = document.createElement("main");
      scroll.dataset.testid = "tid_scroll_container";
      scroll.innerHTML = `<section data-testid="tid_comment_page" id="page_pc_songplay_comment">
        <div id="song-blocked" data-testid="tid_comment_card">blocked song comment</div>
        <div id="song-normal" data-testid="tid_comment_card">normal song comment</div>
      </section>`;
      document.body.append(scroll);
      for (const [id, userId] of [["song-blocked", 42], ["song-normal", 7]]) {
        document.getElementById(id)["__reactFiber$fixture"] = { memoizedProps: {}, return: {
          memoizedProps: { comment: { user: { id: userId }, beReplied: [] } }, return: null
        } };
      }
      window.testSetRoute("/comment/R_SO_4_1");
    });
    await page.waitForFunction(() => getComputedStyle(document.getElementById("song-blocked")).display === "none");
    assert.notEqual(await page.locator("#song-normal").evaluate((el) => getComputedStyle(el).display), "none");
    assert.notEqual(await page.locator("#hot").evaluate((el) => getComputedStyle(el).display), "none");
    await page.evaluate(() => window.testSetRoute("/search"));
    await page.waitForFunction(() => getComputedStyle(document.getElementById("song-blocked")).display !== "none");
  } finally { await browser.close(); }
});

test("blacklist request failure is explicit and restores comments", async () => {
  const browser = await chromium.launch({ executablePath, headless: true,
    args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await setup(page, true);
    await page.waitForFunction(() => window.NCMCommentFilter.getState().state === "error");
    assert.match(await page.locator(".ncmcf-status").textContent(), /测试请求失败/);
    assert.notEqual(await page.locator("#hot").evaluate((el) => getComputedStyle(el).display), "none");
    await page.close();
  } finally { await browser.close(); }
});
