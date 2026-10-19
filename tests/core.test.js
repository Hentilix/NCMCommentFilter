const test = require("node:test");
const assert = require("node:assert/strict");
const api = require("../main.js");

test("IDs are canonical and nicknames are never used", () => {
  assert.equal(api.normalizeId("00042"), "42");
  assert.equal(api.normalizeId(42), "42");
  assert.equal(api.normalizeId("Alice"), null);
  assert.equal(api.normalizeId(Number.MAX_SAFE_INTEGER + 1), null);
  assert.deepEqual([...api.normalizeBlacklist([{ id: "42", nickname: "A" }, { userId: 7 }])], ["42", "7"]);
  assert.throws(() => api.normalizeBlacklist([{ nickname: "A" }]));
  assert.deepEqual([...api.normalizeBlacklist([])], []);
});

test("album route is scoped to the installed client's /album/:id path", () => {
  assert.equal(api.isAlbumPath("/album/123"), true);
  assert.equal(api.isAlbumPath("/album/123/comments"), true);
  assert.equal(api.isAlbumPath("/song/123"), false);
  assert.equal(api.isAlbumPath("/album/not-an-id"), false);
});

test("comment routes include song pages but exclude unrelated pages", () => {
  assert.equal(api.isCommentPath("/album/123"), true);
  assert.equal(api.isCommentPath("/comment/R_SO_4_456"), true);
  assert.equal(api.isCommentPath("/comment/R_SO_4_456/789"), true);
  assert.equal(api.isCommentPath("/comment/R_MV_5_456"), false);
  assert.equal(api.isCommentPath("/song/456"), false);
  assert.equal(api.isCommentPath("/search/456"), false);
});

test("React comment data is read from its owning component, including reply IDs", () => {
  const comment = { user: { id: 7, nickname: "same name" }, beReplied: [{ user: { id: 42 } }] };
  const card = { "__reactFiber$fixture": { memoizedProps: {}, return: {
    memoizedProps: { comment }, return: null
  } } };
  assert.equal(api.readCommentFromFiber(card), comment);
  assert.equal(api.readCommentFromFiber({}), null);
});

test("React alternate branch wins after a card is reused for another author", () => {
  const oldComment = { id: 1, user: { id: 42 }, beReplied: [] };
  const newComment = { id: 2, user: { id: 7 }, beReplied: [] };
  const oldRoot = { child: null, return: null, alternate: null, stateNode: null };
  const newRoot = { child: null, return: null, alternate: oldRoot, stateNode: null };
  oldRoot.alternate = newRoot;
  oldRoot.stateNode = newRoot.stateNode = { current: newRoot };
  const oldOwner = { memoizedProps: { comment: oldComment }, child: null, return: oldRoot, alternate: null };
  const newOwner = { memoizedProps: { comment: newComment }, child: null, return: newRoot, alternate: oldOwner };
  oldOwner.alternate = newOwner;
  oldRoot.child = oldOwner;
  newRoot.child = newOwner;
  const oldCardFiber = { memoizedProps: {}, return: oldOwner, alternate: null };
  const newCardFiber = { memoizedProps: {}, return: newOwner, alternate: oldCardFiber };
  oldCardFiber.alternate = newCardFiber;
  oldOwner.child = oldCardFiber;
  newOwner.child = newCardFiber;
  const card = { "__reactFiber$fixture": oldCardFiber };
  assert.equal(api.readCommentFromFiber(card), newComment);

  // Bailout can share a parent Fiber; its child list still points to the current branch.
  oldCardFiber.return = newOwner;
  assert.equal(api.readCommentFromFiber(card), newComment);
});

test("client source uses current account and client's bundled blacklist API", async () => {
  let uid = 123;
  let requested;
  const store = { getStore: () => ({ host: { uid, isAnonymous: false } }),
    getHistory: () => ({ location: { pathname: "/album/1" }, listen: () => () => {} }) };
  const modules = { 8: { a: store }, 15: { H: async (args) => {
    requested = args;
    return [{ id: "42", nickname: "mutable" }];
  } } };
  const win = {
    betterncm: { ncm: { getNCMVersion: () => "3.1.41", getNCMBuild: () => 205529,
      getNCMPackageVersion: () => "c6406e5" } },
    webpackJsonp: { push(args) {
      const entries = args[2][0];
      args[1][entries[0]]({}, {}, (id) => modules[id]);
    } }
  };
  const source = api.createNeteaseSource(win);
  assert.equal(source.getAccountId(), "123");
  assert.equal(source.getPath(), "/album/1");
  assert.deepEqual([...await source.readBlacklist(source.getAccountId())], ["42"]);
  assert.deepEqual(requested, { userid: "123" });
  uid = 456;
  assert.equal(source.getAccountId(), "456");
  modules[15].K = modules[15].H;
  modules[15].H = () => { throw new Error("old export now targets an unrelated endpoint"); };
  win.betterncm.ncm.getNCMPackageVersion = () => "83304b1";
  assert.deepEqual([...await api.createNeteaseSource(win).readBlacklist("456")], ["42"]);
  win.betterncm.ncm.getNCMPackageVersion = () => "future-patch";
  assert.throws(() => api.createNeteaseSource(win), /热更新.*未验证/);
  win.betterncm.ncm.getNCMPackageVersion = () => "83304b1";
  win.betterncm.ncm.getNCMBuild = () => 205530;
  assert.throws(() => api.createNeteaseSource(win), /未验证/);
});
