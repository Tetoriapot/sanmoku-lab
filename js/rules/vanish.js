(function registerVanish(global) {
  "use strict";

  const app = global.SanmokuLab;

  app.ruleRegistry.register({
    id: "VANISH",
    name: "VANISH",
    shortDescription: "上限を超えると、最も古い自分の駒が消える。",
    description:
      "新しい駒を置いて自分の駒が上限を超えたとき、盤上で最も古い自分の駒を取り除きます。移動した駒の古さは変わりません。",
    categories: ["TURN_END_EFFECT"],
    priority: 700,
    conflicts: [],
    usesPieceAge: true,
    settings: [
      {
        key: "maxPieces",
        label: "盤上に残せる駒",
        type: "number",
        min: 2,
        max: 25,
        step: 1,
        default: 3,
        unit: "個",
      },
    ],
    hooks: {
      afterAction(context) {
        const { draft, action, config } = context;
        if (action.type !== "place") return [];

        const ownPieces = draft.board
          .map((piece, index) => ({ piece, index }))
          .filter(({ piece }) => piece && piece.owner === action.player)
          .sort((left, right) => left.piece.createdAt - right.piece.createdAt);

        const removed = [];
        while (ownPieces.length > config.settings.maxPieces) {
          const oldest = ownPieces.shift();
          draft.board[oldest.index] = null;
          removed.push({
            index: oldest.index,
            piece: { ...oldest.piece },
          });
        }

        return removed.map(({ index, piece }) => ({
          type: "piece-removed",
          ruleId: "VANISH",
          index,
          piece,
        }));
      },
    },
  });
})(globalThis);
