/* BetterNEM comment filter. No credentials or blacklist data are persisted or sent to third parties. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BetterNEM = api;
  // BetterNCM executes scripts with a local `plugin` argument.
  if (root && root.document && typeof plugin !== "undefined" && typeof plugin.onLoad === "function") {
    plugin.onLoad(() => {
      const controller = api.createController(root);
      controller.start();
      root.BetterNEMCommentFilter = controller;
    });
  }
})(typeof window === "undefined" ? null : window, function () {
  "use strict";

  const CARD_SELECTOR = '[data-testid="tid_comment_card"]';
  const ALBUM_CONTAINER = '[data-testid="tid_scroll_container"]';
  const SONG_CONTAINER = '[data-testid="tid_comment_page"]';
  const VINYL_CONTAINER = '[data-testid="tid_vinyl_commentarea"]';
  const HIDDEN_CLASS = "bnem-comment-hidden";
  const STYLE_ID = "bnem-comment-filter-style";
  const PANEL_ID = "bnem-comment-filter-panel";
  const ACCOUNT_CHECK_MS = 30000;
  const REQUEST_TIMEOUT_MS = 10000;

  function normalizeId(value) {
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value) || value <= 0) return null;
      return String(value);
    }
    if (typeof value !== "string" || !/^\d+$/.test(value.trim())) return null;
    const id = value.trim().replace(/^0+(?=\d)/, "");
    return id === "0" ? null : id;
  }

  function normalizeBlacklist(records) {
    if (!Array.isArray(records)) throw new Error("黑名单返回格式不是用户列表");
    const ids = new Set();
    for (const record of records) {
      const id = normalizeId(record && (record.id ?? record.userId ?? record.user?.id));
      if (!id) throw new Error("黑名单中存在无法读取的用户 ID");
      ids.add(id);
    }
    return ids;
  }

  function isAlbumPath(path) {
    return /^\/album\/\d+(?:\/|$)/.test(path || "");
  }

  function isCommentPath(path) {
    return isAlbumPath(path) || /^\/comment\/R_SO_4_\d+(?:\/\d+)?\/?$/.test(path || "");
  }

  function isCurrentFiber(fiber) {
    let node = fiber;
    for (let depth = 0; node && depth < 100; depth += 1) {
      const parent = node.return;
      if (!parent) return node.stateNode?.current === node;
      let sibling = parent.child;
      let found = false;
      for (let count = 0; sibling && count < 1000; count += 1, sibling = sibling.sibling) {
        if (sibling === node) { found = true; break; }
      }
      if (!found) return false;
      node = parent;
    }
    return false;
  }

  function readCommentFromFiber(card) {
    const key = Object.keys(card).find((name) =>
      name.startsWith("__reactFiber$") || name.startsWith("__reactInternalInstance$"));
    let fiber = key ? card[key] : null;
    for (let depth = 0; fiber && depth < 24; depth += 1, fiber = fiber.return) {
      const props = fiber.memoizedProps;
      const comment = props && props.comment;
      if (comment && normalizeId(comment.user?.id) && Array.isArray(comment.beReplied || [])) {
        const alternateComment = fiber.alternate?.memoizedProps?.comment;
        if (alternateComment && alternateComment !== comment) {
          if (isCurrentFiber(fiber.alternate)) {
            return normalizeId(alternateComment.user?.id) && Array.isArray(alternateComment.beReplied || [])
              ? alternateComment : null;
          }
          if (!isCurrentFiber(fiber)) return null;
        }
        return comment;
      }
    }
    return null;
  }

  function captureWebpackRequire(win) {
    const queue = win.webpackJsonp;
    if (!queue || typeof queue.push !== "function") throw new Error("网易云页面模块尚未就绪");
    const suffix = Math.floor(Math.random() * 100000000);
    const moduleId = 900000000 + suffix;
    const chunkId = 800000000 + suffix;
    let webpackRequire = null;
    queue.push([[chunkId], {
      [moduleId]: function (_module, _exports, require) { webpackRequire = require; }
    }, [[moduleId]]]);
    if (typeof webpackRequire !== "function") throw new Error("无法连接网易云页面模块");
    return webpackRequire;
  }

  function getClientVersion(win) {
    const ncm = win.betterncm?.ncm;
    const version = ncm?.getNCMVersion?.();
    const build = ncm?.getNCMBuild?.();
    return { version: String(version ?? ""), build: String(build ?? ""),
      packageVersion: String(ncm?.getNCMPackageVersion?.() ?? "") };
  }

  function createNeteaseSource(win) {
    const { version, build, packageVersion } = getClientVersion(win);
    const blacklistExports = {
      "3.1.41.205529": { c6406e5: "H", "83304b1": "K" },
      // APP_CONF uses this ID; the installed chunk filenames use 1482700000000.
      "3.1.42.205594": { "14827e8": "K" }
    }[`${version}.${build}`];
    if (!blacklistExports) {
      throw new Error(`客户端 ${version || "未知"} / ${build || "未知"} 未验证；请更新 BetterNEM 评论过滤`);
    }
    const blacklistExport = blacklistExports[packageVersion];
    if (!blacklistExport) throw new Error(`客户端热更新 ${packageVersion || "未知"} 未验证；请更新 BetterNEM`);
    const require = captureWebpackRequire(win);
    const store = require(8)?.a;
    const getBlacklist = require(15)?.[blacklistExport];
    if (typeof store?.getStore !== "function" || typeof getBlacklist !== "function") {
      throw new Error("网易云账号或黑名单接口不可用");
    }
    return {
      getAccountId() {
        const state = store.getStore();
        if (state?.host?.isAnonymous) return null;
        return normalizeId(state?.host?.uid);
      },
      getPath() {
        try { return store.getHistory?.()?.location?.pathname || ""; }
        catch { return ""; }
      },
      listen(listener) {
        try { return store.getHistory?.()?.listen?.(listener) || null; }
        catch { return null; }
      },
      watchAccount(listener) {
        return store.app?._store?.subscribe?.(listener) || null;
      },
      async readBlacklist(accountId) {
        // This is the client's own API wrapper for /api/blacklist/get.
        const records = await getBlacklist({ userid: accountId });
        return normalizeBlacklist(records);
      }
    };
  }

  function withTimeout(promise, ms, win) {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = win.setTimeout(() => reject(new Error("读取黑名单超时")), ms);
      })
    ]).finally(() => win.clearTimeout(timer));
  }

  function errorMessage(error) {
    if (error?.message) return error.message;
    const details = [error?.name, error?.status ? `HTTP ${error.status}` : null,
      error?.code != null ? `代码 ${error.code}` : null].filter(Boolean);
    return details.join("，") || "未知错误，请稍后刷新";
  }

  function createController(win, options = {}) {
    const doc = win.document;
    const sourceFactory = options.sourceFactory || createNeteaseSource;
    const getComment = options.getComment || readCommentFromFiber;
    let source = null;
    let observer = null;
    let accountTimer = null;
    let unlisten = null;
    let unwatchAccount = null;
    let panel = null;
    let statusElement = null;
    let countElement = null;
    let toggle = null;
    let refreshButton = null;
    let accountId = null;
    let blacklist = null;
    let enabled = true;
    let state = "idle";
    let stateMessage = "";
    let active = false;
    let generation = 0;
    let hidden = new Set();
    let unknownCards = 0;
    let scope = null;
    let measureFrame = null;
    const measureQueue = new Set();
    const collapsedRows = new Map();

    function currentPath() {
      const fromSource = source?.getPath?.();
      if (fromSource) return fromSource;
      const hash = win.location?.hash || "";
      const match = hash.match(/^#(\/[^?]*)/);
      return match ? match[1] : win.location?.pathname || "";
    }

    function currentScope() {
      const path = currentPath();
      const vinyl = doc.querySelector(VINYL_CONTAINER);
      let vinylVisible = false;
      if (vinyl && vinyl.getClientRects().length) {
        const rect = vinyl.getBoundingClientRect();
        vinylVisible = rect.bottom > 0 && rect.top < win.innerHeight;
      }
      const page = isAlbumPath(path) ? "album" : isCommentPath(path) ? "song" : "";
      return page ? `${page}${vinylVisible ? "+vinyl" : ""}` : vinylVisible ? "vinyl" : null;
    }

    function cardInScope(card) {
      if (card.closest(VINYL_CONTAINER)) return !!scope?.includes("vinyl");
      if (scope?.startsWith("song")) return !!card.closest(SONG_CONTAINER);
      return !!scope?.startsWith("album") && !!card.closest(ALBUM_CONTAINER) && !card.closest(SONG_CONTAINER);
    }

    function syncScope() {
      const next = currentScope();
      if (next === scope) return;
      restoreAll();
      scope = next;
      render();
      if (active) scanAll();
    }

    function flushMeasurements() {
      measureFrame = null;
      for (const card of measureQueue) {
        if (!card.isConnected) continue;
        const key = Object.keys(card).find((name) =>
          name.startsWith("__reactFiber$") || name.startsWith("__reactInternalInstance$"));
        let fiber = key ? card[key] : null;
        for (let depth = 0; fiber && depth < 32; depth += 1, fiber = fiber.return) {
          if (fiber.memoizedProps?.cache && typeof fiber.stateNode?._measure === "function") {
            const { cache, rowIndex = 0, columnIndex = 0, parent } = fiber.memoizedProps;
            const rowKey = `${rowIndex}:${columnIndex}`;
            if (card.classList.contains(HIDDEN_CLASS) || card.querySelector(`.${HIDDEN_CLASS}`)) {
              if (!collapsedRows.has(cache)) collapsedRows.set(cache, new Map());
              collapsedRows.get(cache).set(rowKey, { rowIndex, columnIndex, parent });
            } else {
              collapsedRows.get(cache)?.delete(rowKey);
            }
            fiber.stateNode._measure();
            break;
          }
        }
      }
      measureQueue.clear();
    }

    function queueMeasurement(card) {
      if (!card) return;
      measureQueue.add(card);
      if (measureFrame == null) measureFrame = win.requestAnimationFrame(flushMeasurements);
    }

    function setHidden(element, shouldHide) {
      if (!element) return false;
      const changed = element.classList.contains(HIDDEN_CLASS) !== shouldHide;
      element.classList.toggle(HIDDEN_CLASS, shouldHide);
      if (shouldHide) hidden.add(element);
      else hidden.delete(element);
      return changed;
    }

    function restoreAll() {
      for (const element of hidden) {
        element.classList.remove(HIDDEN_CLASS);
        queueMeasurement(element.matches(CARD_SELECTOR) ? element : element.closest(CARD_SELECTOR));
      }
      hidden.clear();
      const parents = new Map();
      for (const [cache, rows] of collapsedRows) {
        for (const { rowIndex, columnIndex, parent } of rows.values()) {
          cache.clear(rowIndex, columnIndex);
          if (parent && (!parents.has(parent) || rowIndex < parents.get(parent))) {
            parents.set(parent, rowIndex);
          }
        }
      }
      collapsedRows.clear();
      for (const [parent, rowIndex] of parents) parent.recomputeGridSize?.({ rowIndex, columnIndex: 0 });
      updateCount();
    }

    function updateCount() {
      for (const element of hidden) {
        if (!element.isConnected || !element.classList.contains(HIDDEN_CLASS)) hidden.delete(element);
      }
      if (countElement) countElement.textContent = `本页隐藏 ${active && enabled ? hidden.size : 0} 条评论`;
    }

    function setState(next, message) {
      state = next;
      stateMessage = message;
      render();
    }

    function render() {
      if (!panel) return;
      active = !!scope;
      panel.hidden = !active && state !== "error";
      toggle.checked = enabled;
      refreshButton.disabled = state === "loading" || !source;
      statusElement.textContent = stateMessage;
      statusElement.dataset.state = state;
      doc.documentElement.classList.toggle("bnem-comment-pending",
        active && enabled && state === "loading" && !blacklist);
      updateCount();
    }

    function filterCard(card) {
      if (!active || !enabled || !blacklist || !card.isConnected || !cardInScope(card)) return;
      let changed = false;
      const comment = getComment(card);
      if (!comment) {
        unknownCards += 1;
        changed = setHidden(card, false) || changed;
        if (changed) queueMeasurement(card);
        return;
      }
      const authorId = normalizeId(comment.user?.id);
      changed = setHidden(card, !!authorId && blacklist.has(authorId)) || changed;
      const replies = Array.isArray(comment.beReplied) ? comment.beReplied : [];
      const replyContainer = card.querySelector(".replay");
      // Clear marks on reply nodes that no longer belong to the current reply list.
      card.querySelectorAll(`.${HIDDEN_CLASS}`).forEach((element) => {
        if (element.parentElement !== replyContainer || replyContainer.children.length !== replies.length) {
          changed = setHidden(element, false) || changed;
        }
      });
      if (replyContainer && replyContainer.children.length === replies.length) {
        for (let index = 0; index < replies.length; index += 1) {
          const id = normalizeId(replies[index]?.user?.id);
          if (!id) unknownCards += 1;
          changed = setHidden(replyContainer.children[index], !!id && blacklist.has(id) && !blacklist.has(authorId)) || changed;
        }
      } else if (replies.length) {
        unknownCards += 1;
      }
      if (changed) queueMeasurement(card);
    }

    function scanAll() {
      if (!active || !enabled || !blacklist) return;
      unknownCards = 0;
      doc.querySelectorAll(`${ALBUM_CONTAINER} ${CARD_SELECTOR}, ${SONG_CONTAINER} ${CARD_SELECTOR}, ${VINYL_CONTAINER} ${CARD_SELECTOR}`).forEach(filterCard);
      if (unknownCards) setState("partial", `已同步；${unknownCards} 条评论或回复无法读取用户 ID`);
      else if (state === "partial") setState("ready", `已同步 ${blacklist.size} 位黑名单用户`);
      updateCount();
    }

    function collectCards(node, cards) {
      if (node.nodeType === 3) node = node.parentElement;
      if (!node) return;
      if (node.nodeType !== 1 || node === panel) return;
      if (node.matches?.(CARD_SELECTOR)) cards.add(node);
      node.querySelectorAll?.(CARD_SELECTOR).forEach((card) => cards.add(card));
      const parentCard = node.closest?.(CARD_SELECTOR);
      if (parentCard) cards.add(parentCard);
    }

    function onMutations(records) {
      syncScope();
      if (!active || !enabled || !blacklist) return;
      const cards = new Set();
      let removed = false;
      for (const record of records) {
        if (record.target === panel || panel?.contains(record.target)) continue;
        const parentCard = (record.target.nodeType === 1 ? record.target : record.target.parentElement)?.closest(CARD_SELECTOR);
        if (parentCard) cards.add(parentCard);
        for (const node of record.addedNodes) collectCards(node, cards);
        if (record.removedNodes.length) removed = true;
      }
      for (const card of cards) filterCard(card);
      if (cards.size || removed) updateCount();
      if (unknownCards && state === "ready") {
        setState("partial", "已同步；部分评论或回复无法读取用户 ID");
      }
    }

    function routeChanged() {
      restoreAll();
      scope = currentScope();
      render();
      if (active) scanAll();
    }

    async function refresh() {
      const sequence = ++generation;
      if (!source) {
        blacklist = null;
        restoreAll();
        setState("error", "无法读取黑名单：客户端接口不可用");
        return;
      }
      let nextAccount;
      try { nextAccount = source.getAccountId(); }
      catch (error) {
        blacklist = null;
        restoreAll();
        setState("error", `读取账号失败：${errorMessage(error)}`);
        return;
      }
      if (!nextAccount) {
        accountId = null;
        blacklist = null;
        restoreAll();
        setState("error", "未检测到已登录账号；请在网易云客户端登录");
        return;
      }
      accountId = nextAccount;
      blacklist = null;
      restoreAll();
      setState("loading", "正在读取当前账号黑名单…");
      try {
        const ids = await withTimeout(Promise.resolve(source.readBlacklist(accountId)), REQUEST_TIMEOUT_MS, win);
        if (sequence !== generation) return;
        if (source.getAccountId() !== accountId) {
          refresh();
          return;
        }
        blacklist = ids;
        setState("ready", `已同步 ${ids.size} 位黑名单用户`);
        scanAll();
      } catch (error) {
        if (sequence !== generation) return;
        blacklist = null;
        restoreAll();
        setState("error", `读取黑名单失败：${errorMessage(error)}`);
      }
    }

    function createPanel() {
      const style = doc.createElement("style");
      style.id = STYLE_ID;
      style.textContent = `
        .${HIDDEN_CLASS}{display:none!important}
        html.bnem-comment-pending ${ALBUM_CONTAINER} ${CARD_SELECTOR},
        html.bnem-comment-pending ${SONG_CONTAINER} ${CARD_SELECTOR},
        html.bnem-comment-pending ${VINYL_CONTAINER} ${CARD_SELECTOR}{visibility:hidden!important}
        #${PANEL_ID}{position:fixed;right:18px;bottom:110px;z-index:2147483000;width:218px;
          padding:10px 12px;border-radius:10px;background:rgba(34,34,34,.94);color:#fff;
          box-shadow:0 3px 14px #0005;font:12px/1.5 sans-serif}
        #${PANEL_ID}[hidden]{display:none!important}
        #${PANEL_ID} .bnem-title{font-weight:600;margin-bottom:6px}
        #${PANEL_ID} .bnem-row{display:flex;align-items:center;justify-content:space-between;gap:6px}
        #${PANEL_ID} button{color:#fff;background:#444;border:0;border-radius:5px;padding:3px 7px;cursor:pointer}
        #${PANEL_ID} button:disabled{opacity:.5;cursor:default}
        #${PANEL_ID} .bnem-status{margin-top:6px;overflow-wrap:anywhere;color:#bbb}
        #${PANEL_ID} .bnem-status[data-state="error"],#${PANEL_ID} .bnem-status[data-state="partial"]{color:#ffcb80}
        #${PANEL_ID} .bnem-count{margin-top:3px}`;
      (doc.head || doc.documentElement).append(style);

      panel = doc.createElement("section");
      panel.id = PANEL_ID;
      panel.setAttribute("aria-label", "BetterNEM 评论过滤");
      const title = doc.createElement("div");
      title.className = "bnem-title";
      title.textContent = "BetterNEM 评论过滤";
      const row = doc.createElement("div");
      row.className = "bnem-row";
      const label = doc.createElement("label");
      toggle = doc.createElement("input");
      toggle.type = "checkbox";
      label.append(toggle, doc.createTextNode(" 开启过滤"));
      refreshButton = doc.createElement("button");
      refreshButton.type = "button";
      refreshButton.textContent = "刷新黑名单";
      row.append(label, refreshButton);
      statusElement = doc.createElement("div");
      statusElement.className = "bnem-status";
      countElement = doc.createElement("div");
      countElement.className = "bnem-count";
      panel.append(title, row, statusElement, countElement);
      doc.body.append(panel);
      toggle.addEventListener("change", () => {
        enabled = toggle.checked;
        try { win.localStorage.setItem("betternem.commentFilter.enabled", enabled ? "1" : "0"); }
        catch { /* localStorage may be unavailable in the client */ }
        if (!enabled) restoreAll();
        else scanAll();
        render();
      });
      refreshButton.addEventListener("click", refresh);
    }

    function start() {
      if (observer) return;
      try { enabled = win.localStorage.getItem("betternem.commentFilter.enabled") !== "0"; }
      catch { enabled = true; }
      createPanel();
      scope = currentScope();
      active = !!scope;
      setState("loading", "正在连接网易云账号…");
      observer = new win.MutationObserver(onMutations);
      observer.observe(doc.body, { childList: true, characterData: true, subtree: true });
      win.addEventListener("popstate", routeChanged);
      win.addEventListener("hashchange", routeChanged);
      try {
        source = sourceFactory(win);
        unlisten = source.listen?.(routeChanged) || null;
        refresh();
        unwatchAccount = source.watchAccount?.(checkAccount) || null;
      } catch (error) {
        blacklist = null;
        setState("error", `读取黑名单不可用：${errorMessage(error)}`);
      }
      accountTimer = win.setInterval(checkAccount, ACCOUNT_CHECK_MS);
    }

    function checkAccount() {
      syncScope();
      if (!source) return;
      try { if (source.getAccountId() !== accountId) refresh(); }
      catch { refresh(); }
    }

    function destroy() {
      generation += 1;
      observer?.disconnect();
      observer = null;
      if (accountTimer) win.clearInterval(accountTimer);
      accountTimer = null;
      if (typeof unlisten === "function") unlisten();
      unlisten = null;
      if (typeof unwatchAccount === "function") unwatchAccount();
      unwatchAccount = null;
      win.removeEventListener("popstate", routeChanged);
      win.removeEventListener("hashchange", routeChanged);
      restoreAll();
      if (measureFrame != null) win.cancelAnimationFrame(measureFrame);
      flushMeasurements();
      doc.documentElement.classList.remove("bnem-comment-pending");
      panel?.remove();
      doc.getElementById(STYLE_ID)?.remove();
      panel = null;
    }

    return { start, destroy, refresh, getState: () => ({ state, enabled, hidden: hidden.size,
      accountId, blacklistSize: blacklist?.size ?? null, message: stateMessage }) };
  }

  return { normalizeId, normalizeBlacklist, isAlbumPath, isCommentPath, readCommentFromFiber,
    captureWebpackRequire, getClientVersion, createNeteaseSource, createController };
});
