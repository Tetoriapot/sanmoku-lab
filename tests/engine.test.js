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
].forEach((file) => require(path.join(root, file)));

const app = globalThis.SanmokuLab;

function settings(enabledRules = {}, boardSize = 3, winLength = 3) {
  const rules = app.ruleRegistry.createDefaultConfig();
  for (const [ruleId, values] of Object.entries(enabledRules)) {
    rules[ruleId].enabled = true;
    Object.assign(rules[ruleId].settings, values || {});
  }
  return { boardSize, winLength, rules };
}

function play(game, target, source = null) {
  const type = game.getActionMode();
  const result = game.performAction({ type, source, requestedTarget: target });
  assert.equal(result.ok, true, result.reason);
  return result.state;
}

function ownerAt(state, index) {
  return state.board[index] ? state.board[index].owner : null;
}

test("normal game starts with nine legal placements and JSON state", () => {
  const game = new app.Game(settings());
  const state = game.getState();
  assert.equal(state.currentPlayer, 0);
  assert.equal(state.board.length, 9);
  assert.equal(game.getLegalActions().length, 9);
  assert.doesNotThrow(() => JSON.stringify(state));
});

test("registry exposes ten self-contained rule descriptors", () => {
  const rules = app.ruleRegistry.getAll();
  assert.equal(rules.length, 10);
  assert.deepEqual(
    new Set(rules.map((rule) => rule.id)),
    new Set([
      "VANISH",
      "MOVE",
      "GRAVITY",
      "CAPTURE",
      "FLIP",
      "FORBIDDEN_NEIGHBOR",
      "MISERE",
      "DOUBLE_LINE",
      "KING",
      "NO_CENTER",
    ]),
  );
  for (const rule of rules) {
    assert.ok(rule.name);
    assert.ok(rule.description);
    assert.ok(rule.categories.length > 0);
    assert.ok(Number.isFinite(rule.priority));
    assert.ok(Array.isArray(rule.conflicts));
    assert.equal(typeof rule.exactSearchSafe, "boolean");
    assert.equal(typeof rule.usesPieceAge, "boolean");
    assert.equal(typeof rule.transfersPieceOwnership, "boolean");
  }
  assert.deepEqual(
    new Set(rules.filter((rule) => rule.exactSearchSafe).map((rule) => rule.id)),
    new Set(["GRAVITY", "MISERE", "NO_CENTER"]),
  );
});

test("normal game detects rows, columns, and both diagonals", () => {
  const wins = [
    [0, 3, 1, 4, 2],
    [0, 1, 3, 2, 6],
    [0, 1, 4, 2, 8],
    [2, 0, 4, 1, 6],
  ];

  for (const sequence of wins) {
    const game = new app.Game(settings());
    sequence.forEach((target) => play(game, target));
    const state = game.getState();
    assert.equal(state.status, "won");
    assert.equal(state.winner, 0);
    assert.equal(state.reason, "line-completed");
  }
});

test("normal game detects a full-board draw", () => {
  const game = new app.Game(settings());
  [0, 1, 2, 4, 3, 5, 7, 6, 8].forEach((target) => play(game, target));
  const state = game.getState();
  assert.equal(state.status, "draw");
  assert.equal(state.reason, "no-legal-actions");
});

test("invalid and terminal actions do not mutate state", () => {
  const game = new app.Game(settings());
  play(game, 0);
  const beforeOccupied = JSON.stringify(game.getState());
  const occupied = game.performAction({ type: "place", target: 0 });
  assert.equal(occupied.ok, false);
  assert.equal(JSON.stringify(game.getState()), beforeOccupied);

  [3, 1, 4, 2].forEach((target) => play(game, target));
  const beforeTerminal = JSON.stringify(game.getState());
  const terminal = game.performAction({ type: "place", target: 8 });
  assert.equal(terminal.ok, false);
  assert.equal(JSON.stringify(game.getState()), beforeTerminal);
});

test("undo and restart restore independent states", () => {
  const game = new app.Game(settings());
  play(game, 0);
  assert.equal(game.undo(), true);
  assert.equal(game.getState().board.every((cell) => cell === null), true);
  play(game, 4);
  const restarted = game.restart();
  assert.equal(restarted.board.every((cell) => cell === null), true);
  assert.equal(restarted.currentPlayer, 0);
  assert.equal(game.canUndo(), false);
});

test("board logic supports 4x4 with a three-in-a-row target", () => {
  const game = new app.Game(settings({}, 4, 3));
  [0, 4, 1, 5, 2].forEach((target) => play(game, target));
  assert.equal(game.getState().winner, 0);
});

test("VANISH removes only the acting player's oldest piece before outcome checks", () => {
  const game = new app.Game(settings({ VANISH: { maxPieces: 3 } }));
  [0, 4, 1, 3, 6, 8, 2].forEach((target) => play(game, target));
  const state = game.getState();
  assert.equal(ownerAt(state, 0), null);
  assert.equal(ownerAt(state, 1), 0);
  assert.equal(ownerAt(state, 2), 0);
  assert.equal(ownerAt(state, 6), 0);
  assert.equal(ownerAt(state, 4), 1);
  assert.equal(state.status, "playing");
  assert.deepEqual(state.lastEffects, [
    {
      type: "piece-removed",
      ruleId: "VANISH",
      index: 0,
      piece: { id: 1, owner: 0, createdAt: 1 },
    },
  ]);
});

test("MOVE becomes mandatory after cumulative placements and preserves piece age", () => {
  const game = new app.Game(settings({ MOVE: { threshold: 3 } }));
  [0, 1, 2, 3, 7, 5].forEach((target) => play(game, target));
  assert.equal(game.getActionMode(), "move");

  const before = game.getState().board[0];
  const rejectedPlace = game.performAction({ type: "place", target: 8 });
  assert.equal(rejectedPlace.ok, false);
  const moved = play(game, 8, 0);
  assert.equal(ownerAt(moved, 0), null);
  assert.equal(ownerAt(moved, 8), 0);
  assert.equal(moved.board[8].id, before.id);
  assert.equal(moved.board[8].createdAt, before.createdAt);
});

test("MOVE stays active when VANISH removed a deployed piece", () => {
  const game = new app.Game(
    settings({ VANISH: { maxPieces: 2 }, MOVE: { threshold: 3 } }),
  );
  [0, 4, 2, 3, 7, 8].forEach((target) => play(game, target));
  const state = game.getState();
  assert.equal(state.stats[0].placements, 3);
  assert.equal(app.board.countPieces(state.board, 0), 2);
  assert.equal(game.getActionMode(), "move");
});

test("GRAVITY resolves clicks to the lowest open cell and stacks upward", () => {
  const game = new app.Game(settings({ GRAVITY: {} }));
  let state = play(game, 0);
  assert.equal(ownerAt(state, 6), 0);
  state = play(game, 1);
  assert.equal(ownerAt(state, 7), 1);
  state = play(game, 0);
  assert.equal(ownerAt(state, 3), 0);
  const canonicalTargets = game.getLegalActions().map((action) => action.target);
  assert.equal(new Set(canonicalTargets).size, canonicalTargets.length);
});

test("MISERE makes the player completing a line lose", () => {
  const game = new app.Game(settings({ MISERE: {} }));
  [0, 3, 1, 4, 2].forEach((target) => play(game, target));
  const state = game.getState();
  assert.equal(state.status, "won");
  assert.equal(state.winner, 1);
  assert.equal(state.loser, 0);
  assert.equal(state.reason, "misere-line");
});

test("NO CENTER rejects the center without changing the turn", () => {
  const game = new app.Game(settings({ NO_CENTER: {} }));
  assert.equal(game.getLegalActions().length, 8);
  const before = game.getState();
  const result = game.performAction({ type: "place", target: 4 });
  assert.equal(result.ok, false);
  assert.deepEqual(game.getState(), before);
});

test("GRAVITY and NO CENTER skip the blocked middle cell", () => {
  const game = new app.Game(settings({ GRAVITY: {}, NO_CENTER: {} }));
  let state = play(game, 1);
  assert.equal(ownerAt(state, 7), 0);
  state = play(game, 1);
  assert.equal(ownerAt(state, 1), 1);
  assert.equal(ownerAt(state, 4), null);
});

test("GRAVITY and MISERE preserve loss-before-win ordering", () => {
  const game = new app.Game(settings({ GRAVITY: {}, MISERE: {} }));
  [0, 0, 1, 1, 2].forEach((target) => play(game, target));
  const state = game.getState();
  assert.equal(state.winner, 1);
  assert.equal(state.reason, "misere-line");
});

test("VANISH and MISERE evaluate the line left after removal", () => {
  const game = new app.Game(
    settings({ VANISH: { maxPieces: 3 }, MISERE: {} }),
  );
  [0, 2, 1, 3, 4, 5, 7].forEach((target) => play(game, target));
  const state = game.getState();
  assert.equal(ownerAt(state, 0), null);
  assert.equal(state.status, "won");
  assert.equal(state.winner, 1);
  assert.equal(state.reason, "misere-line");
});

test("MOVE and GRAVITY resolve a moved piece against a virtually empty source", () => {
  const game = new app.Game(settings({ MOVE: { threshold: 1 }, GRAVITY: {} }));
  play(game, 0);
  play(game, 1);
  const sourcePiece = game.getState().board[6];
  const state = play(game, 2, 6);
  assert.equal(ownerAt(state, 6), null);
  assert.equal(ownerAt(state, 8), 0);
  assert.equal(state.board[8].id, sourcePiece.id);
});

test("the original five rules can be compiled and used together deterministically", () => {
  const allRules = settings({
    VANISH: { maxPieces: 2 },
    MOVE: { threshold: 3 },
    GRAVITY: {},
    MISERE: {},
    NO_CENTER: {},
  });
  const firstGame = new app.Game(allRules);
  const secondGame = new app.Game(allRules);
  const first = firstGame.simulateAction(firstGame.getState(), {
    type: "place",
    target: 0,
  });
  const second = secondGame.simulateAction(secondGame.getState(), {
    type: "place",
    target: 0,
  });
  assert.equal(first.ok, true);
  assert.deepEqual(first.state, second.state);
  assert.equal(ownerAt(first.state, 6), 0);
});

test("CAPTURE removes bracketed enemy groups in every orthogonal direction", () => {
  const game = new app.Game(settings({ CAPTURE: {} }, 5, 5));
  const state = game.getState();
  const seeded = [
    [2, 0], [7, 1],
    [10, 0], [11, 1],
    [13, 1], [14, 0],
    [17, 1], [22, 0],
  ];
  seeded.forEach(([index, owner], order) => {
    state.board[index] = { id: order + 1, owner, createdAt: order + 1 };
  });
  state.nextPieceId = seeded.length + 1;

  const result = game.simulateAction(state, { type: "place", target: 12 });
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.effects.filter((effect) => effect.ruleId === "CAPTURE").map((effect) => effect.index),
    [7, 11, 13, 17],
  );
  [7, 11, 13, 17].forEach((index) => assert.equal(result.state.board[index], null));

  const diagonalState = new app.Game(settings({ CAPTURE: {} }, 5, 5)).getState();
  diagonalState.board[0] = { id: 1, owner: 0, createdAt: 1 };
  diagonalState.board[6] = { id: 2, owner: 1, createdAt: 2 };
  diagonalState.nextPieceId = 3;
  const diagonal = game.simulateAction(diagonalState, { type: "place", target: 12 });
  assert.equal(ownerAt(diagonal.state, 6), 1);
});

test("CAPTURE also resolves from a MOVE destination and preserves removal metadata", () => {
  const game = new app.Game(settings({ CAPTURE: {}, MOVE: { threshold: 1 } }));
  const state = game.getState();
  state.stats[0].placements = 1;
  state.board[8] = { id: 1, owner: 0, createdAt: 1 };
  state.board[1] = { id: 2, owner: 1, createdAt: 2, kingFor: 1 };
  state.board[2] = { id: 3, owner: 0, createdAt: 3 };
  state.nextPieceId = 4;
  const result = game.simulateAction(state, { type: "move", source: 8, target: 0 });
  assert.equal(result.ok, true);
  assert.equal(result.state.board[1], null);
  const capture = result.effects.find((effect) => effect.ruleId === "CAPTURE");
  assert.equal(capture.piece.id, 2);
  assert.equal(capture.piece.owner, 1);
  assert.equal(capture.piece.kingFor, 1);
});

test("FLIP converts only orthogonal enemies after a new center placement", () => {
  const game = new app.Game(settings({ FLIP: {} }));
  const state = game.getState();
  [1, 3, 5, 7, 0].forEach((index, order) => {
    state.board[index] = { id: order + 1, owner: 1, createdAt: order + 1 };
  });
  state.nextPieceId = 6;
  const result = game.simulateAction(state, { type: "place", target: 4 });
  assert.equal(result.ok, true);
  [1, 3, 5, 7].forEach((index) => assert.equal(ownerAt(result.state, index), 0));
  assert.equal(ownerAt(result.state, 0), 1);
  assert.equal(result.effects.filter((effect) => effect.ruleId === "FLIP").length, 4);

  const moveGame = new app.Game(settings({ FLIP: {}, MOVE: { threshold: 1 } }));
  play(moveGame, 0);
  play(moveGame, 1);
  const moved = play(moveGame, 4, 0);
  assert.equal(ownerAt(moved, 1), 1);
  assert.equal(moved.lastEffects.some((effect) => effect.ruleId === "FLIP"), false);

  const evenGame = new app.Game(settings({ FLIP: {} }, 4, 4));
  const evenState = evenGame.getState();
  [1, 4, 6, 9].forEach((index, order) => {
    evenState.board[index] = { id: order + 1, owner: 1, createdAt: order + 1 };
  });
  evenState.nextPieceId = 5;
  const evenFlip = evenGame.simulateAction(evenState, { type: "place", target: 5 });
  [1, 4, 6, 9].forEach((index) => assert.equal(ownerAt(evenFlip.state, index), 0));
});

test("FORBIDDEN NEIGHBOR blocks only the next placement around the last target", () => {
  const game = new app.Game(settings({ FORBIDDEN_NEIGHBOR: {} }));
  play(game, 4);
  const legalAfterCenter = new Set(game.getLegalActions().map((action) => action.target));
  [1, 3, 5, 7].forEach((index) => assert.equal(legalAfterCenter.has(index), false));
  assert.equal(legalAfterCenter.has(0), true);

  const before = JSON.stringify(game.getState());
  const rejected = game.performAction({ type: "place", target: 1 });
  assert.equal(rejected.ok, false);
  assert.equal(JSON.stringify(game.getState()), before);

  play(game, 0);
  const legalAfterCorner = new Set(game.getLegalActions().map((action) => action.target));
  assert.equal(legalAfterCorner.has(5), true);
  assert.equal(legalAfterCorner.has(1), false);
  assert.equal(legalAfterCorner.has(3), false);
});

test("GRAVITY skips a temporarily forbidden landing cell", () => {
  const game = new app.Game(settings({ GRAVITY: {}, FORBIDDEN_NEIGHBOR: {} }));
  let state = play(game, 0);
  assert.equal(ownerAt(state, 6), 0);
  state = play(game, 1);
  assert.equal(ownerAt(state, 7), null);
  assert.equal(ownerAt(state, 4), 1);
});

test("DOUBLE LINE requires two newly completed geometric lines", () => {
  const single = new app.Game(settings({ DOUBLE_LINE: {} }));
  [0, 3, 1, 4, 2].forEach((target) => play(single, target));
  assert.equal(single.getState().status, "playing");

  const game = new app.Game(settings({ DOUBLE_LINE: {} }));
  const state = game.getState();
  [1, 3, 5, 7].forEach((index, order) => {
    state.board[index] = { id: order + 1, owner: 0, createdAt: order + 1 };
  });
  state.nextPieceId = 5;
  const result = game.simulateAction(state, { type: "place", target: 4 });
  assert.equal(result.state.status, "won");
  assert.equal(result.state.winner, 0);
  assert.equal(result.state.reason, "double-line");
  assert.deepEqual(new Set(result.state.winningLine), new Set([1, 3, 4, 5, 7]));

  const overlineGame = new app.Game(settings({ DOUBLE_LINE: {} }, 4, 3));
  const overline = overlineGame.getState();
  [0, 1, 3].forEach((index, order) => {
    overline.board[index] = { id: order + 1, owner: 0, createdAt: order + 1 };
  });
  overline.nextPieceId = 4;
  const overlineResult = overlineGame.simulateAction(overline, { type: "place", target: 2 });
  assert.equal(overlineResult.state.status, "playing");
});

test("DOUBLE LINE and MISERE use the same two-line qualification", () => {
  const game = new app.Game(settings({ DOUBLE_LINE: {}, MISERE: {} }));
  const state = game.getState();
  [1, 3, 5, 7].forEach((index, order) => {
    state.board[index] = { id: order + 1, owner: 0, createdAt: order + 1 };
  });
  state.nextPieceId = 5;
  const result = game.simulateAction(state, { type: "place", target: 4 });
  assert.equal(result.state.status, "won");
  assert.equal(result.state.winner, 1);
  assert.equal(result.state.loser, 0);
  assert.equal(result.state.reason, "misere-line");
});

test("KING survives MOVE but its removal or FLIP makes its original owner lose", () => {
  const capturedGame = new app.Game(settings({ KING: {}, CAPTURE: {} }));
  play(capturedGame, 0);
  play(capturedGame, 1);
  const captured = play(capturedGame, 2);
  assert.equal(captured.status, "won");
  assert.equal(captured.winner, 0);
  assert.equal(captured.loser, 1);
  assert.equal(captured.reason, "king-lost");

  const flippedGame = new app.Game(settings({ KING: {}, FLIP: {} }));
  play(flippedGame, 0);
  play(flippedGame, 1);
  const flipped = play(flippedGame, 4);
  assert.equal(flipped.status, "won");
  assert.equal(flipped.winner, 0);
  assert.equal(flipped.reason, "king-lost");
  assert.equal(flipped.board[1].kingFor, 1);
  assert.equal(flipped.board[1].owner, 0);

  const moveGame = new app.Game(settings({ KING: {}, MOVE: { threshold: 1 } }));
  const first = play(moveGame, 0);
  const kingId = first.ruleState.KING.kingIds[0];
  play(moveGame, 8);
  const moved = play(moveGame, 1, 0);
  assert.equal(moved.board[1].id, kingId);
  assert.equal(moved.board[1].kingFor, 0);
  assert.equal(moved.status, "playing");
});

test("KING loss is evaluated after VANISH and before ordinary line victory", () => {
  const game = new app.Game(settings({ KING: {}, VANISH: { maxPieces: 2 } }));
  [0, 4, 1, 5, 2].forEach((target) => play(game, target));
  const state = game.getState();
  assert.equal(state.status, "won");
  assert.equal(state.winner, 1);
  assert.equal(state.loser, 0);
  assert.equal(state.reason, "king-lost");
});

test("if both KINGs are lost in one action, the acting player loses", () => {
  const game = new app.Game(settings({
    KING: {},
    CAPTURE: {},
    VANISH: { maxPieces: 2 },
  }));
  [0, 1, 4, 8, 2].forEach((target) => play(game, target));
  const state = game.getState();
  assert.equal(state.status, "won");
  assert.equal(state.winner, 1);
  assert.equal(state.loser, 0);
  assert.equal(state.reason, "king-lost");
  assert.equal(state.board.some((piece) => piece && piece.kingFor === 0), false);
  assert.equal(state.board.some((piece) => piece && piece.kingFor === 1), false);
});

test("combined board effects execute CAPTURE then FLIP then VANISH", () => {
  const game = new app.Game(settings({
    CAPTURE: {},
    FLIP: {},
    VANISH: { maxPieces: 2 },
  }, 5, 5));
  const state = game.getState();
  const seeded = [
    [0, 0, 1],
    [10, 0, 2],
    [24, 0, 3],
    [11, 1, 4],
    [7, 1, 5],
  ];
  seeded.forEach(([index, owner, createdAt], order) => {
    state.board[index] = { id: order + 1, owner, createdAt };
  });
  state.nextPieceId = 6;
  state.actionNumber = 5;
  const result = game.simulateAction(state, { type: "place", target: 12 });
  assert.equal(result.ok, true);
  const effectOrder = result.effects.map((effect) => effect.ruleId);
  assert.equal(effectOrder[0], "CAPTURE");
  assert.equal(effectOrder[1], "FLIP");
  assert.deepEqual(effectOrder.slice(2), ["VANISH", "VANISH", "VANISH"]);
  assert.equal(result.state.board[11], null);
  assert.equal(ownerAt(result.state, 7), 0);
});

test("simulateAction is deterministic and does not mutate its input", () => {
  const game = new app.Game(settings({ VANISH: { maxPieces: 3 } }));
  const state = game.getState();
  const before = JSON.stringify(state);
  const first = game.simulateAction(state, { type: "place", target: 0 });
  const second = game.simulateAction(state, { type: "place", target: 0 });
  assert.equal(first.ok, true);
  assert.deepEqual(first.state, second.state);
  assert.equal(JSON.stringify(state), before);
});

test("returned effects cannot mutate the live game state", () => {
  const game = new app.Game(settings({ VANISH: { maxPieces: 2 } }));
  [0, 4, 1, 5].forEach((target) => play(game, target));
  const result = game.performAction({ type: "place", target: 2 });
  assert.equal(result.ok, true);
  assert.equal(result.effects.length, 1);

  result.effects[0].type = "injected";
  result.effects[0].piece.owner = 9;
  result.effects.push({ type: "also-injected" });

  const state = game.getState();
  assert.equal(state.lastEffects.length, 1);
  assert.equal(state.lastEffects[0].type, "piece-removed");
  assert.equal(state.lastEffects[0].piece.owner, 0);
});

test("a repeated MOVE cycle ends in a threefold-repetition draw", () => {
  const game = new app.Game(settings({ MOVE: { threshold: 1 } }));
  play(game, 0);
  play(game, 1);

  const cycleActions = [
    [3, 0],
    [4, 1],
    [0, 3],
    [1, 4],
  ];
  for (let cycle = 0; cycle < 3 && game.getState().status === "playing"; cycle += 1) {
    for (const [target, source] of cycleActions) {
      if (game.getState().status !== "playing") break;
      play(game, target, source);
    }
  }

  const state = game.getState();
  assert.equal(state.status, "draw");
  assert.equal(state.reason, "threefold-repetition");
});

test("irrelevant piece ages do not delay threefold repetition", () => {
  const game = new app.Game(settings({
    MOVE: { threshold: 2 },
    DOUBLE_LINE: {},
  }));
  [0, 8, 1, 7].forEach((target) => play(game, target));

  const cycle = [
    [2, 0],
    [3, 7],
    [0, 1],
    [4, 3],
    [1, 2],
    [7, 4],
  ];
  for (let repetition = 0; repetition < 2; repetition += 1) {
    for (const [target, source] of cycle) play(game, target, source);
  }

  const state = game.getState();
  assert.equal(state.status, "draw");
  assert.equal(state.reason, "threefold-repetition");
  assert.equal(state.actionNumber, 16);
});

test("a cyclic VANISH game ignores irrelevant cumulative placement totals", () => {
  const game = new app.Game(settings({ VANISH: { maxPieces: 2 } }));
  [2, 3, 4, 0].forEach((target) => play(game, target));

  const cycle = [1, 5, 2, 3, 4, 0];
  for (let repetition = 0; repetition < 4 && game.getState().status === "playing"; repetition += 1) {
    for (const target of cycle) {
      if (game.getState().status !== "playing") break;
      play(game, target);
    }
  }

  const state = game.getState();
  assert.equal(state.status, "draw");
  assert.equal(state.reason, "threefold-repetition");
});

test("board-sized action limits end cycles and preserve repetition priority", () => {
  for (const boardSize of [3, 5]) {
    const game = new app.Game({
      ...settings({ MOVE: { threshold: 25 }, VANISH: { maxPieces: 2 } }),
      boardSize,
      winLength: boardSize,
    });
    const state = game.getState();
    const expectedLimit = boardSize === 5 ? 200 : 128;
    assert.equal(state.actionLimit, expectedLimit);
    state.actionNumber = state.actionLimit - 1;
    const result = game.simulateAction(state, { type: "place", target: 0 });

    assert.equal(result.ok, true);
    assert.equal(result.state.status, "draw");
    assert.equal(result.state.reason, "action-limit");
    assert.equal(result.state.actionNumber, state.actionLimit);
    assert.equal(game.getState().actionNumber, 0);

    const repeatedState = app.utils.clone(state);
    repeatedState.positionCounts[game.positionKey(result.state)] = 2;
    const repeatedResult = game.simulateAction(repeatedState, { type: "place", target: 0 });
    assert.equal(repeatedResult.ok, true);
    assert.equal(repeatedResult.state.reason, "threefold-repetition");
  }
});

test("position and transposition keys distinguish rules and repetition history", () => {
  const classic = new app.Game(settings());
  const misere = new app.Game(settings({ MISERE: {} }));
  assert.notEqual(classic.positionKey(classic.getState()), misere.positionKey(misere.getState()));

  const state = classic.getState();
  const sameBoardWithHistory = app.utils.clone(state);
  sameBoardWithHistory.positionCounts.extra = 2;
  assert.equal(classic.positionKey(state), classic.positionKey(sameBoardWithHistory));
  assert.notEqual(
    classic.transpositionKey(state),
    classic.transpositionKey(sameBoardWithHistory),
  );

  const sameBoardLater = app.utils.clone(state);
  sameBoardLater.actionNumber += 1;
  assert.equal(classic.positionKey(state), classic.positionKey(sameBoardLater));
  assert.notEqual(classic.transpositionKey(state), classic.transpositionKey(sameBoardLater));

  const forbidden = new app.Game(settings({ FORBIDDEN_NEIGHBOR: {} }));
  const forbiddenLeft = forbidden.getState();
  const forbiddenRight = app.utils.clone(forbiddenLeft);
  forbiddenLeft.lastAction = { type: "place", player: 1, target: 0 };
  forbiddenRight.lastAction = { type: "place", player: 1, target: 8 };
  assert.notEqual(forbidden.positionKey(forbiddenLeft), forbidden.positionKey(forbiddenRight));

  const king = new app.Game(settings({ KING: {} }));
  const crowned = king.getState();
  crowned.board[0] = { id: 1, owner: 0, createdAt: 1, kingFor: 0 };
  crowned.ruleState.KING = { kingIds: [1, null] };
  const uncrowned = app.utils.clone(crowned);
  uncrowned.ruleState.KING.kingIds[0] = null;
  delete uncrowned.board[0].kingFor;
  assert.notEqual(king.positionKey(crowned), king.positionKey(uncrowned));
});

test("position keys preserve cross-player age order for FLIP and VANISH", () => {
  const game = new app.Game(settings({ FLIP: {}, VANISH: { maxPieces: 3 } }));
  const olderOwn = game.getState();
  olderOwn.board[0] = { id: 1, owner: 0, createdAt: 1 };
  olderOwn.board[1] = { id: 2, owner: 1, createdAt: 3 };
  olderOwn.board[8] = { id: 3, owner: 0, createdAt: 5 };
  olderOwn.nextPieceId = 4;
  olderOwn.actionNumber = 5;

  const olderEnemy = app.utils.clone(olderOwn);
  olderEnemy.board[0].createdAt = 3;
  olderEnemy.board[1].createdAt = 1;

  assert.notEqual(game.positionKey(olderOwn), game.positionKey(olderEnemy));

  const first = game.simulateAction(olderOwn, { type: "place", target: 4 });
  const second = game.simulateAction(olderEnemy, { type: "place", target: 4 });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.state.board[0], null);
  assert.notEqual(second.state.board[0], null);
  assert.equal(second.state.board[1], null);
});
