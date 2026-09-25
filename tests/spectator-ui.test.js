"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
[
  "js/namespace.js",
  "js/board.js",
  "js/ruleRegistry.js",
  "js/rules/vanish.js",
  "js/rules/move.js",
  "js/rules/gravity.js",
  "js/rules/forbiddenNeighbor.js",
  "js/rules/capture.js",
  "js/rules/flip.js",
  "js/rules/misere.js",
  "js/rules/king.js",
  "js/rules/doubleLine.js",
  "js/rules/noCenter.js",
  "js/ruleEngine.js",
  "js/game.js",
  "js/minimax.js",
  "js/boundedMinimax.js",
  "js/ui.js",
].forEach((file) => require(path.join(root, file)));

const app = globalThis.SanmokuLab;

function createHarness() {
  const ui = Object.create(app.UI.prototype);
  Object.assign(ui, {
    game: new app.Game({}),
    labSettings: null,
    labMatchMode: "watch",
    matchMode: "watch",
    screen: "play",
    selectedSource: null,
    notice: "",
    pendingFocus: null,
    cpuThinking: false,
    cpuTimer: null,
    cpuRequestToken: 0,
    lastCpuSearch: null,
    watchPaused: false,
    watchSpeed: "normal",
    watchStepPending: false,
    announceNextNotice: true,
    renderSnapshots: [],
    root: { focus() {} },
    render() {
      this.renderSnapshots.push({
        actionNumber: this.game.getState().actionNumber,
        announce: this.announceNextNotice,
        notice: this.notice,
      });
      this.announceNextNotice = true;
    },
  });
  ui.labSettings = ui.game.getSettings();
  return ui;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(predicate, timeout = 3500) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeout) throw new Error("Timed out waiting for spectator state");
    await wait(10);
  }
}

test("CPU spectator mode chains one move at a time to a perfect-play draw", async () => {
  const ui = createHarness();
  ui.cpuDelay = () => 0;
  ui.cpuThinking = true;
  ui.queueCpuTurn();

  await waitFor(() => ui.game.getState().status !== "playing");
  const state = ui.game.getState();
  assert.equal(state.status, "draw");
  assert.equal(state.actionNumber, 9);
  assert.equal(ui.cpuTimer, null);
  assert.equal(ui.cpuThinking, false);
  assert.ok(ui.renderSnapshots.some((snapshot) => snapshot.announce === false));
  assert.equal(ui.renderSnapshots.at(-1).announce, true);
});

test("all ten active rules autoplay to an engine result with strategic search", async () => {
  const ui = createHarness();
  app.ruleRegistry.getAll().forEach(({ id: ruleId }) => {
    ui.labSettings.rules[ruleId].enabled = true;
  });
  ui.labSettings.rules.VANISH.settings.maxPieces = 2;
  ui.labSettings.rules.MOVE.settings.threshold = 3;
  ui.game.configure(ui.labSettings);
  ui.cpuDelay = () => 0;
  ui.cpuThinking = true;
  ui.queueCpuTurn();

  try {
    await waitFor(() => ui.game.getState().status !== "playing", 12000);
    const state = ui.game.getState();
    assert.ok(["won", "draw"].includes(state.status));
    assert.ok(state.actionNumber <= 128);
    assert.equal(ui.lastCpuSearch.method, "strategic");
    assert.equal(ui.cpuTimer, null);
  } finally {
    ui.cancelCpuTurn();
  }
});

test("pause cancels the reserved spectator move", async () => {
  const ui = createHarness();
  ui.cpuDelay = () => 80;
  ui.cpuThinking = true;
  ui.queueCpuTurn();
  ui.toggleWatchPlayback();

  await wait(140);
  assert.equal(ui.game.getState().actionNumber, 0);
  assert.equal(ui.watchPaused, true);
  assert.equal(ui.cpuTimer, null);
});

test("single-step advances exactly one ply and remains paused", async () => {
  const ui = createHarness();
  ui.cpuDelay = () => 0;
  ui.watchPaused = true;
  ui.stepWatchMatch();

  await waitFor(() => ui.game.getState().actionNumber === 1);
  await wait(40);
  assert.equal(ui.game.getState().actionNumber, 1);
  assert.equal(ui.watchPaused, true);
  assert.equal(ui.watchStepPending, false);
  assert.equal(ui.cpuTimer, null);
  assert.equal(ui.pendingFocus, "watch-step");
});

test("single-step uses strategic search when MOVE and VANISH are active", async () => {
  const ui = createHarness();
  ui.labSettings.rules.MOVE.enabled = true;
  ui.labSettings.rules.MOVE.settings.threshold = 3;
  ui.labSettings.rules.VANISH.enabled = true;
  ui.labSettings.rules.VANISH.settings.maxPieces = 2;
  ui.game.configure(ui.labSettings);
  ui.cpuDelay = () => 0;
  ui.watchPaused = true;
  ui.stepWatchMatch();

  await waitFor(() => ui.game.getState().actionNumber === 1, 5000);
  assert.equal(ui.lastCpuSearch.method, "strategic");
  assert.equal(ui.lastCpuSearch.proven, false);
  assert.ok(ui.lastCpuSearch.nodes <= 1500);
  assert.match(ui.notice, /戦略探索/);
  assert.match(ui.notice, /未証明/);
  const markup = ui.renderPlay();
  assert.match(markup, /STRATEGIC \/ RULESET UNPROVEN/);
  assert.match(markup, /<dt>SEARCH<\/dt><dd>戦略探索<\/dd>/);
  assert.match(markup, /<dt>PROOF<\/dt><dd>前回CPU探索は未証明<\/dd>/);
});

test("a completed strategic search proves only the current position", () => {
  const ui = createHarness();
  ui.labSettings.rules.VANISH.enabled = true;
  ui.labSettings.rules.VANISH.settings.maxPieces = 25;
  ui.game.configure(ui.labSettings);
  [0, 3, 1, 4, 8].forEach((target) => {
    assert.equal(ui.game.performAction({ type: "place", target }).ok, true);
  });

  const decision = new app.BoundedMinimaxSolver(ui.game).chooseAction(ui.game.getState());
  assert.equal(decision.method, "strategic");
  assert.equal(decision.proven, true);
  const description = ui.describeSearchDecision(decision);
  assert.match(description, /戦略探索/);
  assert.match(description, /この局面は証明済み/);
  assert.match(description, /ルールセット全体は未証明/);
  assert.doesNotMatch(description, /完全探索/);

  ui.lastCpuSearch = decision;
  const markup = ui.renderPlay();
  assert.match(markup, /STRATEGIC \/ RULESET UNPROVEN/);
  assert.match(markup, /前回CPU探索の局面は証明済み/);
  assert.match(markup, /STRATEGIC \/ POSITION PROVEN/);
});

test("strategic spectator outcomes state that they are not a theoretical solution", () => {
  const ui = createHarness();
  ui.labSettings.rules.VANISH.enabled = true;
  ui.labSettings.rules.VANISH.settings.maxPieces = 25;
  ui.game.configure(ui.labSettings);
  [0, 3, 1, 4, 2].forEach((target) => {
    assert.equal(ui.game.performAction({ type: "place", target }).ok, true);
  });
  const state = ui.game.getState();
  assert.equal(state.status, "won");
  assert.match(ui.renderOutcome(state), /理論解ではありません/);
});

test("spectator undo pauses and returns exactly one ply", () => {
  const ui = createHarness();
  assert.equal(ui.game.performAction({ type: "place", target: 0 }).ok, true);
  assert.equal(ui.game.performAction({ type: "place", target: 4 }).ok, true);

  ui.undoTurn();
  assert.equal(ui.game.getState().actionNumber, 1);
  assert.equal(ui.watchPaused, true);
  assert.equal(ui.pendingFocus, "watch-step");
});

test("paused spectator restart rejects stale callbacks and stays at the initial board", async () => {
  const ui = createHarness();
  ui.cpuDelay = () => 80;
  ui.cpuThinking = true;
  ui.queueCpuTurn();
  ui.toggleWatchPlayback();
  ui.restartMatch();

  await wait(140);
  const state = ui.game.getState();
  assert.equal(state.actionNumber, 0);
  assert.equal(state.board.every((cell) => cell === null), true);
  assert.equal(ui.watchPaused, true);
  assert.equal(ui.cpuTimer, null);
});

test("speed changes replace the pending timer instead of adding another", () => {
  const ui = createHarness();
  ui.watchSpeed = "slow";
  ui.cpuThinking = true;
  ui.queueCpuTurn();
  const previousTimer = ui.cpuTimer;
  const previousToken = ui.cpuRequestToken;

  ui.setWatchSpeed("fast");
  assert.equal(ui.watchSpeed, "fast");
  assert.notEqual(ui.cpuTimer, previousTimer);
  assert.ok(ui.cpuRequestToken > previousToken);
  ui.cancelCpuTurn();

  const stepping = createHarness();
  stepping.watchPaused = true;
  stepping.watchStepPending = true;
  stepping.cpuThinking = true;
  stepping.setWatchSpeed("slow");
  assert.equal(stepping.cpuThinking, true);
  assert.equal(stepping.watchStepPending, true);
});

test("returning to a paused spectator match does not resume it", () => {
  const ui = createHarness();
  const originalScrollTo = globalThis.scrollTo;
  globalThis.scrollTo = () => {};
  try {
    ui.watchPaused = true;
    ui.navigate("home");
    ui.navigate("play");
    assert.equal(ui.watchPaused, true);
    assert.equal(ui.cpuThinking, false);
    assert.equal(ui.cpuTimer, null);
    assert.equal(ui.pendingFocus, "watch-controls");
  } finally {
    if (originalScrollTo) globalThis.scrollTo = originalScrollTo;
    else delete globalThis.scrollTo;
  }
});

test("spectator mode uses distinct CPU names and exposes playback controls", () => {
  const ui = createHarness();
  assert.equal(ui.displayPlayerName(0), "CPU 1");
  assert.equal(ui.displayPlayerName(1), "CPU 2");

  const playMarkup = ui.renderPlay();
  assert.match(playMarkup, /CPU VS CPU \/ SPECTATOR/);
  assert.match(playMarkup, /aria-label="CPU対戦の観戦操作"/);
  assert.match(playMarkup, /data-action="toggle-watch"/);
  assert.match(playMarkup, /data-action="watch-step"/);
  assert.match(playMarkup, /data-watch-speed/);
  assert.match(playMarkup, /data-focus-key="play-restart"/);
  assert.match(playMarkup, /data-focus-key="play-back"/);
  assert.doesNotMatch(playMarkup, /data-action="toggle-watch"[^>]*aria-pressed/);

  const labMarkup = ui.renderLab();
  assert.match(labMarkup, /data-mode="watch"/);
  assert.match(labMarkup, /aria-pressed="true"[^>]*>CPU×CPU/);
  assert.match(labMarkup, /完全探索 \/ 証明済み/);
  assert.match(labMarkup, />完全探索で観戦</);
});

test("both CPU modes accept every board size and all cyclic rules", () => {
  const ui = createHarness();
  ui.labSettings.boardSize = 4;
  assert.equal(ui.cpuUnsupportedReason(ui.labSettings, "watch"), null);
  assert.equal(ui.cpuUnsupportedReason(ui.labSettings, "cpu"), null);
  assert.equal(ui.cpuSearchProfile(ui.labSettings, "watch").kind, "strategic");
  assert.equal(ui.cpuSearchProfile(ui.labSettings, "cpu").kind, "strategic");

  ui.labSettings.boardSize = 5;
  ui.labSettings.winLength = 5;
  assert.equal(ui.cpuUnsupportedReason(ui.labSettings, "watch"), null);
  assert.equal(ui.cpuUnsupportedReason(ui.labSettings, "cpu"), null);

  ui.labSettings.boardSize = 3;
  ui.labSettings.rules.MOVE.enabled = true;
  assert.equal(ui.cpuUnsupportedReason(ui.labSettings, "watch"), null);
  assert.equal(ui.cpuSearchProfile(ui.labSettings, "watch").kind, "strategic");
  assert.equal(ui.cpuUnsupportedReason(ui.labSettings, "cpu"), null);
  assert.equal(ui.cpuSearchProfile(ui.labSettings, "cpu").kind, "strategic");

  ui.labSettings.rules.MOVE.enabled = false;
  ui.labSettings.rules.VANISH.enabled = true;
  assert.equal(ui.cpuUnsupportedReason(ui.labSettings, "watch"), null);
  assert.equal(ui.cpuSearchProfile(ui.labSettings, "watch").kind, "strategic");
  assert.equal(ui.cpuUnsupportedReason(ui.labSettings, "cpu"), null);
  assert.equal(ui.cpuSearchProfile(ui.labSettings, "cpu").kind, "strategic");

  const labMarkup = ui.renderLab();
  assert.match(labMarkup, /戦略探索 \/ ルールセット未証明/);
  assert.match(labMarkup, />戦略探索で観戦</);
  assert.doesNotMatch(labMarkup, /CPU非対応の設定/);
});

test("both CPU modes route all 6144 board and ten-rule settings", () => {
  const ui = createHarness();
  const boards = [
    [3, 3],
    [4, 3],
    [4, 4],
    [5, 3],
    [5, 4],
    [5, 5],
  ];
  const descriptors = app.ruleRegistry.getAll();
  const ruleIds = descriptors.map((rule) => rule.id);
  const unsafeIds = new Set(
    descriptors.filter((rule) => !rule.exactSearchSafe).map((rule) => rule.id),
  );

  for (const [boardSize, winLength] of boards) {
    for (let mask = 0; mask < 2 ** ruleIds.length; mask += 1) {
      const rules = app.ruleRegistry.createDefaultConfig();
      ruleIds.forEach((ruleId, index) => {
        if (mask & (1 << index)) rules[ruleId].enabled = true;
      });
      const settings = { boardSize, winLength, rules };
      const exact =
        boardSize === 3 &&
        !ruleIds.some(
          (ruleId, index) => (mask & (1 << index)) && unsafeIds.has(ruleId),
        );
      for (const mode of ["cpu", "watch"]) {
        assert.equal(ui.cpuUnsupportedReason(settings, mode), null);
        assert.equal(
          ui.cpuSearchProfile(settings, mode).kind,
          exact ? "exact" : "strategic",
          `${mode}/${boardSize}/${winLength}/${mask}`,
        );
      }
    }
  }
});

test("rule changes announce exact and strategic spectator profile transitions", () => {
  const ui = createHarness();
  ui.setRuleEnabled("MOVE", true);
  assert.match(ui.notice, /戦略探索・ルールセット未証明に切り替わりました/);
  ui.setRuleEnabled("MOVE", false);
  assert.match(ui.notice, /完全探索・証明済みに切り替わりました/);
  ui.setRuleEnabled("CAPTURE", true);
  assert.match(ui.notice, /戦略探索・ルールセット未証明に切り替わりました/);
});

test("5x5 all-rule spectator stepping uses the large-board budget", async () => {
  const ui = createHarness();
  ui.labSettings.boardSize = 5;
  ui.labSettings.winLength = 5;
  app.ruleRegistry.getAll().forEach(({ id: ruleId }) => {
    ui.labSettings.rules[ruleId].enabled = true;
  });
  ui.game.configure(ui.labSettings);
  ui.cpuDelay = () => 0;
  ui.watchPaused = true;
  ui.stepWatchMatch();

  await waitFor(() => ui.game.getState().actionNumber === 1, 5000);
  assert.equal(ui.game.getState().boardSize, 5);
  assert.equal(ui.lastCpuSearch.method, "strategic");
  assert.equal(ui.lastCpuSearch.nodeBudget, 700);
  assert.ok(ui.lastCpuSearch.nodes <= 700);
  assert.equal(ui.pendingFocus, "watch-step");
});
