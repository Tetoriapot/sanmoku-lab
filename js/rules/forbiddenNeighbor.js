(function registerForbiddenNeighbor(global) {
  "use strict";

  const app = global.SanmokuLab;

  app.ruleRegistry.register({
    id: "FORBIDDEN_NEIGHBOR",
    name: "FORBIDDEN NEIGHBOR",
    shortDescription: "直前の配置マスに隣接する上下左右へ、次の手では配置できない。",
    description:
      "直前に新規配置されたマスの上下左右は、次のプレイヤーの配置先にできません。制限はその1手だけで、MOVEの移動先には適用されません。GRAVITYでは最終的な落下先を判定します。",
    categories: ["PLACEMENT_RESTRICTION"],
    priority: 150,
    conflicts: [],
    settings: [],
    hooks: {
      validateDestination(context) {
        const { state, target, action } = context;
        if (!action || action.type !== "place") return true;
        if (!state.lastAction || state.lastAction.type !== "place") return true;
        return !app.board
          .getNeighborIndexes(state.lastAction.target, state.boardSize, false)
          .includes(target);
      },
      positionKey(context) {
        const action = context.state.lastAction;
        const appliesThisTurn =
          context.engine.getActionMode(
            context.state,
            context.state.currentPlayer,
          ) === "place";
        return appliesThisTurn && action && action.type === "place"
          ? action.target
          : "-";
      },
    },
  });
})(globalThis);
