(function registerKing(global) {
  "use strict";

  const app = global.SanmokuLab;

  function getKingState(state) {
    if (!state.ruleState.KING) {
      state.ruleState.KING = { kingIds: [null, null] };
    }
    return state.ruleState.KING;
  }

  app.ruleRegistry.register({
    id: "KING",
    name: "KING",
    shortDescription: "各プレイヤーの最初の駒がKINGになり、失うと敗北する。",
    description:
      "各プレイヤーが最初に新規配置した駒をKINGとします。KINGはMOVEしても身分を維持し、CAPTUREやVANISHで除去された場合、またはFLIPで敵駒になった場合に元の所有者が敗北します。",
    categories: ["PIECE_EFFECT", "LOSE_CONDITION"],
    priority: 800,
    conflicts: [],
    settings: [],
    hooks: {
      afterAction(context) {
        const { draft, action } = context;
        if (action.type !== "place") return [];
        const kingState = getKingState(draft);
        if (Number.isInteger(kingState.kingIds[action.player])) return [];
        const piece = draft.board[action.target];
        if (!piece || piece.owner !== action.player) return [];

        kingState.kingIds[action.player] = piece.id;
        piece.kingFor = action.player;
        return [{
          type: "king-designated",
          ruleId: "KING",
          index: action.target,
          pieceId: piece.id,
          player: action.player,
        }];
      },
      evaluateLoss(context) {
        const kingState = context.state.ruleState.KING;
        if (!kingState) return null;
        const lostPlayers = kingState.kingIds
          .map((pieceId, player) => ({ pieceId, player }))
          .filter(({ pieceId, player }) => {
            if (!Number.isInteger(pieceId)) return false;
            const piece = context.state.board.find((candidate) => candidate && candidate.id === pieceId);
            return !piece || piece.owner !== player;
          })
          .map(({ player }) => player);
        if (lostPlayers.length === 0) return null;

        const loser = lostPlayers.includes(context.actingPlayer)
          ? context.actingPlayer
          : lostPlayers[0];
        return {
          loser,
          winner: app.utils.otherPlayer(loser),
          reason: "king-lost",
          winningLine: [],
        };
      },
      positionKey(context) {
        const kingState = context.state.ruleState.KING;
        if (!kingState) return "-/-";
        return kingState.kingIds
          .map((pieceId) => {
            if (!Number.isInteger(pieceId)) return "-";
            const index = context.state.board.findIndex(
              (piece) => piece && piece.id === pieceId,
            );
            if (index < 0) return "X";
            return `${index}:${context.state.board[index].owner}`;
          })
          .join("/");
      },
    },
  });
})(globalThis);
