(function registerMisere(global) {
  "use strict";

  const app = global.SanmokuLab;

  app.ruleRegistry.register({
    id: "MISERE",
    name: "MISÈRE",
    shortDescription: "必要数を並べたプレイヤーが負ける。",
    description:
      "通常の勝利条件を反転します。自分の手で規定数のラインを完成させたプレイヤーが敗北します。",
    categories: ["LOSE_CONDITION", "WIN_CONDITION"],
    priority: 900,
    exactSearchSafe: true,
    conflicts: [],
    settings: [],
    hooks: {
      evaluateLoss(context) {
        if (context.winningLines.length === 0) return null;
        return {
          loser: context.actingPlayer,
          winner: app.utils.otherPlayer(context.actingPlayer),
          reason: "misere-line",
          winningLine: [...new Set(context.winningLines.flat())],
        };
      },
      suppressBaseWin: true,
    },
  });
})(globalThis);
