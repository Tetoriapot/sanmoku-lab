(function registerFlip(global) {
  "use strict";

  const app = global.SanmokuLab;

  app.ruleRegistry.register({
    id: "FLIP",
    name: "FLIP",
    shortDescription: "中央へ新規配置すると、上下左右の隣接敵駒が自分の駒になる。",
    description:
      "中央マスへ新しい駒を配置したとき、上下左右に隣接する敵駒を自分の駒へ反転します。偶数盤では中央4マスのいずれでも発動し、MOVEの移動では発動しません。",
    categories: ["PIECE_EFFECT", "AFTER_PLACE_EFFECT"],
    priority: 600,
    conflicts: [],
    transfersPieceOwnership: true,
    settings: [],
    hooks: {
      afterAction(context) {
        const { draft, action } = context;
        if (action.type !== "place") return [];
        if (!app.board.getCenterIndexes(draft.boardSize).includes(action.target)) {
          return [];
        }

        return app.board
          .getNeighborIndexes(action.target, draft.boardSize, false)
          .filter((index) => {
            const piece = draft.board[index];
            return piece && piece.owner !== action.player;
          })
          .map((index) => {
            const piece = draft.board[index];
            const previousOwner = piece.owner;
            piece.owner = action.player;
            return {
              type: "piece-flipped",
              ruleId: "FLIP",
              index,
              pieceId: piece.id,
              previousOwner,
              owner: action.player,
            };
          });
      },
    },
  });
})(globalThis);
