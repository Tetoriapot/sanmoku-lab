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

function choose(game) {
  return new app.MinimaxSolver(game).chooseAction(game.getState());
}

function chooseBounded(game, options) {
  return new app.BoundedMinimaxSolver(game).chooseAction(game.getState(), options);
}

test("CPU support is explicit and excludes unbounded configurations", () => {
  assert.equal(app.MinimaxSolver.supports(new app.Game(settings()).getState()), true);
  assert.equal(
    app.MinimaxSolver.supports(new app.Game(settings({ MISERE: {}, GRAVITY: {}, NO_CENTER: {} })).getState()),
    true,
  );
  assert.equal(app.MinimaxSolver.supports(new app.Game(settings({}, 4)).getState()), false);
  assert.equal(app.MinimaxSolver.supports(new app.Game(settings({ MOVE: {} })).getState()), false);
  assert.equal(app.MinimaxSolver.supports(new app.Game(settings({ VANISH: {} })).getState()), false);
  for (const ruleId of ["CAPTURE", "FLIP", "FORBIDDEN_NEIGHBOR", "DOUBLE_LINE", "KING"]) {
    assert.equal(
      app.MinimaxSolver.supports(new app.Game(settings({ [ruleId]: {} })).getState()),
      false,
      ruleId,
    );
  }
});

test("spectator search profiles distinguish exact, strategic, and unsupported settings", () => {
  assert.equal(
    app.BoundedMinimaxSolver.searchProfile(new app.Game(settings()).getState()).kind,
    "exact",
  );
  assert.equal(
    app.BoundedMinimaxSolver.searchProfile(new app.Game(settings({ MOVE: {} })).getState()).kind,
    "strategic",
  );
  assert.equal(
    app.BoundedMinimaxSolver.searchProfile(new app.Game(settings({ VANISH: {} })).getState()).kind,
    "strategic",
  );
  for (const ruleId of ["CAPTURE", "FLIP", "FORBIDDEN_NEIGHBOR", "DOUBLE_LINE", "KING"]) {
    assert.equal(
      app.BoundedMinimaxSolver.searchProfile(
        new app.Game(settings({ [ruleId]: {} })).getState(),
      ).kind,
      "strategic",
      ruleId,
    );
  }
  assert.equal(
    app.BoundedMinimaxSolver.searchProfile(new app.Game(settings({}, 4)).getState()).kind,
    "strategic",
  );
  assert.equal(
    app.BoundedMinimaxSolver.searchProfile(new app.Game(settings({}, 5, 5)).getState()).kind,
    "strategic",
  );
  assert.equal(
    app.BoundedMinimaxSolver.searchProfile({
      boardSize: 6,
      rules: app.ruleRegistry.createDefaultConfig(),
    }).kind,
    "unsupported",
  );
});

test("all 32 combinations of the original five rules keep their search routing", () => {
  const ruleIds = ["VANISH", "MOVE", "GRAVITY", "MISERE", "NO_CENTER"];
  for (let mask = 0; mask < 2 ** ruleIds.length; mask += 1) {
    const enabled = {};
    ruleIds.forEach((ruleId, index) => {
      if (mask & (1 << index)) enabled[ruleId] = {};
    });
    const profile = app.BoundedMinimaxSolver.searchProfile(
      new app.Game(settings(enabled)).getState(),
    );
    const cyclic = Boolean(enabled.MOVE || enabled.VANISH);
    assert.equal(profile.kind, cyclic ? "strategic" : "exact");
  }
});

test("all 1024 rule combinations route safely from registry search metadata", () => {
  const rules = app.ruleRegistry.getAll();
  const ruleIds = rules.map((rule) => rule.id);
  const unsafeIds = new Set(
    rules.filter((rule) => !rule.exactSearchSafe).map((rule) => rule.id),
  );
  for (let mask = 0; mask < 2 ** ruleIds.length; mask += 1) {
    const enabled = {};
    ruleIds.forEach((ruleId, index) => {
      if (mask & (1 << index)) enabled[ruleId] = {};
    });
    const profile = app.BoundedMinimaxSolver.searchProfile(
      new app.Game(settings(enabled)).getState(),
    );
    const strategic = Object.keys(enabled).some((ruleId) => unsafeIds.has(ruleId));
    assert.equal(profile.kind, strategic ? "strategic" : "exact", `mask ${mask}`);
  }
});

test("every board, win length, and original-five combination returns a legal CPU action", () => {
  const boards = [
    [3, 3],
    [4, 3],
    [4, 4],
    [5, 3],
    [5, 4],
    [5, 5],
  ];
  const ruleIds = ["VANISH", "MOVE", "GRAVITY", "MISERE", "NO_CENTER"];

  for (const [boardSize, winLength] of boards) {
    for (let mask = 0; mask < 2 ** ruleIds.length; mask += 1) {
      const enabled = {};
      ruleIds.forEach((ruleId, index) => {
        if (mask & (1 << index)) enabled[ruleId] = {};
      });
      const game = new app.Game(settings(enabled, boardSize, winLength));
      const state = game.getState();
      const before = JSON.stringify(state);
      const profile = app.BoundedMinimaxSolver.searchProfile(state);
      const exact = boardSize === 3 && !enabled.MOVE && !enabled.VANISH;
      assert.equal(profile.kind, exact ? "exact" : "strategic", `${boardSize}/${winLength}/${mask}`);
      const decision = exact
        ? choose(game)
        : chooseBounded(game, { maxDepth: 1, nodeBudget: 100 });
      assert.ok(decision.action, `${boardSize}/${winLength}/${mask}`);
      assert.ok(
        game.getLegalActions().some(
          (action) =>
            action.type === decision.action.type &&
            action.source === decision.action.source &&
            action.target === decision.action.target,
        ),
        `${boardSize}/${winLength}/${mask}`,
      );
      assert.equal(JSON.stringify(state), before);
      assert.equal(JSON.stringify(game.getState()), before);
      if (!exact) assert.ok(decision.nodes <= decision.nodeBudget);
    }
  }
});

test("every Phase 6 rule and the ten-rule set return legal strategic actions", () => {
  const boards = [
    [3, 3],
    [4, 3],
    [4, 4],
    [5, 3],
    [5, 4],
    [5, 5],
  ];
  const configurations = [
    { CAPTURE: {} },
    { FLIP: {} },
    { FORBIDDEN_NEIGHBOR: {} },
    { DOUBLE_LINE: {} },
    { KING: {} },
    Object.fromEntries(app.ruleRegistry.getAll().map((rule) => [rule.id, {}])),
  ];

  for (const [boardSize, winLength] of boards) {
    for (const enabled of configurations) {
      const game = new app.Game(settings(enabled, boardSize, winLength));
      const state = game.getState();
      const before = JSON.stringify(state);
      const decision = chooseBounded(game, { maxDepth: 1, nodeBudget: 100 });
      assert.equal(decision.method, "strategic");
      assert.ok(decision.action, `${boardSize}/${winLength}/${Object.keys(enabled).join("+")}`);
      assert.ok(
        game.getLegalActions(state).some(
          (action) =>
            action.type === decision.action.type &&
            action.source === decision.action.source &&
            action.target === decision.action.target,
        ),
      );
      assert.equal(JSON.stringify(state), before);
      assert.equal(JSON.stringify(game.getState()), before);
    }
  }
});

test("all-rule CPU matches formally finish for every board and win length", () => {
  const boards = [
    [3, 3],
    [4, 3],
    [4, 4],
    [5, 3],
    [5, 4],
    [5, 5],
  ];
  for (const [boardSize, winLength] of boards) {
    const game = new app.Game(
      settings(
        {
          VANISH: { maxPieces: 2 },
          MOVE: { threshold: 3 },
          GRAVITY: {},
          FORBIDDEN_NEIGHBOR: {},
          CAPTURE: {},
          FLIP: {},
          MISERE: {},
          KING: {},
          DOUBLE_LINE: {},
          NO_CENTER: {},
        },
        boardSize,
        winLength,
      ),
    );
    while (game.getState().status === "playing") {
      const decision = chooseBounded(game, { maxDepth: 1, nodeBudget: 100 });
      assert.ok(decision.action, `${boardSize}/${winLength}`);
      assert.equal(game.performAction(decision.action).ok, true, `${boardSize}/${winLength}`);
      assert.ok(game.getState().actionNumber <= game.getState().actionLimit);
    }
    assert.ok(["won", "draw"].includes(game.getState().status));
  }
});

test("the default 5x5 all-rule CPU policy reaches a formal result", () => {
  const game = new app.Game(
    settings(
      {
        VANISH: { maxPieces: 2 },
        MOVE: { threshold: 3 },
        GRAVITY: {},
        FORBIDDEN_NEIGHBOR: {},
        CAPTURE: {},
        FLIP: {},
        MISERE: {},
        KING: {},
        DOUBLE_LINE: {},
        NO_CENTER: {},
      },
      5,
      5,
    ),
  );
  while (game.getState().status === "playing") {
    const decision = chooseBounded(game);
    assert.equal(decision.method, "strategic");
    assert.equal(decision.nodeBudget, 700);
    assert.ok(decision.nodes <= 700);
    assert.ok(decision.action);
    assert.equal(game.performAction(decision.action).ok, true);
  }
  assert.ok(["won", "draw"].includes(game.getState().status));
  assert.ok(game.getState().actionNumber <= game.getState().actionLimit);
});

test("all 32 original-five combinations play legal moves to an engine result", () => {
  const ruleIds = ["VANISH", "MOVE", "GRAVITY", "MISERE", "NO_CENTER"];
  for (let mask = 0; mask < 2 ** ruleIds.length; mask += 1) {
    const enabled = {};
    ruleIds.forEach((ruleId, index) => {
      if (mask & (1 << index)) enabled[ruleId] = {};
    });
    const game = new app.Game(settings(enabled));
    const strategic = Boolean(enabled.MOVE || enabled.VANISH);
    while (game.getState().status === "playing" && game.getState().actionNumber < 256) {
      const decision = strategic
        ? chooseBounded(game, { maxDepth: 3, nodeBudget: 400 })
        : choose(game);
      const legalActions = game.getLegalActions();
      assert.ok(decision.action, `mask ${mask} returned no action`);
      assert.ok(
        legalActions.some(
          (action) =>
            action.type === decision.action.type &&
            action.source === decision.action.source &&
            action.target === decision.action.target,
        ),
        `mask ${mask} returned an illegal action`,
      );
      assert.equal(game.performAction(decision.action).ok, true, `mask ${mask}`);
    }
    assert.notEqual(game.getState().status, "playing", `mask ${mask} did not finish`);
  }
});

test("bounded search is deterministic, legal, budgeted, and non-mutating", () => {
  const game = new app.Game(settings({ MOVE: { threshold: 1 }, VANISH: { maxPieces: 2 } }));
  const state = game.getState();
  const before = JSON.stringify(state);
  const options = { maxDepth: 5, nodeBudget: 1200 };
  const first = new app.BoundedMinimaxSolver(game).chooseAction(state, options);
  const second = new app.BoundedMinimaxSolver(game).chooseAction(state, options);
  const legalActions = game.getLegalActions(state);

  assert.deepEqual(first.action, second.action);
  assert.equal(first.score, second.score);
  assert.equal(first.method, "strategic");
  assert.equal(first.proven, false);
  assert.ok(first.completedDepth >= 1);
  assert.ok(first.nodes <= options.nodeBudget);
  assert.ok(
    legalActions.some(
      (action) =>
        action.type === first.action.type &&
        action.source === first.action.source &&
        action.target === first.action.target,
    ),
  );
  assert.equal(JSON.stringify(state), before);
  assert.equal(JSON.stringify(game.getState()), before);
});

test("large-board defaults scale the deterministic search budget", () => {
  const expectations = [
    { boardSize: 3, maxDepth: 5, nodeBudget: 1500 },
    { boardSize: 4, maxDepth: 3, nodeBudget: 1000 },
    { boardSize: 5, maxDepth: 2, nodeBudget: 700 },
  ];
  for (const expected of expectations) {
    const enabled = expected.boardSize === 3 ? { MOVE: { threshold: 3 } } : {};
    const game = new app.Game(settings(enabled, expected.boardSize, expected.boardSize));
    const profile = app.BoundedMinimaxSolver.searchProfile(game.getState());
    assert.deepEqual(profile.limits, {
      maxDepth: expected.maxDepth,
      nodeBudget: expected.nodeBudget,
    });
    const decision = chooseBounded(game);
    assert.equal(decision.nodeBudget, expected.nodeBudget);
    assert.ok(decision.completedDepth >= 1);
    assert.ok(decision.nodes <= expected.nodeBudget);
    assert.equal(game.simulateAction(game.getState(), decision.action).ok, true);
  }
});

test("the node budget counts lazy root transitions and discards a partial iteration", () => {
  const game = new app.Game(settings({ MOVE: { threshold: 3 } }, 5, 5));
  [0, 4, 6, 8, 12, 10].forEach((target) => play(game, target));
  assert.equal(game.getActionMode(), "move");
  assert.equal(game.getLegalActions().length, 57);

  const originalSimulate = game.simulateAction.bind(game);
  let simulationCount = 0;
  game.simulateAction = (state, action) => {
    simulationCount += 1;
    return originalSimulate(state, action);
  };

  const depthOne = chooseBounded(game, { maxDepth: 1, nodeBudget: 100 });
  assert.equal(depthOne.completedDepth, 1);
  assert.equal(depthOne.nodes, 57);
  assert.equal(simulationCount, depthOne.nodes);

  simulationCount = 0;
  const interrupted = chooseBounded(game, { maxDepth: 2, nodeBudget: 100 });
  assert.equal(interrupted.completedDepth, 1);
  assert.equal(interrupted.limitReason, "node-budget");
  assert.equal(interrupted.nodes, 100);
  assert.equal(simulationCount, interrupted.nodes);
  assert.deepEqual(interrupted.action, depthOne.action);
});

test("bounded search follows MOVE source and destination actions after deployment", () => {
  const game = new app.Game(settings({ MOVE: { threshold: 1 } }));
  play(game, 0);
  play(game, 4);
  assert.equal(game.getActionMode(), "move");

  const legalActions = game.getLegalActions();
  const decision = chooseBounded(game, { maxDepth: 4, nodeBudget: 1200 });
  assert.equal(decision.action.type, "move");
  assert.ok(Number.isInteger(decision.action.source));
  assert.ok(
    legalActions.some(
      (action) =>
        action.source === decision.action.source && action.target === decision.action.target,
    ),
  );
});

test("strategic search accepts MOVE and VANISH boundary settings", () => {
  const combinations = [
    { threshold: 1, maxPieces: 2 },
    { threshold: 3, maxPieces: 3 },
    { threshold: 25, maxPieces: 25 },
    { threshold: 2, maxPieces: 3 },
    { threshold: 4, maxPieces: 2 },
  ];
  for (const values of combinations) {
    const game = new app.Game(
      settings({
        MOVE: { threshold: values.threshold },
        VANISH: { maxPieces: values.maxPieces },
      }),
    );
    const decision = chooseBounded(game, { maxDepth: 2, nodeBudget: 300 });
    assert.ok(decision.action);
    assert.equal(game.simulateAction(game.getState(), decision.action).ok, true);
  }
});

test("extreme MOVE and VANISH settings reach the move phase and a formal result", () => {
  const configurations = [
    {
      MOVE: { threshold: 25 },
      VANISH: { maxPieces: 2 },
    },
    {
      MOVE: { threshold: 25 },
      VANISH: { maxPieces: 2 },
      GRAVITY: {},
      MISERE: {},
      NO_CENTER: {},
    },
  ];

  for (const configuration of configurations) {
    const game = new app.Game(settings(configuration));
    let sawMove = false;
    while (game.getState().status === "playing" && game.getState().actionNumber < 256) {
      const decision = chooseBounded(game, { maxDepth: 3, nodeBudget: 400 });
      assert.ok(decision.action);
      if (decision.action.type === "move") sawMove = true;
      assert.equal(game.performAction(decision.action).ok, true);
    }
    assert.equal(sawMove, true, Object.keys(configuration).join("+"));
    assert.notEqual(game.getState().status, "playing", Object.keys(configuration).join("+"));
  }
});

test("4x4 and 5x5 MOVE/VANISH boundary settings transition and finish", () => {
  const boundaries = [
    { threshold: 1, maxPieces: 25 },
    { threshold: 25, maxPieces: 2 },
  ];
  for (const boardSize of [4, 5]) {
    for (const boundary of boundaries) {
      const game = new app.Game(
        settings(
          {
            MOVE: { threshold: boundary.threshold },
            VANISH: { maxPieces: boundary.maxPieces },
          },
          boardSize,
          boardSize,
        ),
      );
      let sawMove = false;
      while (game.getState().status === "playing") {
        const decision = chooseBounded(game, { maxDepth: 1, nodeBudget: 100 });
        assert.ok(decision.action, `${boardSize}/${boundary.threshold}/${boundary.maxPieces}`);
        if (decision.action.type === "move") sawMove = true;
        assert.equal(game.performAction(decision.action).ok, true);
      }
      assert.equal(sawMove, true, `${boardSize}/${boundary.threshold}/${boundary.maxPieces}`);
      assert.ok(["won", "draw"].includes(game.getState().status));
      assert.ok(game.getState().actionNumber <= game.getState().actionLimit);
    }
  }
});

test("bounded search accepts all ten active rules and uses the engine action", () => {
  const game = new app.Game(
    settings({
      MOVE: { threshold: 3 },
      VANISH: { maxPieces: 2 },
      GRAVITY: {},
      FORBIDDEN_NEIGHBOR: {},
      CAPTURE: {},
      FLIP: {},
      MISERE: {},
      KING: {},
      DOUBLE_LINE: {},
      NO_CENTER: {},
    }),
  );
  const decision = chooseBounded(game, { maxDepth: 4, nodeBudget: 1200 });
  assert.equal(decision.method, "strategic");
  assert.equal(decision.proven, false);
  assert.ok(
    game.getLegalActions().some(
      (action) =>
        action.type === decision.action.type &&
        action.source === decision.action.source &&
        action.target === decision.action.target,
    ),
  );
  assert.equal(game.performAction(decision.action).ok, true);
});

test("deterministic strategic play reaches an engine terminal state for cyclic rules", () => {
  const configurations = [
    { MOVE: { threshold: 1 } },
    { VANISH: { maxPieces: 2 } },
    {
      MOVE: { threshold: 3 },
      VANISH: { maxPieces: 2 },
      GRAVITY: {},
      MISERE: {},
      NO_CENTER: {},
    },
  ];

  for (const configuration of configurations) {
    const game = new app.Game(settings(configuration));
    while (game.getState().status === "playing" && game.getState().actionNumber < 128) {
      const decision = chooseBounded(game, { maxDepth: 3, nodeBudget: 400 });
      assert.ok(decision.action);
      assert.equal(game.performAction(decision.action).ok, true);
    }
    assert.notEqual(
      game.getState().status,
      "playing",
      Object.keys(configuration).join("+"),
    );
  }
});

test("CPU takes an immediate winning move", () => {
  const game = new app.Game(settings());
  [0, 3, 1, 4, 8].forEach((target) => play(game, target));
  const decision = choose(game);
  assert.equal(decision.proven, true);
  assert.equal(decision.action.target, 5);
  const result = game.simulateAction(game.getState(), decision.action);
  assert.equal(result.state.winner, 1);
});

test("strategic CPU takes immediate wins on 4x4 and 5x5 boards", () => {
  const cases = [
    { boardSize: 4, sequence: [4, 0, 5, 1, 8, 2, 10], winningTarget: 3 },
    { boardSize: 5, sequence: [5, 0, 6, 1, 10, 2, 11, 3, 17], winningTarget: 4 },
  ];
  for (const scenario of cases) {
    const game = new app.Game(settings({}, scenario.boardSize, scenario.boardSize));
    scenario.sequence.forEach((target) => play(game, target));
    assert.equal(game.getState().currentPlayer, 1);
    const decision = chooseBounded(game);
    assert.equal(decision.action.target, scenario.winningTarget);
    const result = game.simulateAction(game.getState(), decision.action);
    assert.equal(result.ok, true);
    assert.equal(result.state.status, "won");
    assert.equal(result.state.winner, 1);
  }
});

test("strategic CPU prioritizes an immediate KING capture", () => {
  const game = new app.Game(settings({ KING: {}, CAPTURE: {} }));
  play(game, 0);
  play(game, 1);
  const decision = chooseBounded(game, { maxDepth: 1, nodeBudget: 100 });
  assert.equal(decision.action.target, 2);
  const result = game.simulateAction(game.getState(), decision.action);
  assert.equal(result.state.status, "won");
  assert.equal(result.state.winner, 0);
  assert.equal(result.state.reason, "king-lost");
});

test("strategic CPU selects an immediate DOUBLE LINE victory", () => {
  const game = new app.Game(settings({ DOUBLE_LINE: {} }));
  const state = game.getState();
  [1, 3, 5, 7].forEach((index, order) => {
    state.board[index] = { id: order + 1, owner: 0, createdAt: order + 1 };
  });
  state.nextPieceId = 5;
  const decision = new app.BoundedMinimaxSolver(game).chooseAction(state, {
    maxDepth: 1,
    nodeBudget: 100,
  });
  assert.equal(decision.action.target, 4);
  const result = game.simulateAction(state, decision.action);
  assert.equal(result.state.status, "won");
  assert.equal(result.state.reason, "double-line");
});

test("CPU blocks an immediate loss", () => {
  const game = new app.Game(settings());
  [0, 4, 1].forEach((target) => play(game, target));
  const decision = choose(game);
  assert.equal(decision.action.target, 2);
});

test("CPU defends the opposite-corner fork with an edge", () => {
  const game = new app.Game(settings());
  [0, 4, 8].forEach((target) => play(game, target));
  const decision = choose(game);
  assert.ok([1, 3, 5, 7].includes(decision.action.target));
});

test("perfect CPU play from both sides ends classic play in a draw", () => {
  const game = new app.Game(settings());
  while (game.getState().status === "playing") {
    const decision = choose(game);
    assert.equal(decision.proven, true);
    assert.ok(decision.action);
    assert.equal(game.performAction(decision.action).ok, true);
  }
  assert.equal(game.getState().status, "draw");
});

test("CPU search is deterministic and leaves the input state unchanged", () => {
  const game = new app.Game(settings());
  play(game, 4);
  const state = game.getState();
  const before = JSON.stringify(state);
  const first = new app.MinimaxSolver(game).chooseAction(state);
  const second = new app.MinimaxSolver(game).chooseAction(state);
  assert.deepEqual(first.action, second.action);
  assert.equal(first.score, second.score);
  assert.equal(JSON.stringify(state), before);
  assert.equal(JSON.stringify(game.getState()), before);
});

test("cooperative exact search matches sync search and can be cancelled", async () => {
  const game = new app.Game(settings());
  play(game, 0);
  const state = game.getState();
  const syncDecision = new app.MinimaxSolver(game).chooseAction(state);
  const asyncDecision = await new app.MinimaxSolver(game).chooseActionAsync(state, {
    yieldEvery: 128,
  });
  assert.deepEqual(asyncDecision.action, syncDecision.action);
  assert.equal(asyncDecision.score, syncDecision.score);
  assert.equal(asyncDecision.proven, true);

  let cancelled = false;
  setTimeout(() => { cancelled = true; }, 0);
  const aborted = await new app.MinimaxSolver(game).chooseActionAsync(state, {
    yieldEvery: 32,
    shouldAbort: () => cancelled,
  });
  assert.equal(aborted.action, null);
  assert.equal(aborted.reason, "aborted");
  assert.equal(aborted.proven, false);
});

test("MISERE CPU avoids completing its own line when another move exists", () => {
  const game = new app.Game(settings({ MISERE: {} }));
  [3, 0, 4, 1, 8].forEach((target) => play(game, target));
  const decision = choose(game);
  assert.notEqual(decision.action.target, 2);
  const result = game.simulateAction(game.getState(), decision.action);
  assert.notEqual(result.state.loser, 1);
});

test("GRAVITY CPU returns an engine-canonical legal landing cell", () => {
  const game = new app.Game(settings({ GRAVITY: {} }));
  play(game, 0);
  const legalKeys = new Set(
    game.getLegalActions().map((action) => `${action.source}:${action.target}`),
  );
  const decision = choose(game);
  assert.ok(legalKeys.has(`${decision.action.source}:${decision.action.target}`));
  assert.ok([3, 7, 8].includes(decision.action.target));
});

test("NO CENTER CPU never selects the blocked center", () => {
  const game = new app.Game(settings({ NO_CENTER: {} }));
  play(game, 0);
  const decision = choose(game);
  assert.notEqual(decision.action.target, 4);
  assert.ok(game.getLegalActions().some((action) => action.target === decision.action.target));
});

test("CPU completely solves the supported special-rule combination", () => {
  const game = new app.Game(settings({ GRAVITY: {}, MISERE: {}, NO_CENTER: {} }));
  play(game, 0);
  const legalActions = game.getLegalActions();
  const decision = choose(game);
  assert.equal(decision.proven, true);
  assert.ok(
    legalActions.some(
      (action) => action.source === decision.action.source && action.target === decision.action.target,
    ),
  );
});

test("perfect CPU play reaches a legal terminal state for every supported rule combination", () => {
  const ruleIds = ["GRAVITY", "MISERE", "NO_CENTER"];
  for (let mask = 1; mask < 2 ** ruleIds.length; mask += 1) {
    const enabled = {};
    ruleIds.forEach((ruleId, index) => {
      if (mask & (1 << index)) enabled[ruleId] = {};
    });
    const game = new app.Game(settings(enabled));
    while (game.getState().status === "playing") {
      const legalActions = game.getLegalActions();
      const decision = choose(game);
      assert.equal(decision.proven, true, Object.keys(enabled).join("+"));
      assert.ok(
        legalActions.some(
          (action) =>
            action.type === decision.action.type &&
            action.source === decision.action.source &&
            action.target === decision.action.target,
        ),
        Object.keys(enabled).join("+"),
      );
      assert.equal(game.performAction(decision.action).ok, true);
      assert.ok(game.getState().actionNumber <= 9);
    }
  }
});

test("unsupported searches return no fallback disguised as a proven move", () => {
  const game = new app.Game(settings({ MOVE: { threshold: 3 } }));
  const decision = choose(game);
  assert.equal(decision.action, null);
  assert.equal(decision.proven, false);
  assert.match(decision.reason, /MOVE/);
});
