(function initNamespace(global) {
  "use strict";

  const app = global.SanmokuLab || {};

  app.VERSION = "0.2.0";
  app.PLAYERS = Object.freeze([
    Object.freeze({ id: 0, name: "PLAYER 1", mark: "○" }),
    Object.freeze({ id: 1, name: "PLAYER 2", mark: "×" }),
  ]);

  app.utils = Object.freeze({
    clone(value) {
      if (typeof global.structuredClone === "function") {
        return global.structuredClone(value);
      }
      return JSON.parse(JSON.stringify(value));
    },

    clampInteger(value, minimum, maximum, fallback) {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed)) return fallback;
      return Math.min(maximum, Math.max(minimum, parsed));
    },

    otherPlayer(playerId) {
      return playerId === 0 ? 1 : 0;
    },
  });

  global.SanmokuLab = app;
})(globalThis);
