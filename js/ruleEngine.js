(function defineRuleEngine(global) {
  "use strict";

  const app = global.SanmokuLab;

  class RuleEngine {
    constructor(registry) {
      this.registry = registry;
    }

    getActiveRules(state) {
      return this.registry
        .getAll()
        .filter((rule) => state.rules[rule.id] && state.rules[rule.id].enabled);
    }

    getActionMode(state, playerId) {
      let mode = "place";
      for (const rule of this.getActiveRules(state)) {
        if (typeof rule.hooks.determineActionMode !== "function") continue;
        mode =
          rule.hooks.determineActionMode({
            state,
            player: playerId,
            mode,
            config: state.rules[rule.id],
            engine: this,
          }) || mode;
      }
      return mode;
    }

    isDestinationAllowed(state, target, action) {
      if (!Number.isInteger(target) || target < 0 || target >= state.board.length) {
        return false;
      }

      const source = action && Number.isInteger(action.source) ? action.source : null;
      if (state.board[target] && target !== source) return false;

      for (const rule of this.getActiveRules(state)) {
        if (typeof rule.hooks.validateDestination !== "function") continue;
        const allowed = rule.hooks.validateDestination({
          state,
          target,
          action,
          config: state.rules[rule.id],
          engine: this,
        });
        if (allowed === false) return false;
      }

      return true;
    }

    resolveTarget(state, requestedTarget, action) {
      let target = requestedTarget;

      for (const rule of this.getActiveRules(state)) {
        if (typeof rule.hooks.resolveTarget !== "function") continue;
        target = rule.hooks.resolveTarget({
          state,
          target,
          requestedTarget,
          source: action.source,
          actionType: action.type,
          config: state.rules[rule.id],
          engine: this,
        });
        if (target === null || target === undefined) return null;
      }

      return target;
    }

    runAfterAction(draft, action) {
      const effects = [];
      for (const rule of this.getActiveRules(draft)) {
        if (typeof rule.hooks.afterAction !== "function") continue;
        const ruleEffects = rule.hooks.afterAction({
          draft,
          action,
          effects,
          config: draft.rules[rule.id],
          engine: this,
        });
        if (Array.isArray(ruleEffects)) effects.push(...ruleEffects);
      }
      return effects;
    }

    qualifyWinningLines(state, actingPlayer, completedLines, previousLines, action, effects) {
      let winningLines = completedLines.map((line) => [...line]);
      for (const rule of this.getActiveRules(state)) {
        if (typeof rule.hooks.qualifyWinningLines !== "function") continue;
        const decision = rule.hooks.qualifyWinningLines({
          state,
          actingPlayer,
          action,
          effects,
          completedLines,
          previousLines,
          winningLines,
          config: state.rules[rule.id],
          engine: this,
        });
        if (Array.isArray(decision)) {
          winningLines = decision.map((line) => [...line]);
        }
      }
      return winningLines;
    }

    needsPreviousWinningLines(state) {
      return this.getActiveRules(state).some(
        (rule) => typeof rule.hooks.qualifyWinningLines === "function",
      );
    }

    evaluateLoss(state, actingPlayer, completedLines, winningLines, previousLines, action, effects) {
      for (const rule of this.getActiveRules(state)) {
        if (typeof rule.hooks.evaluateLoss !== "function") continue;
        const outcome = rule.hooks.evaluateLoss({
          state,
          actingPlayer,
          action,
          effects,
          completedLines,
          winningLines,
          previousLines,
          config: state.rules[rule.id],
          engine: this,
        });
        if (outcome) return outcome;
      }
      return null;
    }

    suppressesBaseWin(state) {
      return this.getActiveRules(state).some(
        (rule) => rule.hooks.suppressBaseWin === true,
      );
    }

    evaluateWin(state, actingPlayer, completedLines, winningLines, previousLines, action, effects) {
      for (const rule of this.getActiveRules(state)) {
        if (typeof rule.hooks.evaluateWin !== "function") continue;
        const decision = rule.hooks.evaluateWin({
          state,
          actingPlayer,
          action,
          effects,
          completedLines,
          winningLines,
          previousLines,
          config: state.rules[rule.id],
          engine: this,
        });
        if (decision) return decision;
      }
      return null;
    }

    evaluateDraw(state, action) {
      for (const rule of this.getActiveRules(state)) {
        if (typeof rule.hooks.evaluateDraw !== "function") continue;
        const outcome = rule.hooks.evaluateDraw({
          state,
          action,
          config: state.rules[rule.id],
          engine: this,
        });
        if (outcome) return outcome;
      }
      return null;
    }

    getPositionKeyParts(state) {
      const parts = [];
      for (const rule of this.getActiveRules(state)) {
        if (typeof rule.hooks.positionKey !== "function") continue;
        const value = rule.hooks.positionKey({
          state,
          config: state.rules[rule.id],
          engine: this,
        });
        if (value !== null && value !== undefined && value !== "") {
          parts.push(`${rule.id}:${value}`);
        }
      }
      return parts;
    }

    describeActiveRules(state) {
      return this.getActiveRules(state).map((rule) => ({
        ...rule,
        config: app.utils.clone(state.rules[rule.id]),
      }));
    }
  }

  app.RuleEngine = RuleEngine;
})(globalThis);
