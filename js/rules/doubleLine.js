(function registerDoubleLine(global) {
  "use strict";

  const app = global.SanmokuLab;

  function axisKey(line, boardSize) {
    const first = app.board.toCoordinates(line[0], boardSize);
    const last = app.board.toCoordinates(line[line.length - 1], boardSize);
    if (first.row === last.row) return `H:${first.row}`;
    if (first.column === last.column) return `V:${first.column}`;
    return (last.row - first.row) * (last.column - first.column) > 0
      ? `D:${first.row - first.column}`
      : `A:${first.row + first.column}`;
  }

  app.ruleRegistry.register({
    id: "DOUBLE_LINE",
    name: "DOUBLE LINE",
    shortDescription: "一手で新しく2本以上のラインを完成させた場合だけ勝利する。",
    description:
      "1本だけでは勝利になりません。その行動前には存在しなかった別々の直線を、一手で同時に2本以上完成させた場合だけ勝利します。同一直線上の重複区間は1本として数えます。MISÈREとの併用時は同じ条件を満たしたプレイヤーが敗北します。",
    categories: ["WIN_CONDITION"],
    priority: 950,
    conflicts: [],
    settings: [],
    hooks: {
      qualifyWinningLines(context) {
        const previousAxes = new Set(
          context.previousLines.map((line) => axisKey(line, context.state.boardSize)),
        );
        const newAxes = new Map();
        for (const line of context.completedLines) {
          const key = axisKey(line, context.state.boardSize);
          if (previousAxes.has(key)) continue;
          const cells = newAxes.get(key) || new Set();
          line.forEach((index) => cells.add(index));
          newAxes.set(key, cells);
        }
        return newAxes.size >= 2
          ? [...newAxes.values()].map((cells) => [...cells].sort((a, b) => a - b))
          : [];
      },
      evaluateWin(context) {
        if (context.winningLines.length < 2) return null;
        return {
          winner: context.actingPlayer,
          loser: app.utils.otherPlayer(context.actingPlayer),
          reason: "double-line",
          winningLine: [...new Set(context.winningLines.flat())],
        };
      },
    },
  });
})(globalThis);
