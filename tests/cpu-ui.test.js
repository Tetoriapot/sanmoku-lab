"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
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
    labMatchMode: "cpu",
    matchMode: "cpu",
    screen: "play",
    selectedSource: null,
    notice: "",
    pendingFocus: null,
    cpuThinking: false,
    cpuTimer: null,
    cpuRequestToken: 0,
    lastCpuSearch: null,
    renderCount: 0,
    render() {
      this.renderCount += 1;
    },
  });
  ui.labSettings = ui.game.getSettings();
  return ui;
}

function humanMove(ui, target) {
  const result = ui.game.performAction({ type: "place", target });
  assert.equal(result.ok, true);
  return result;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test("queued CPU turn applies exactly one legal response", async () => {
  const ui = createHarness();
  humanMove(ui, 0);
  ui.cpuThinking = true;
  ui.queueCpuTurn();
  await wait(500);

  const state = ui.game.getState();
  assert.equal(state.actionNumber, 2);
  assert.equal(state.currentPlayer, 0);
  assert.equal(state.board.filter((piece) => piece && piece.owner === 1).length, 1);
  assert.equal(ui.cpuThinking, false);
  assert.equal(ui.lastCpuSearch.proven, true);
});

test("5x5 MOVE and VANISH use strategic search for the CPU response", async () => {
  const ui = createHarness();
  ui.labSettings.boardSize = 5;
  ui.labSettings.winLength = 5;
  ui.labSettings.rules.MOVE.enabled = true;
  ui.labSettings.rules.MOVE.settings.threshold = 3;
  ui.labSettings.rules.VANISH.enabled = true;
  ui.labSettings.rules.VANISH.settings.maxPieces = 2;
  ui.game.configure(ui.labSettings);
  humanMove(ui, 0);
  ui.cpuThinking = true;
  ui.queueCpuTurn();
  await wait(500);

  const state = ui.game.getState();
  assert.equal(state.actionNumber, 2);
  assert.equal(state.currentPlayer, 0);
  assert.equal(ui.lastCpuSearch.method, "strategic");
  assert.equal(ui.lastCpuSearch.proven, false);
  assert.equal(ui.lastCpuSearch.nodeBudget, 700);
  assert.ok(ui.lastCpuSearch.nodes <= 700);
});

test("CPU can answer with a MOVE action after both players deploy", async () => {
  const ui = createHarness();
  ui.labSettings.boardSize = 5;
  ui.labSettings.winLength = 5;
  ui.labSettings.rules.MOVE.enabled = true;
  ui.labSettings.rules.MOVE.settings.threshold = 3;
  ui.game.configure(ui.labSettings);
  [0, 4, 6, 8, 12, 10].forEach((target) => humanMove(ui, target));
  const humanMoveResult = ui.game.performAction({ type: "move", source: 0, target: 1 });
  assert.equal(humanMoveResult.ok, true);
  assert.equal(ui.game.getActionMode(), "move");

  ui.cpuThinking = true;
  ui.queueCpuTurn();
  await wait(500);

  const state = ui.game.getState();
  assert.equal(state.actionNumber, 8);
  assert.equal(state.currentPlayer, 0);
  assert.equal(state.lastAction.type, "move");
  assert.equal(state.lastAction.player, 1);
  assert.equal(ui.lastCpuSearch.method, "strategic");
});

test("cancelling a queued CPU turn prevents a stale move after restart", async () => {
  const ui = createHarness();
  humanMove(ui, 0);
  ui.cpuThinking = true;
  ui.queueCpuTurn();
  ui.cancelCpuTurn();
  ui.game.restart();
  await wait(350);

  const state = ui.game.getState();
  assert.equal(state.actionNumber, 0);
  assert.equal(state.board.every((cell) => cell === null), true);
});

test("classic exact search yields and honours cancellation before applying", async () => {
  const ui = createHarness();
  humanMove(ui, 0);
  const originalSimulate = ui.game.simulateAction.bind(ui.game);
  let cancellationScheduled = false;
  let simulationCount = 0;
  ui.game.simulateAction = (state, action) => {
    simulationCount += 1;
    if (!cancellationScheduled) {
      cancellationScheduled = true;
      setTimeout(() => ui.cancelCpuTurn(), 0);
    }
    return originalSimulate(state, action);
  };
  ui.cpuDelay = () => 0;
  ui.cpuThinking = true;
  ui.queueCpuTurn();
  await wait(250);

  assert.equal(cancellationScheduled, true);
  assert.ok(simulationCount > 0);
  assert.equal(ui.game.getState().actionNumber, 1);
  assert.equal(ui.game.getState().currentPlayer, 1);
  assert.equal(ui.cpuThinking, false);
});

test("CPU-mode undo returns to the human decision before the full round", () => {
  const ui = createHarness();
  humanMove(ui, 0);
  const decision = new app.MinimaxSolver(ui.game).chooseAction(ui.game.getState());
  assert.equal(ui.game.performAction(decision.action).ok, true);
  assert.equal(ui.game.getState().actionNumber, 2);

  ui.undoTurn();
  const state = ui.game.getState();
  assert.equal(state.actionNumber, 0);
  assert.equal(state.currentPlayer, 0);
  assert.equal(state.board.every((cell) => cell === null), true);
});

test("CPU identity is reflected in accessible action announcements", () => {
  const ui = createHarness();
  humanMove(ui, 0);
  const decision = new app.MinimaxSolver(ui.game).chooseAction(ui.game.getState());
  const result = ui.game.performAction(decision.action);
  const message = ui.describeCompletedAction(result);
  assert.match(message, /^CPUが/);
  assert.match(message, /PLAYER 1の手番/);
});

test("MOVE announcements identify both the source and destination", () => {
  const ui = createHarness();
  const state = ui.game.getState();
  state.currentPlayer = 1;
  const message = ui.describeCompletedAction({
    state,
    action: { type: "move", player: 0, source: 0, target: 4 },
    effects: [],
  });

  assert.match(message, /1行1列から2行2列へ/);
  assert.match(message, /移動しました/);
});

test("only out-of-range CPU settings focus a described explanation", () => {
  const ui = createHarness();
  ui.labSettings.boardSize = 6;
  ui.startMatch();

  assert.equal(ui.screen, "lab");
  assert.equal(ui.pendingFocus, "cpu-warning");
  const markup = ui.renderLab();
  assert.match(markup, /id="cpu-support-reason"/);
  assert.match(markup, /disabled aria-describedby="cpu-support-reason"/);
});

test("strategic PLAYER VS CPU copy never promises a best move", () => {
  const ui = createHarness();
  ui.labSettings.rules.MOVE.enabled = true;
  ui.labSettings.rules.MOVE.settings.threshold = 3;
  ui.game.configure(ui.labSettings);
  ui.commitAction({ type: "place", requestedTarget: 0 });

  assert.match(ui.notice, /候補手を評価/);
  assert.doesNotMatch(ui.notice, /最善手/);
  ui.cancelCpuTurn();
});

test("strategic PLAYER VS CPU outcomes keep the theory disclaimer", () => {
  const ui = createHarness();
  ui.labSettings.rules.VANISH.enabled = true;
  ui.labSettings.rules.VANISH.settings.maxPieces = 25;
  ui.game.configure(ui.labSettings);
  [0, 3, 1, 4, 2].forEach((target) => humanMove(ui, target));

  const state = ui.game.getState();
  assert.equal(state.status, "won");
  const markup = ui.renderOutcome(state);
  assert.match(markup, /ルールセットの理論解ではありません/);
  assert.match(markup, /aria-describedby="outcome-detail outcome-scope"/);
  assert.match(markup, /id="outcome-scope"/);
});

test("HOME and match start expose the current strategic search profile", () => {
  const ui = createHarness();
  ui.screen = "home";
  ui.labSettings.boardSize = 5;
  ui.labSettings.winLength = 5;
  ui.labSettings.rules.MOVE.enabled = true;

  const homeMarkup = ui.renderHome();
  assert.match(homeMarkup, /id="home-cpu-search-profile"/);
  assert.match(homeMarkup, /data-action="cpu-play" aria-describedby="home-cpu-search-profile"/);
  assert.match(homeMarkup, /data-action="watch-play" aria-describedby="home-cpu-search-profile"/);
  assert.match(homeMarkup, /戦略探索 \/ ルールセット未証明/);

  ui.startMatch();
  assert.equal(ui.screen, "play");
  assert.equal(ui.matchMode, "cpu");
  assert.match(ui.notice, /戦略探索 \/ ルールセット未証明/);
});

test("cancelling during a large strategic search discards its stale move", async () => {
  const ui = createHarness();
  ui.labSettings.boardSize = 5;
  ui.labSettings.winLength = 5;
  ui.labSettings.rules.MOVE.enabled = true;
  ui.labSettings.rules.MOVE.settings.threshold = 3;
  ui.game.configure(ui.labSettings);
  [0, 4, 6, 8, 12, 10].forEach((target) => humanMove(ui, target));
  assert.equal(ui.game.performAction({ type: "move", source: 0, target: 1 }).ok, true);
  assert.equal(ui.game.getState().currentPlayer, 1);

  const originalSimulate = ui.game.simulateAction.bind(ui.game);
  let cancellationScheduled = false;
  let simulationCount = 0;
  ui.game.simulateAction = (state, action) => {
    simulationCount += 1;
    if (!cancellationScheduled) {
      cancellationScheduled = true;
      setTimeout(() => ui.cancelCpuTurn(), 0);
    }
    return originalSimulate(state, action);
  };
  ui.cpuDelay = () => 0;
  ui.cpuThinking = true;
  ui.queueCpuTurn();
  await wait(250);

  assert.equal(cancellationScheduled, true);
  assert.ok(simulationCount > 0);
  assert.ok(simulationCount < 700);
  assert.equal(ui.game.getState().actionNumber, 7);
  assert.equal(ui.game.getState().currentPlayer, 1);
  assert.equal(ui.cpuThinking, false);
});

test("new play targets are revealed while ordinary rerenders preserve scroll", () => {
  const ui = createHarness();
  const calls = [];
  const pendingTarget = {
    disabled: false,
    focus(options) { calls.push(["focus", options]); },
    scrollIntoView(options) { calls.push(["scroll", options]); },
  };
  ui.root = {
    querySelector() { return pendingTarget; },
    querySelectorAll() { return []; },
  };
  ui.pendingFocus = "next-action";
  ui.restoreFocus(null);
  assert.deepEqual(calls[0], ["focus", { preventScroll: false }]);
  assert.equal(calls[1][0], "scroll");
  assert.equal(calls[1][1].block, "center");

  calls.length = 0;
  const persistentTarget = {
    disabled: false,
    getAttribute() { return "play-restart"; },
    focus(options) { calls.push(["focus", options]); },
    scrollIntoView(options) { calls.push(["scroll", options]); },
  };
  ui.root = {
    querySelector() { return null; },
    querySelectorAll() { return [persistentTarget]; },
  };
  ui.restoreFocus("play-restart");
  assert.deepEqual(calls, [["focus", { preventScroll: true }]]);

  calls.length = 0;
  ui.root = {
    querySelector(selector) {
      assert.equal(selector, "[data-screen-heading]");
      return pendingTarget;
    },
    querySelectorAll() { return []; },
  };
  ui.pendingFocus = "screen-heading";
  ui.restoreFocus(null);
  assert.deepEqual(calls, [["focus", { preventScroll: true }]]);
});

test("screen headings are programmatically focusable after SPA navigation", () => {
  const ui = createHarness();
  const home = ui.renderHome();
  assert.match(home, /<h1 tabindex="-1" data-screen-heading>/);
  assert.match(home, /class="hero-specimen" role="img" aria-label=/);
  assert.match(ui.renderLab(), /<h1 tabindex="-1" data-screen-heading>/);
  assert.match(ui.renderBook(), /<h1 tabindex="-1" data-screen-heading>/);
});

test("MOVE exposes its selected source and advances to gravity destinations", () => {
  const ui = createHarness();
  ui.labSettings.rules.MOVE.enabled = true;
  ui.labSettings.rules.MOVE.settings.threshold = 1;
  ui.labSettings.rules.GRAVITY.enabled = true;
  ui.game.configure(ui.labSettings);
  humanMove(ui, 0);
  humanMove(ui, 1);

  ui.handleBoardCell(6);
  assert.equal(ui.selectedSource, 6);
  assert.equal(ui.pendingFocus, "move-destination");

  const state = ui.game.getState();
  const markup = ui.renderBoard(state, "move", true);
  assert.match(markup, /data-index="6"[^>]*aria-label="[^"]*移動元として選択中"[^>]*aria-pressed="true"/);
  assert.match(markup, /移動元として選択中/);

  const calls = [];
  const destination = {
    disabled: false,
    focus(options) { calls.push(["focus", options]); },
    scrollIntoView(options) { calls.push(["scroll", options]); },
  };
  ui.root = {
    querySelector(selector) {
      assert.equal(selector, ".gravity-controls button:not(:disabled)");
      return destination;
    },
    querySelectorAll() { return []; },
  };
  ui.restoreFocus(null);
  assert.deepEqual(calls[0], ["focus", { preventScroll: false }]);
  assert.equal(calls[1][0], "scroll");
});

test("a mouse double-click cannot spend two local GRAVITY turns", () => {
  const ui = createHarness();
  ui.matchMode = "pvp";
  ui.labSettings.rules.GRAVITY.enabled = true;
  ui.game.configure(ui.labSettings);
  const columnButton = { dataset: { action: "drop-column", column: "0" } };

  ui.handleAction(columnButton, 1);
  ui.handleAction(columnButton, 2);

  const state = ui.game.getState();
  assert.equal(state.actionNumber, 1);
  assert.equal(state.board.filter(Boolean).length, 1);
});

test("selecting the current navigation page is a no-op", () => {
  const ui = createHarness();
  ui.selectedSource = 6;
  ui.notice = "移動先を選んでください。";

  ui.navigate("play");

  assert.equal(ui.selectedSource, 6);
  assert.equal(ui.notice, "移動先を選んでください。");
  assert.equal(ui.renderCount, 0);
});

test("SPA navigation respects reduced-motion preferences", () => {
  const ui = createHarness();
  ui.screen = "home";
  const originalMatchMedia = globalThis.matchMedia;
  const originalScrollTo = globalThis.scrollTo;
  let scrollOptions = null;
  globalThis.matchMedia = () => ({ matches: true });
  globalThis.scrollTo = (options) => { scrollOptions = options; };

  try {
    ui.navigate("lab");
  } finally {
    if (originalMatchMedia === undefined) delete globalThis.matchMedia;
    else globalThis.matchMedia = originalMatchMedia;
    if (originalScrollTo === undefined) delete globalThis.scrollTo;
    else globalThis.scrollTo = originalScrollTo;
  }

  assert.equal(scrollOptions.behavior, "auto");
});

test("pending live announcements are cancelled before they become stale", async () => {
  const ui = createHarness();
  ui.announcer = { textContent: "" };
  ui.announceTimer = null;

  ui.announce("古い画面の通知");
  ui.cancelAnnouncement(true);
  await wait(40);
  assert.equal(ui.announcer.textContent, "");

  ui.announce("古い通知");
  ui.announce("最新の通知");
  await wait(40);
  assert.equal(ui.announcer.textContent, "最新の通知");
});

test("narrow Rule Lab CSS allows long category labels to wrap", () => {
  const css = fs.readFileSync(path.join(root, "css/style.css"), "utf8");
  assert.match(css, /\.rule-title-row\s*>\s*div\s*\{[^}]*min-width:\s*0/s);
  assert.match(css, /\.category-list span,[\s\S]*?overflow-wrap:\s*anywhere/);
});

test("the visual match notice does not create a second live region", () => {
  const ui = createHarness();
  ui.notice = "CPUが考えています。";
  const markup = ui.renderPlay();

  assert.match(markup, /class="match-notice"/);
  assert.doesNotMatch(markup, /class="match-notice" role="status"/);
});

test("Rule Lab and Rule Book expose all ten registered rules", () => {
  const ui = createHarness();
  const labMarkup = ui.renderLab();
  const bookMarkup = ui.renderBook();
  assert.equal((labMarkup.match(/data-rule-toggle=/g) || []).length, 10);
  assert.equal((bookMarkup.match(/class="book-rule"/g) || []).length, 10);
  for (const label of ["CAPTURE", "FLIP", "FORBIDDEN NEIGHBOR", "DOUBLE LINE", "KING"]) {
    assert.match(labMarkup, new RegExp(label));
    assert.match(bookMarkup, new RegExp(label));
  }
  assert.match(labMarkup, /全10ルール/);
  assert.doesNotMatch(labMarkup, /全5ルール/);

  ui.labSettings.rules.FLIP.enabled = true;
  ui.labSettings.rules.NO_CENTER.enabled = true;
  ui.labSettings.rules.DOUBLE_LINE.enabled = true;
  ui.labSettings.rules.MISERE.enabled = true;
  ui.labSettings.rules.KING.enabled = true;
  ui.labSettings.rules.VANISH.enabled = true;
  const warningMarkup = ui.renderLab();
  assert.match(warningMarkup, /この組み合わせではFLIPは発動しません/);
  assert.match(warningMarkup, /DOUBLE LINE条件/);
  assert.match(warningMarkup, /KINGがVANISHで消える/);

  const announced = createHarness();
  announced.setRuleEnabled("FLIP", true);
  announced.setRuleEnabled("NO_CENTER", true);
  assert.match(announced.notice, /注意。NO CENTERにより中央へ配置できないため/);

  const readableName = createHarness();
  readableName.setRuleEnabled("FORBIDDEN_NEIGHBOR", true);
  assert.match(readableName.notice, /^FORBIDDEN NEIGHBORを有効/);
  assert.doesNotMatch(readableName.notice, /FORBIDDEN_NEIGHBOR/);

  const resolvedWarning = createHarness();
  resolvedWarning.setRuleEnabled("FLIP", true);
  resolvedWarning.setRuleEnabled("NO_CENTER", true);
  resolvedWarning.setRuleEnabled("NO_CENTER", false);
  assert.match(resolvedWarning.notice, /組み合わせ上の注意が解消されました/);
  assert.match(resolvedWarning.notice, /FLIPは発動しません/);
});

test("Rule Lab steppers disable reached bounds and expose rule-specific names", () => {
  const ui = createHarness();
  const rule = app.ruleRegistry.get("VANISH");
  const setting = rule.settings[0];
  const config = ui.labSettings.rules.VANISH;
  config.enabled = true;

  config.settings.maxPieces = setting.min;
  const minimum = ui.renderRuleSetting(rule, setting, config);
  assert.match(minimum, /aria-label="VANISHの盤上に残せる駒を減らす" disabled/);
  assert.doesNotMatch(minimum, /aria-label="VANISHの盤上に残せる駒を増やす" disabled/);

  config.settings.maxPieces = setting.max;
  const maximum = ui.renderRuleSetting(rule, setting, config);
  assert.match(maximum, /aria-label="VANISHの盤上に残せる駒を増やす" disabled/);
});

test("board-size clamping announces the adjusted win condition", () => {
  const ui = createHarness();
  ui.labSettings.boardSize = 5;
  ui.labSettings.winLength = 5;

  ui.setBoardSize(3);

  assert.equal(ui.labSettings.winLength, 3);
  assert.match(ui.notice, /勝利条件も3個並べるへ調整しました/);
});

test("board markup exposes KING, temporary restrictions, CAPTURE, and FLIP without color alone", () => {
  const ui = createHarness();
  for (const ruleId of ["KING", "CAPTURE", "FLIP", "FORBIDDEN_NEIGHBOR"]) {
    ui.labSettings.rules[ruleId].enabled = true;
  }
  ui.game.configure(ui.labSettings);
  const state = ui.game.getState();
  state.board[0] = { id: 1, owner: 0, createdAt: 1, kingFor: 0 };
  state.board[2] = { id: 2, owner: 0, createdAt: 2 };
  state.nextPieceId = 3;
  state.currentPlayer = 1;
  state.lastAction = { type: "place", player: 0, source: null, target: 4, requestedTarget: 4 };
  state.lastEffects = [
    { type: "piece-removed", ruleId: "CAPTURE", index: 1 },
    { type: "piece-flipped", ruleId: "FLIP", index: 2 },
  ];
  ui.game.state = state;

  const markup = ui.renderBoard(state, "place", false);
  assert.match(markup, /class="piece-king"[^>]*>K</);
  assert.match(markup, /piece-effect-badge is-capture[^>]*>C</);
  assert.match(markup, /piece-effect-badge is-flip[^>]*>F</);
  assert.match(markup, /is-temporarily-forbidden/);
  assert.match(markup, /直前のCAPTUREで駒が除去されたマス/);
  assert.match(markup, /直前のFLIPで反転した駒/);
  assert.match(markup, /この手番のみ新規配置禁止/);
  assert.match(markup, /PLAYER 1のKING/);

  state.status = "won";
  const terminalMarkup = ui.renderBoard(state, "place", false);
  assert.doesNotMatch(terminalMarkup, /is-temporarily-forbidden/);
  assert.doesNotMatch(terminalMarkup, /この手番のみ新規配置禁止/);
});

test("VANISH exposes its coordinate, marker, and owner-specific age", () => {
  const ui = createHarness();
  ui.matchMode = "pvp";
  ui.labSettings.rules.VANISH.enabled = true;
  ui.game.configure(ui.labSettings);
  const state = ui.game.getState();
  state.board[1] = { id: 2, owner: 1, createdAt: 2 };
  state.lastEffects = [{
    type: "piece-removed",
    ruleId: "VANISH",
    index: 0,
    piece: { id: 1, owner: 0, createdAt: 1 },
  }];

  const effectText = ui.describeActionEffects(state.lastEffects, state);
  assert.match(effectText, /VANISHで1行1列/);
  const markup = ui.renderBoard(state, "place", false);
  assert.match(markup, /piece-effect-badge is-vanish[^>]*>V</);
  assert.match(markup, /直前のVANISHで駒が消えたマス/);
  assert.match(markup, /PLAYER 2の駒の中で古い順に1番目/);
  assert.doesNotMatch(markup, /自分の駒の中で古い順/);
  assert.match(markup, /直前のVANISHで消滅/);
});

test("labelled play groups and the decorative preview expose correct semantics", () => {
  const ui = createHarness();
  ui.labSettings.rules.GRAVITY.enabled = true;
  ui.game.configure(ui.labSettings);
  const state = ui.game.getState();
  const play = ui.renderPlay();

  assert.match(play, /class="gravity-controls" role="group"/);
  assert.match(play, /aria-label="1列目の3行1列へ配置"/);
  assert.match(play, /class="game-board" role="group"/);
  assert.match(play, /class="play-toolbar" role="group"/);
  assert.match(ui.renderLabPreview(), /class="mini-board-wrap" aria-hidden="true"/);

  ui.matchMode = "watch";
  const watch = ui.renderWatchControls(state);
  assert.match(watch, /aria-describedby="watch-a11y-help"/);
  assert.match(watch, /自動再生中の各着手は読み上げません/);
});

test("winning cells identify the decisive line in both board representations", () => {
  const ui = createHarness();
  ui.matchMode = "pvp";
  const state = ui.game.getState();
  [0, 1, 2].forEach((index) => {
    state.board[index] = { id: index + 1, owner: 0, createdAt: index + 1 };
  });
  state.status = "won";
  state.winner = 0;
  state.loser = 1;
  state.reason = "line-completed";
  state.winningLine = [0, 1, 2];

  const markup = ui.renderBoard(state, "place", false);
  assert.match(markup, /aria-label="1行1列[^"]*決着ライン"/);
  assert.match(markup, /PLAYER 1の○、決着ライン/);
});

test("action and outcome copy explains Phase 6 effects and terminal reasons", () => {
  const ui = createHarness();
  ui.labSettings.rules.FORBIDDEN_NEIGHBOR.enabled = true;
  ui.game.configure(ui.labSettings);
  const state = ui.game.getState();
  state.currentPlayer = 1;
  const notice = ui.describeCompletedAction({
    state,
    action: { type: "place", player: 0, target: 4 },
    effects: [
      { ruleId: "CAPTURE", index: 1 },
      { ruleId: "FLIP", index: 3 },
      { type: "king-designated", ruleId: "KING", index: 4, player: 0 },
    ],
  });
  assert.match(notice, /CAPTUREで1行2列/);
  assert.match(notice, /FLIPで2行1列/);
  assert.match(notice, /最初の駒をKINGに指定/);
  assert.match(notice, /上下左右へ新規配置できません/);

  const kingOutcome = app.utils.clone(state);
  kingOutcome.status = "won";
  kingOutcome.winner = 0;
  kingOutcome.loser = 1;
  kingOutcome.reason = "king-lost";
  kingOutcome.lastAction = { type: "place", player: 0, target: 4 };
  assert.match(ui.renderOutcome(kingOutcome), /KINGが除去または反転され/);
  ui.game.state = kingOutcome;
  const terminalPlay = ui.renderPlay();
  assert.match(terminalPlay, /LAST ACTOR/);
  assert.match(terminalPlay, /FINAL ACTION/);
  assert.doesNotMatch(terminalPlay, /CURRENT PLAYER/);

  const doubleOutcome = app.utils.clone(state);
  doubleOutcome.status = "won";
  doubleOutcome.winner = 0;
  doubleOutcome.loser = 1;
  doubleOutcome.reason = "double-line";
  assert.match(ui.renderOutcome(doubleOutcome), /新しいラインを同時に2本以上/);
});

test("PLAYER VS CPU responds under a Phase 6 rule with strategic search", async () => {
  const ui = createHarness();
  ui.labSettings.rules.CAPTURE.enabled = true;
  ui.game.configure(ui.labSettings);
  humanMove(ui, 0);
  ui.cpuThinking = true;
  ui.queueCpuTurn();
  await wait(500);

  assert.equal(ui.game.getState().actionNumber, 2);
  assert.equal(ui.game.getState().currentPlayer, 0);
  assert.equal(ui.lastCpuSearch.method, "strategic");
  assert.ok(ui.lastCpuSearch.nodes <= 1500);
});
