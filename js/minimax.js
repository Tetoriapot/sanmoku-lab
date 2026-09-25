(function defineMinimax(global) {
  "use strict";

  const app = global.SanmokuLab;
  const MATE_SCORE = 10000;
  const SEARCH_ABORTED = Object.freeze({ type: "search-aborted" });

  class MinimaxSolver {
    constructor(game) {
      this.game = game;
      this.table = new Map();
      this.nodes = 0;
      this.maxDepth = 0;
    }

    static unsupportedReason(settingsOrState) {
      const settings = settingsOrState || {};
      const rules = settings.rules || {};
      if (settings.boardSize !== 3) {
        return "CPUの完全探索は現在3×3盤に対応しています。";
      }
      const strategicRule = app.ruleRegistry.getAll().find(
        (rule) =>
          rules[rule.id] &&
          rules[rule.id].enabled &&
          !rule.exactSearchSafe,
      );
      if (strategicRule) {
        return `CPUの完全探索では現在${strategicRule.name}を使用できません。`;
      }
      return null;
    }

    static supports(settingsOrState) {
      return MinimaxSolver.unsupportedReason(settingsOrState) === null;
    }

    chooseAction(state) {
      const startedAt = Date.now();
      const unsupported = MinimaxSolver.unsupportedReason(state);
      const decision = this.solve(state);
      return {
        ...decision,
        completedDepth: decision.depth,
        method: unsupported ? "unsupported" : "exact",
        limitReason: unsupported ? "unsupported" : null,
        elapsedMs: Math.max(0, Date.now() - startedAt),
        nodeBudget: null,
      };
    }

    async chooseActionAsync(state, options = {}) {
      const startedAt = Date.now();
      const unsupported = MinimaxSolver.unsupportedReason(state);
      if (unsupported) {
        return {
          action: null,
          score: null,
          nodes: 0,
          depth: 0,
          completedDepth: 0,
          proven: false,
          method: "unsupported",
          limitReason: "unsupported",
          reason: unsupported,
          elapsedMs: Math.max(0, Date.now() - startedAt),
          nodeBudget: null,
        };
      }
      if (!state || state.status !== "playing") {
        return {
          action: null,
          score: null,
          nodes: 0,
          depth: 0,
          completedDepth: 0,
          proven: true,
          method: "exact",
          limitReason: null,
          reason: "game-ended",
          elapsedMs: Math.max(0, Date.now() - startedAt),
          nodeBudget: null,
        };
      }

      const rootPlayer = state.currentPlayer;
      const children = this.createChildren(state);
      if (children.length === 0) {
        return {
          action: null,
          score: 0,
          nodes: 0,
          depth: 0,
          completedDepth: 0,
          proven: true,
          method: "exact",
          limitReason: null,
          reason: "no-legal-actions",
          elapsedMs: Math.max(0, Date.now() - startedAt),
          nodeBudget: null,
        };
      }

      this.table.clear();
      this.nodes = 0;
      this.maxDepth = 0;
      const control = {
        shouldAbort: typeof options.shouldAbort === "function"
          ? options.shouldAbort
          : () => false,
        yieldEvery: app.utils.clampInteger(options.yieldEvery, 32, 2048, 256),
        lastYieldAt: 0,
      };
      let bestAction = children[0].action;
      let bestScore = -Infinity;
      let alpha = -Infinity;

      try {
        for (const child of children) {
          const score = await this.searchAsync(
            child.state,
            rootPlayer,
            alpha,
            Infinity,
            1,
            control,
          );
          if (score > bestScore) {
            bestScore = score;
            bestAction = child.action;
          }
          alpha = Math.max(alpha, bestScore);
          await this.yieldForInput(control, true);
        }
      } catch (error) {
        if (error !== SEARCH_ABORTED) throw error;
        return {
          action: null,
          score: bestScore,
          nodes: this.nodes,
          depth: this.maxDepth,
          completedDepth: 0,
          proven: false,
          method: "exact",
          limitReason: "aborted",
          reason: "aborted",
          elapsedMs: Math.max(0, Date.now() - startedAt),
          nodeBudget: null,
        };
      }

      return {
        action: app.utils.clone(bestAction),
        score: bestScore,
        nodes: this.nodes,
        depth: this.maxDepth,
        completedDepth: this.maxDepth,
        proven: true,
        method: "exact",
        limitReason: null,
        reason: null,
        elapsedMs: Math.max(0, Date.now() - startedAt),
        nodeBudget: null,
      };
    }

    solve(state) {
      const unsupportedReason = MinimaxSolver.unsupportedReason(state);
      if (unsupportedReason) {
        return {
          action: null,
          score: null,
          nodes: 0,
          depth: 0,
          proven: false,
          reason: unsupportedReason,
        };
      }
      if (!state || state.status !== "playing") {
        return {
          action: null,
          score: null,
          nodes: 0,
          depth: 0,
          proven: true,
          reason: "game-ended",
        };
      }

      const rootPlayer = state.currentPlayer;
      const children = this.createChildren(state);
      if (children.length === 0) {
        return {
          action: null,
          score: 0,
          nodes: 0,
          depth: 0,
          proven: true,
          reason: "no-legal-actions",
        };
      }

      this.table.clear();
      this.nodes = 0;
      this.maxDepth = 0;

      let bestAction = children[0].action;
      let bestScore = -Infinity;
      let alpha = -Infinity;

      for (const child of children) {
        const score = this.search(child.state, rootPlayer, alpha, Infinity, 1);
        if (score > bestScore) {
          bestScore = score;
          bestAction = child.action;
        }
        alpha = Math.max(alpha, bestScore);
      }

      return {
        action: app.utils.clone(bestAction),
        score: bestScore,
        nodes: this.nodes,
        depth: this.maxDepth,
        proven: true,
        reason: null,
      };
    }

    search(state, rootPlayer, alpha, beta, depth) {
      this.nodes += 1;
      this.maxDepth = Math.max(this.maxDepth, depth);

      if (state.status !== "playing") {
        return this.terminalScore(state, rootPlayer);
      }

      const tableKey = `${rootPlayer}|${this.game.positionKey(state)}`;
      if (this.table.has(tableKey)) return this.table.get(tableKey);

      const children = this.createChildren(state);
      if (children.length === 0) return 0;

      const maximizing = state.currentPlayer === rootPlayer;
      let bestScore = maximizing ? -Infinity : Infinity;
      let fullyExplored = true;

      for (const child of children) {
        const score = this.search(child.state, rootPlayer, alpha, beta, depth + 1);
        if (maximizing) {
          bestScore = Math.max(bestScore, score);
          alpha = Math.max(alpha, bestScore);
        } else {
          bestScore = Math.min(bestScore, score);
          beta = Math.min(beta, bestScore);
        }

        if (beta <= alpha) {
          fullyExplored = false;
          break;
        }
      }

      if (fullyExplored) this.table.set(tableKey, bestScore);
      return bestScore;
    }

    async searchAsync(state, rootPlayer, alpha, beta, depth, control) {
      this.nodes += 1;
      this.maxDepth = Math.max(this.maxDepth, depth);
      await this.yieldForInput(control);

      if (state.status !== "playing") {
        return this.terminalScore(state, rootPlayer);
      }

      const tableKey = `${rootPlayer}|${this.game.positionKey(state)}`;
      if (this.table.has(tableKey)) return this.table.get(tableKey);

      const children = this.createChildren(state);
      if (children.length === 0) return 0;

      const maximizing = state.currentPlayer === rootPlayer;
      let bestScore = maximizing ? -Infinity : Infinity;
      let fullyExplored = true;

      for (const child of children) {
        const score = await this.searchAsync(
          child.state,
          rootPlayer,
          alpha,
          beta,
          depth + 1,
          control,
        );
        if (maximizing) {
          bestScore = Math.max(bestScore, score);
          alpha = Math.max(alpha, bestScore);
        } else {
          bestScore = Math.min(bestScore, score);
          beta = Math.min(beta, bestScore);
        }

        if (beta <= alpha) {
          fullyExplored = false;
          break;
        }
      }

      if (fullyExplored) this.table.set(tableKey, bestScore);
      return bestScore;
    }

    async yieldForInput(control, force = false) {
      if (!force && this.nodes - control.lastYieldAt < control.yieldEvery) return;
      await new Promise((resolve) => global.setTimeout(resolve, 0));
      control.lastYieldAt = this.nodes;
      if (control.shouldAbort()) throw SEARCH_ABORTED;
    }

    createChildren(state) {
      return this.game
        .getLegalActions(state)
        .slice()
        .sort((left, right) => this.actionKey(left).localeCompare(this.actionKey(right)))
        .map((action) => ({
          action,
          result: this.game.simulateAction(state, action),
        }))
        .filter(({ result }) => result.ok)
        .map(({ action, result }) => ({ action, state: result.state }));
    }

    actionKey(action) {
      const source = Number.isInteger(action.source) ? action.source : -1;
      return `${action.type}:${String(source + 1).padStart(2, "0")}:${String(action.target).padStart(2, "0")}`;
    }

    terminalScore(state, rootPlayer) {
      if (state.status === "draw" || state.winner === null) return 0;
      const remaining = Math.max(0, state.board.length - state.actionNumber);
      return state.winner === rootPlayer
        ? MATE_SCORE + remaining
        : -MATE_SCORE - remaining;
    }
  }

  app.MinimaxSolver = MinimaxSolver;
})(globalThis);
