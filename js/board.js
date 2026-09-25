(function defineBoard(global) {
  "use strict";

  const app = global.SanmokuLab;

  function create(size) {
    return Array.from({ length: size * size }, () => null);
  }

  function toIndex(row, column, size) {
    return row * size + column;
  }

  function toCoordinates(index, size) {
    return {
      row: Math.floor(index / size),
      column: index % size,
    };
  }

  function isInside(row, column, size) {
    return row >= 0 && row < size && column >= 0 && column < size;
  }

  function getWinningLines(board, size, winLength, playerId) {
    const directions = [
      [0, 1],
      [1, 0],
      [1, 1],
      [1, -1],
    ];
    const lines = [];

    for (let row = 0; row < size; row += 1) {
      for (let column = 0; column < size; column += 1) {
        for (const [rowStep, columnStep] of directions) {
          const endRow = row + rowStep * (winLength - 1);
          const endColumn = column + columnStep * (winLength - 1);
          if (!isInside(endRow, endColumn, size)) continue;

          const line = [];
          let complete = true;

          for (let offset = 0; offset < winLength; offset += 1) {
            const index = toIndex(
              row + rowStep * offset,
              column + columnStep * offset,
              size,
            );
            const piece = board[index];
            if (!piece || piece.owner !== playerId) {
              complete = false;
              break;
            }
            line.push(index);
          }

          if (complete) lines.push(line);
        }
      }
    }

    return lines;
  }

  function getCenterIndexes(size) {
    if (size % 2 === 1) {
      const middle = Math.floor(size / 2);
      return [toIndex(middle, middle, size)];
    }

    const upper = size / 2 - 1;
    const lower = size / 2;
    return [
      toIndex(upper, upper, size),
      toIndex(upper, lower, size),
      toIndex(lower, upper, size),
      toIndex(lower, lower, size),
    ];
  }

  function countPieces(board, playerId) {
    return board.reduce(
      (count, piece) => count + (piece && piece.owner === playerId ? 1 : 0),
      0,
    );
  }

  function getNeighborIndexes(index, size, includeDiagonals) {
    const { row, column } = toCoordinates(index, size);
    const directions = includeDiagonals
      ? [
          [-1, -1],
          [-1, 0],
          [-1, 1],
          [0, -1],
          [0, 1],
          [1, -1],
          [1, 0],
          [1, 1],
        ]
      : [
          [-1, 0],
          [0, -1],
          [0, 1],
          [1, 0],
        ];

    return directions
      .map(([rowStep, columnStep]) => ({
        row: row + rowStep,
        column: column + columnStep,
      }))
      .filter((candidate) => isInside(candidate.row, candidate.column, size))
      .map((candidate) => toIndex(candidate.row, candidate.column, size));
  }

  app.board = Object.freeze({
    create,
    toIndex,
    toCoordinates,
    isInside,
    getWinningLines,
    getCenterIndexes,
    countPieces,
    getNeighborIndexes,
  });
})(globalThis);
