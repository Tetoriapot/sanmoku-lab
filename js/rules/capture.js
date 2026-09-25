(function registerCapture(global) {
  "use strict";

  const app = global.SanmokuLab;
  const DIRECTIONS = [
    [-1, 0],
    [0, -1],
    [0, 1],
    [1, 0],
  ];

  app.ruleRegistry.register({
    id: "CAPTURE",
    name: "CAPTURE",
    shortDescription: "行動先の駒と自分の駒で挟んだ敵駒を取り除く。",
    description:
      "配置または移動した駒から上下左右を調べ、自分の駒で挟んだ連続する敵駒をすべて取り除きます。複数方向の挟み取りは同時に処理し、斜め方向は対象外です。",
    categories: ["CAPTURE_RULE", "AFTER_PLACE_EFFECT"],
    priority: 500,
    conflicts: [],
    settings: [],
    hooks: {
      afterAction(context) {
        const { draft, action } = context;
        const origin = app.board.toCoordinates(action.target, draft.boardSize);
        const captured = new Set();

        for (const [rowStep, columnStep] of DIRECTIONS) {
          const bracketed = [];
          let row = origin.row + rowStep;
          let column = origin.column + columnStep;

          while (app.board.isInside(row, column, draft.boardSize)) {
            const index = app.board.toIndex(row, column, draft.boardSize);
            const piece = draft.board[index];
            if (!piece) break;
            if (piece.owner === action.player) {
              if (bracketed.length > 0) {
                bracketed.forEach((capturedIndex) => captured.add(capturedIndex));
              }
              break;
            }
            bracketed.push(index);
            row += rowStep;
            column += columnStep;
          }
        }

        return [...captured]
          .sort((left, right) => left - right)
          .map((index) => {
            const piece = draft.board[index];
            draft.board[index] = null;
            return {
              type: "piece-removed",
              ruleId: "CAPTURE",
              index,
              piece: { ...piece },
            };
          });
      },
    },
  });
})(globalThis);
