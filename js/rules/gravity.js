(function registerGravity(global) {
  "use strict";

  const app = global.SanmokuLab;

  app.ruleRegistry.register({
    id: "GRAVITY",
    name: "GRAVITY",
    shortDescription: "指定した列の最も下にある合法マスへ駒が落ちる。",
    description:
      "行ではなく列を選びます。駒はその列の最下段から空きを探して落下します。NO CENTERの禁止マスは障害物として扱います。",
    categories: ["PLACEMENT_RESTRICTION"],
    priority: 300,
    exactSearchSafe: true,
    conflicts: [],
    settings: [],
    hooks: {
      resolveTarget(context) {
        const { state, requestedTarget, source, actionType, engine } = context;
        const { column } = app.board.toCoordinates(requestedTarget, state.boardSize);

        for (let row = state.boardSize - 1; row >= 0; row -= 1) {
          const candidate = app.board.toIndex(row, column, state.boardSize);
          const occupied = candidate === source ? false : Boolean(state.board[candidate]);
          if (occupied) continue;

          const allowed = engine.isDestinationAllowed(
            state,
            candidate,
            {
              type: actionType,
              source,
              requestedTarget,
              player: state.currentPlayer,
            },
          );
          if (allowed) return candidate;
        }

        return null;
      },
    },
  });
})(globalThis);
