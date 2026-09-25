(function defineGame(global) {
  "use strict";

  const app = global.SanmokuLab;

  class Game {
    constructor(settings) {
      this.ruleEngine = new app.RuleEngine(app.ruleRegistry);
      this.undoStack = [];
      this.state = this.createInitialState(settings || {});
    }

    normalizeSettings(settings) {
      const boardSize = app.utils.clampInteger(settings.boardSize, 3, 5, 3);
      const winLength = app.utils.clampInteger(
        settings.winLength,
        3,
        boardSize,
        Math.min(3, boardSize),
      );
      return {
        boardSize,
        winLength,
        rules: app.ruleRegistry.normalizeConfig(settings.rules),
      };
    }

    createInitialState(settings) {
      const normalized = this.normalizeSettings(settings);
      const state = {
        boardSize: normalized.boardSize,
        winLength: normalized.winLength,
        board: app.board.create(normalized.boardSize),
        actionLimit: Math.max(128, normalized.boardSize * normalized.boardSize * 8),
        currentPlayer: 0,
        turnNumber: 1,
        actionNumber: 0,
        nextPieceId: 1,
        stats: [
          { placements: 0, moves: 0 },
          { placements: 0, moves: 0 },
        ],
        status: "playing",
        winner: null,
        loser: null,
        reason: null,
        winningLine: [],
        lastAction: null,
        lastEffects: [],
        ruleState: {},
        rules: normalized.rules,
        positionCounts: {},
      };
      state.positionCounts[this.positionKey(state)] = 1;
      return state;
    }

    getState() {
      return app.utils.clone(this.state);
    }

    getSettings() {
      return {
        boardSize: this.state.boardSize,
        winLength: this.state.winLength,
        rules: app.utils.clone(this.state.rules),
      };
    }

    configure(settings) {
      this.undoStack = [];
      this.state = this.createInitialState(settings);
      return this.getState();
    }

    restart() {
      return this.configure(this.getSettings());
    }

    canUndo() {
      return this.undoStack.length > 0;
    }

    undo() {
      if (!this.canUndo()) return false;
      this.state = this.undoStack.pop();
      return true;
    }

    getActionMode(state) {
      const targetState = state || this.state;
      return this.ruleEngine.getActionMode(targetState, targetState.currentPlayer);
    }

    planAction(action, state) {
      const targetState = state || this.state;
      if (targetState.status !== "playing") {
        return { valid: false, reason: "game-ended" };
      }

      const mode = this.getActionMode(targetState);
      if (!action || action.type !== mode) {
        return { valid: false, reason: `action-must-be-${mode}` };
      }

      const requestedTarget = Number.isInteger(action.requestedTarget)
        ? action.requestedTarget
        : action.target;
      if (
        !Number.isInteger(requestedTarget) ||
        requestedTarget < 0 ||
        requestedTarget >= targetState.board.length
      ) {
        return { valid: false, reason: "invalid-target" };
      }

      let source = null;
      if (mode === "move") {
        source = action.source;
        if (!Number.isInteger(source) || source < 0 || source >= targetState.board.length) {
          return { valid: false, reason: "invalid-source" };
        }
        const sourcePiece = targetState.board[source];
        if (!sourcePiece || sourcePiece.owner !== targetState.currentPlayer) {
          return { valid: false, reason: "source-not-owned" };
        }
      }

      const target = this.ruleEngine.resolveTarget(targetState, requestedTarget, {
        type: mode,
        source,
        player: targetState.currentPlayer,
      });

      if (!Number.isInteger(target)) {
        return { valid: false, reason: "no-destination" };
      }
      if (mode === "move" && target === source) {
        return { valid: false, reason: "same-destination" };
      }
      if (
        !this.ruleEngine.isDestinationAllowed(targetState, target, {
          type: mode,
          source,
          requestedTarget,
          player: targetState.currentPlayer,
        })
      ) {
        return { valid: false, reason: "destination-not-allowed" };
      }

      return {
        valid: true,
        action: {
          type: mode,
          player: targetState.currentPlayer,
          source,
          target,
          requestedTarget,
        },
      };
    }

    getLegalActions(state) {
      const targetState = state || this.state;
      if (targetState.status !== "playing") return [];

      const mode = this.getActionMode(targetState);
      const sources =
        mode === "move"
          ? targetState.board
              .map((piece, index) => ({ piece, index }))
              .filter(
                ({ piece }) => piece && piece.owner === targetState.currentPlayer,
              )
              .map(({ index }) => index)
          : [null];
      const legalActions = [];
      const seen = new Set();

      for (const source of sources) {
        for (let requestedTarget = 0; requestedTarget < targetState.board.length; requestedTarget += 1) {
          const planned = this.planAction(
            { type: mode, source, requestedTarget },
            targetState,
          );
          if (!planned.valid) continue;

          const key = `${mode}:${source === null ? "-" : source}:${planned.action.target}`;
          if (seen.has(key)) continue;
          seen.add(key);
          legalActions.push({
            ...planned.action,
            requestedTarget: planned.action.target,
          });
        }
      }

      return legalActions;
    }

    performAction(action) {
      const result = this.transition(this.state, action);
      if (!result.ok) return result;
      this.undoStack.push(app.utils.clone(this.state));
      this.state = result.state;
      return {
        ...result,
        state: this.getState(),
      };
    }

    simulateAction(state, action) {
      return this.transition(state, action);
    }

    transition(state, action) {
      const planned = this.planAction(action, state);
      if (!planned.valid) {
        return {
          ok: false,
          reason: planned.reason,
          state: app.utils.clone(state),
          effects: [],
        };
      }

      const canonicalAction = planned.action;
      const previousLines = this.ruleEngine.needsPreviousWinningLines(state)
        ? app.board.getWinningLines(
            state.board,
            state.boardSize,
            state.winLength,
            canonicalAction.player,
          )
        : [];
      const draft = app.utils.clone(state);
      draft.actionNumber += 1;
      draft.lastEffects = [];

      if (canonicalAction.type === "place") {
        draft.board[canonicalAction.target] = {
          id: draft.nextPieceId,
          owner: canonicalAction.player,
          createdAt: draft.actionNumber,
        };
        draft.nextPieceId += 1;
        draft.stats[canonicalAction.player].placements += 1;
      } else {
        const piece = draft.board[canonicalAction.source];
        draft.board[canonicalAction.source] = null;
        draft.board[canonicalAction.target] = {
          ...piece,
          lastMovedAt: draft.actionNumber,
        };
        draft.stats[canonicalAction.player].moves += 1;
      }

      draft.lastAction = { ...canonicalAction };
      const effects = this.ruleEngine.runAfterAction(draft, canonicalAction);
      draft.lastEffects = app.utils.clone(effects);

      const completedLines = app.board.getWinningLines(
        draft.board,
        draft.boardSize,
        draft.winLength,
        canonicalAction.player,
      );
      const winningLines = this.ruleEngine.qualifyWinningLines(
        draft,
        canonicalAction.player,
        completedLines,
        previousLines,
        canonicalAction,
        effects,
      );

      const loss = this.ruleEngine.evaluateLoss(
        draft,
        canonicalAction.player,
        completedLines,
        winningLines,
        previousLines,
        canonicalAction,
        effects,
      );
      if (loss) {
        this.finishGame(draft, "won", loss);
        return { ok: true, state: draft, action: canonicalAction, effects };
      }

      const customWin = this.ruleEngine.evaluateWin(
        draft,
        canonicalAction.player,
        completedLines,
        winningLines,
        previousLines,
        canonicalAction,
        effects,
      );
      if (customWin && Number.isInteger(customWin.winner)) {
        this.finishGame(draft, "won", customWin);
        return { ok: true, state: draft, action: canonicalAction, effects };
      }

      const baseWinSuppressed =
        this.ruleEngine.suppressesBaseWin(draft) ||
        Boolean(customWin && customWin.suppressBaseWin);
      if (winningLines.length > 0 && !baseWinSuppressed) {
        this.finishGame(draft, "won", {
          winner: canonicalAction.player,
          loser: app.utils.otherPlayer(canonicalAction.player),
          reason: "line-completed",
          winningLine: winningLines[0],
        });
        return { ok: true, state: draft, action: canonicalAction, effects };
      }

      draft.currentPlayer = app.utils.otherPlayer(canonicalAction.player);
      draft.turnNumber += 1;

      const customDraw = this.ruleEngine.evaluateDraw(draft, canonicalAction);
      if (customDraw) {
        this.finishGame(draft, "draw", customDraw);
        return { ok: true, state: draft, action: canonicalAction, effects };
      }

      const positionKey = this.positionKey(draft);
      draft.positionCounts[positionKey] = (draft.positionCounts[positionKey] || 0) + 1;
      if (draft.positionCounts[positionKey] >= 3) {
        this.finishGame(draft, "draw", {
          reason: "threefold-repetition",
        });
        return { ok: true, state: draft, action: canonicalAction, effects };
      }

      if (draft.actionNumber >= draft.actionLimit) {
        this.finishGame(draft, "draw", {
          reason: "action-limit",
        });
        return { ok: true, state: draft, action: canonicalAction, effects };
      }

      if (this.getLegalActions(draft).length === 0) {
        this.finishGame(draft, "draw", {
          reason: "no-legal-actions",
        });
      }

      return { ok: true, state: draft, action: canonicalAction, effects };
    }

    finishGame(state, status, outcome) {
      state.status = status;
      state.winner = Number.isInteger(outcome.winner) ? outcome.winner : null;
      state.loser = Number.isInteger(outcome.loser) ? outcome.loser : null;
      state.reason = outcome.reason || null;
      state.winningLine = outcome.winningLine ? [...outcome.winningLine] : [];
    }

    positionKey(state) {
      const activeRules = this.ruleEngine.getActiveRules(state);
      const usesPieceAge = activeRules.some((rule) => rule.usesPieceAge);
      const needsGlobalAgeOrder =
        usesPieceAge && activeRules.some((rule) => rule.transfersPieceOwnership);
      const ageRanks = new Map();

      if (usesPieceAge) {
        const owners = needsGlobalAgeOrder ? [null] : [0, 1];
        owners.forEach((owner) => {
          state.board
            .filter((piece) => piece && (owner === null || piece.owner === owner))
            .sort(
              (left, right) =>
                left.createdAt - right.createdAt || left.id - right.id,
            )
            .forEach((piece, rank) => ageRanks.set(piece.id, rank));
        });
      }

      const cells = state.board
        .map((piece) =>
          piece
            ? usesPieceAge
              ? `${piece.owner}:${ageRanks.get(piece.id)}`
              : `${piece.owner}`
            : "-",
        )
        .join(",");
      const ruleSignature = Object.keys(state.rules)
        .sort()
        .filter((ruleId) => state.rules[ruleId].enabled)
        .map((ruleId) => {
          const settings = state.rules[ruleId].settings || {};
          const values = Object.keys(settings)
            .sort()
            .map((key) => `${key}=${settings[key]}`)
            .join(",");
          return `${ruleId}(${values})`;
        })
        .join("+") || "CLASSIC";
      const ruleState = this.ruleEngine.getPositionKeyParts(state).join("|") || "-";
      return `${state.boardSize}|${state.winLength}|${ruleSignature}|${state.currentPlayer}|${ruleState}|${cells}`;
    }

    transpositionKey(state) {
      const repetitions = Object.entries(state.positionCounts)
        .filter(([, count]) => count > 0)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, count]) => `${key}#${count}`)
        .join(";");
      return `${this.positionKey(state)}|actions:${state.actionNumber}/${state.actionLimit}|history:${repetitions}`;
    }
  }

  app.Game = Game;
})(globalThis);
