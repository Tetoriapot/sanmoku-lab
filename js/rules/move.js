(function registerMove(global) {
  "use strict";

  const app = global.SanmokuLab;

  app.ruleRegistry.register({
    id: "MOVE",
    name: "MOVE",
    shortDescription: "規定数を配置したら、新規配置の代わりに自分の駒を移動する。",
    description:
      "自分が設定数の駒を配置し終えた後は、自分の駒を1つ選び、別の合法マスへ移動します。VANISHで駒が消えても配置フェーズには戻らず、移動しても駒の古さは維持されます。",
    categories: ["MOVE_RULE"],
    priority: 200,
    conflicts: [],
    settings: [
      {
        key: "threshold",
        label: "移動までの累計配置数",
        type: "number",
        min: 1,
        max: 25,
        step: 1,
        default: 3,
        unit: "個",
      },
    ],
    hooks: {
      determineActionMode(context) {
        const placements = context.state.stats[context.player].placements;
        return placements >= context.config.settings.threshold ? "move" : context.mode;
      },
      positionKey(context) {
        const threshold = context.config.settings.threshold;
        return context.state.stats
          .map((playerStats) => Math.min(playerStats.placements, threshold))
          .join(":");
      },
    },
  });
})(globalThis);
