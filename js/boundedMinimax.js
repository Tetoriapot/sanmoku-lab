(function defineBoundedMinimax(global) {
  "use strict";

  const app = global.SanmokuLab;
  const MATE_SCORE = 10000;
  const SEARCH_LIMITS = Object.freeze({
    3: Object.freeze({ maxDepth: 5, nodeBudget: 1500 }),
    4: Object.freeze({ maxDepth: 3, nodeBudget: 1000 }),
    5: Object.freeze({ maxDepth: 2, nodeBudget: 700 }),
  });
  const BUDGET_EXCEEDED = Object.freeze({ type: "node-budget-exceeded" });

  class BoundedMinimaxSolver {
    constructor(game) {
      this.game = game;
      this.table = new Map();
      this.lineCache = new Map();
      this.nodes = 0;
      this.maxDepthReached = 0;
      this.nodeBudget = SEARCH_LIMITS[3].nodeBudget;
      this.hitDepthLimit = false;
    }

    static unsupportedReason(settingsOrState) {
      const settings = settingsOrState || {};
      const boardSize = Number(settings.boardSize);
      return Number.isInteger(boardSize) && SEARCH_LIMITS[boardSize]
        ? null
        : "CPU探索は3×3、4×4、5×5盤に対応しています。";
    }

    static defaultLimits(settingsOrState) {
      const boardSize = Number(settingsOrState && settingsOrState.boardSize);
      return SEARCH_LIMITS[boardSize] || SEARCH_LIMITS[3];
    }

    static searchProfile(settingsOrState) {
      const unsupportedReason = BoundedMinimaxSolver.unsupportedReason(settingsOrState);
      if (unsupportedReason) {
        return {
          kind: "unsupported",
          label: "CPU非対応",
          description: unsupportedReason,
          provenByDesign: false,
          reason: unsupportedReason,
          limits: null,
        };
      }

      const rules = (settingsOrState && settingsOrState.rules) || {};
      const boardSize = Number(settingsOrState && settingsOrState.boardSize);
      const strategicRules = app.ruleRegistry
        .getAll()
        .filter(
          (rule) =>
            rules[rule.id] &&
            rules[rule.id].enabled &&
            !rule.exactSearchSafe,
        )
        .map((rule) => rule.name);
      const needsStrategicSearch = boardSize > 3 || strategicRules.length > 0;
      if (needsStrategicSearch) {
        const limits = BoundedMinimaxSolver.defaultLimits(settingsOrState);
        const reasons = [];
        if (boardSize > 3) reasons.push(`${boardSize}×${boardSize}盤`);
        if (strategicRules.length > 0) reasons.push(strategicRules.join("／"));
        return {
          kind: "strategic",
          label: "戦略探索 / ルールセット未証明",
          description: `${reasons.join("と")}を含むため、最大${limits.maxDepth}手・${limits.nodeBudget.toLocaleString("ja-JP")}局面の範囲で候補手を評価します。理論上の最善手や勝敗は証明しません。`,
          provenByDesign: false,
          reason: null,
          limits,
        };
      }

      return {
        kind: "exact",
        label: "完全探索 / 証明済み",
        description: "終局まで全合法手を探索し、勝敗を証明した手を選びます。",
        provenByDesign: true,
        reason: null,
        limits: null,
      };
    }

    chooseAction(state, options = {}) {
      const context = this.prepareSearch(state, options);
      if (context.decision) return context.decision;

      for (let depthLimit = 1; depthLimit <= context.maxDepth; depthLimit += 1) {
        if (!this.runDepthIteration(context, depthLimit)) break;
      }
      return this.finishSearch(context);
    }

    async chooseActionAsync(state, options = {}) {
      const shouldAbort = typeof options.shouldAbort === "function"
        ? options.shouldAbort
        : () => false;
      const yieldTask = () => new Promise((resolve) => global.setTimeout(resolve, 0));
      const context = this.prepareSearch(state, options);

      await yieldTask();
      if (context.decision) return context.decision;
      if (shouldAbort()) return this.abortSearch(context);

      for (let depthLimit = 1; depthLimit <= context.maxDepth; depthLimit += 1) {
        const continueSearch = this.runDepthIteration(context, depthLimit);
        await yieldTask();
        if (shouldAbort()) return this.abortSearch(context);
        if (!continueSearch) break;
      }
      return this.finishSearch(context);
    }

    prepareSearch(state, options) {
      const startedAt = Date.now();
      const unsupportedReason = BoundedMinimaxSolver.unsupportedReason(state);
      if (unsupportedReason) {
        return {
          decision: this.finishDecision({
            action: null,
            score: null,
            nodes: 0,
            depth: 0,
            completedDepth: 0,
            proven: false,
            method: "unsupported",
            limitReason: "unsupported",
            reason: unsupportedReason,
          }, startedAt),
        };
      }
      if (!state || state.status !== "playing") {
        return {
          decision: this.finishDecision({
            action: null,
            score: null,
            nodes: 0,
            depth: 0,
            completedDepth: 0,
            proven: true,
            method: "strategic",
            limitReason: null,
            reason: "game-ended",
          }, startedAt),
        };
      }

      const defaults = BoundedMinimaxSolver.defaultLimits(state);
      const maxDepth = app.utils.clampInteger(
        options.maxDepth,
        1,
        12,
        defaults.maxDepth,
      );
      this.nodeBudget = app.utils.clampInteger(
        options.nodeBudget,
        100,
        50000,
        defaults.nodeBudget,
      );
      this.nodes = 0;
      this.maxDepthReached = 0;

      const rootPlayer = state.currentPlayer;
      const rootActions = this.getSortedActions(state);
      if (rootActions.length === 0) {
        return {
          decision: this.finishDecision({
            action: null,
            score: 0,
            nodes: 0,
            depth: 0,
            completedDepth: 0,
            proven: true,
            method: "strategic",
            limitReason: null,
            reason: "no-legal-actions",
          }, startedAt),
        };
      }

      return {
        decision: null,
        startedAt,
        state,
        maxDepth,
        rootPlayer,
        rootActions,
        bestAction: rootActions[0],
        bestScore: this.heuristicScore(state, rootPlayer),
        completedDepth: 0,
        proven: false,
        limitReason: "depth-limit",
      };
    }

    runDepthIteration(context, depthLimit) {
      this.table.clear();
      this.hitDepthLimit = false;
      try {
        const iteration = this.searchRoot(
          context.state,
          context.rootActions,
          context.rootPlayer,
          depthLimit,
        );
        context.bestAction = iteration.action;
        context.bestScore = iteration.score;
        context.completedDepth = depthLimit;
        if (!this.hitDepthLimit) {
          context.proven = true;
          context.limitReason = null;
          return false;
        }
        return true;
      } catch (error) {
        if (error !== BUDGET_EXCEEDED) throw error;
        context.limitReason = "node-budget";
        return false;
      }
    }

    finishSearch(context) {
      return this.finishDecision({
        action: app.utils.clone(context.bestAction),
        score: context.bestScore,
        nodes: this.nodes,
        depth: context.completedDepth,
        completedDepth: context.completedDepth,
        proven: context.proven,
        method: "strategic",
        limitReason: context.limitReason,
        reason: context.proven ? null : "bounded-search",
      }, context.startedAt);
    }

    abortSearch(context) {
      return this.finishDecision({
        action: null,
        score: context.bestScore,
        nodes: this.nodes,
        depth: context.completedDepth,
        completedDepth: context.completedDepth,
        proven: false,
        method: "strategic",
        limitReason: "aborted",
        reason: "aborted",
      }, context.startedAt);
    }

    searchRoot(state, actions, rootPlayer, depthLimit) {
      let bestAction = actions[0];
      let bestScore = -Infinity;
      let alpha = -Infinity;

      for (const action of actions) {
        const child = this.simulateChild(state, action);
        if (!child) continue;
        const score = this.search(
          child,
          rootPlayer,
          depthLimit - 1,
          alpha,
          Infinity,
          1,
        );
        if (score > bestScore) {
          bestScore = score;
          bestAction = action;
        }
        alpha = Math.max(alpha, bestScore);
      }

      return { action: bestAction, score: bestScore };
    }

    search(state, rootPlayer, remainingDepth, alpha, beta, ply) {
      this.maxDepthReached = Math.max(this.maxDepthReached, ply);

      if (state.status !== "playing") {
        return this.terminalScore(state, rootPlayer, ply);
      }
      if (remainingDepth === 0) {
        this.hitDepthLimit = true;
        return this.heuristicScore(state, rootPlayer);
      }

      const originalAlpha = alpha;
      const originalBeta = beta;
      const tableKey = `${rootPlayer}|ply:${ply}|${this.game.transpositionKey(state)}`;
      const cached = this.table.get(tableKey);
      if (cached && cached.depth >= remainingDepth) {
        if (cached.flag === "EXACT") return cached.score;
        if (cached.flag === "LOWER") alpha = Math.max(alpha, cached.score);
        if (cached.flag === "UPPER") beta = Math.min(beta, cached.score);
        if (alpha >= beta) return cached.score;
      }

      const actions = this.getSortedActions(state);
      if (actions.length === 0) return 0;
      const maximizing = state.currentPlayer === rootPlayer;
      let bestScore = maximizing ? -Infinity : Infinity;
      let exploredChild = false;

      for (const action of actions) {
        const child = this.simulateChild(state, action);
        if (!child) continue;
        exploredChild = true;
        const score = this.search(
          child,
          rootPlayer,
          remainingDepth - 1,
          alpha,
          beta,
          ply + 1,
        );
        if (maximizing) {
          bestScore = Math.max(bestScore, score);
          alpha = Math.max(alpha, bestScore);
        } else {
          bestScore = Math.min(bestScore, score);
          beta = Math.min(beta, bestScore);
        }
        if (alpha >= beta) break;
      }

      if (!exploredChild) return 0;

      const flag = bestScore <= originalAlpha
        ? "UPPER"
        : bestScore >= originalBeta
          ? "LOWER"
          : "EXACT";
      this.table.set(tableKey, {
        depth: remainingDepth,
        score: bestScore,
        flag,
      });
      return bestScore;
    }

    getSortedActions(state) {
      return this.game
        .getLegalActions(state)
        .slice()
        .sort((left, right) => this.actionKey(left).localeCompare(this.actionKey(right)));
    }

    simulateChild(state, action) {
      if (this.nodes >= this.nodeBudget) throw BUDGET_EXCEEDED;
      this.nodes += 1;
      const result = this.game.simulateAction(state, action);
      return result.ok ? result.state : null;
    }

    actionKey(action) {
      const source = Number.isInteger(action.source) ? action.source : -1;
      return `${action.type}:${String(source + 1).padStart(2, "0")}:${String(action.target).padStart(2, "0")}`;
    }

    terminalScore(state, rootPlayer, ply) {
      if (state.status === "draw" || state.winner === null) return 0;
      return state.winner === rootPlayer
        ? MATE_SCORE - ply
        : -MATE_SCORE + ply;
    }

    heuristicScore(state, rootPlayer) {
      const opponent = app.utils.otherPlayer(rootPlayer);
      const misere = Boolean(state.rules.MISERE && state.rules.MISERE.enabled);
      const blocked = new Set(
        state.rules.NO_CENTER && state.rules.NO_CENTER.enabled
          ? app.board.getCenterIndexes(state.boardSize)
          : [],
      );
      let lineScore = 0;
      let viableLineCount = 0;

      for (const line of this.getLineWindows(state.boardSize, state.winLength)) {
        if (line.some((index) => blocked.has(index))) continue;
        viableLineCount += 1;
        let rootCount = 0;
        let opponentCount = 0;
        for (const index of line) {
          const piece = state.board[index];
          if (!piece) continue;
          if (piece.owner === rootPlayer) rootCount += 1;
          else if (piece.owner === opponent) opponentCount += 1;
        }
        if (rootCount > 0 && opponentCount > 0) continue;
        const rootValue = rootCount > 0 ? 7 ** (rootCount - 1) : 0;
        const opponentValue = opponentCount > 0 ? 7 ** (opponentCount - 1) : 0;
        lineScore += misere
          ? opponentValue - rootValue
          : rootValue - opponentValue;
      }

      let score = Math.trunc(
        lineScore * Math.min(1, 24 / Math.max(1, viableLineCount)),
      );

      const pieceDifference =
        app.board.countPieces(state.board, rootPlayer) -
        app.board.countPieces(state.board, opponent);
      score += (misere ? -1 : 1) * pieceDifference * 2;

      const centerIndexes = app.board.getCenterIndexes(state.boardSize);
      for (const index of centerIndexes) {
        if (blocked.has(index)) continue;
        const piece = state.board[index];
        if (piece) score += piece.owner === rootPlayer ? 3 : -3;
      }

      const mobility = Math.min(this.game.getLegalActions(state).length, 18);
      score += state.currentPlayer === rootPlayer ? mobility : -mobility;

      const repetitionCount = state.positionCounts[this.game.positionKey(state)] || 0;
      if (repetitionCount >= 2) score = Math.trunc(score / 2);

      return Math.max(-4000, Math.min(4000, score));
    }

    getLineWindows(size, winLength) {
      const cacheKey = `${size}:${winLength}`;
      if (this.lineCache.has(cacheKey)) return this.lineCache.get(cacheKey);
      const directions = [
        [0, 1],
        [1, 0],
        [1, 1],
        [1, -1],
      ];
      const lines = [];
      for (let row = 0; row < size; row += 1) {
        for (let column = 0; column < size; column += 1) {
          for (const [rowStep, columnStep] of directions) {
            const endRow = row + rowStep * (winLength - 1);
            const endColumn = column + columnStep * (winLength - 1);
            if (!app.board.isInside(endRow, endColumn, size)) continue;
            lines.push(
              Array.from({ length: winLength }, (_, offset) =>
                app.board.toIndex(
                  row + rowStep * offset,
                  column + columnStep * offset,
                  size,
                ),
              ),
            );
          }
        }
      }
      this.lineCache.set(cacheKey, lines);
      return lines;
    }

    finishDecision(decision, startedAt) {
      return {
        ...decision,
        elapsedMs: Math.max(0, Date.now() - startedAt),
        nodeBudget: this.nodeBudget,
      };
    }
  }

  app.BoundedMinimaxSolver = BoundedMinimaxSolver;
})(globalThis);
