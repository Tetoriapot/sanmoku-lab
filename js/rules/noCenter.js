(function registerNoCenter(global) {
  "use strict";

  const app = global.SanmokuLab;

  app.ruleRegistry.register({
    id: "NO_CENTER",
    name: "NO CENTER",
    shortDescription: "盤面の中央を使用禁止にする。",
    description:
      "奇数盤では中央1マス、偶数盤では中央4マスを配置・移動先として使用できません。",
    categories: ["BOARD_MODIFIER", "PLACEMENT_RESTRICTION"],
    priority: 100,
    exactSearchSafe: true,
    conflicts: [],
    settings: [],
    hooks: {
      validateDestination(context) {
        const centers = app.board.getCenterIndexes(context.state.boardSize);
        return !centers.includes(context.target);
      },
    },
  });
})(globalThis);
