(function defineUI(global) {
  "use strict";

  const app = global.SanmokuLab;
  const WATCH_SPEEDS = {
    slow: { label: "ゆっくり", delay: 1200 },
    normal: { label: "標準", delay: 650 },
    fast: { label: "高速", delay: 180 },
  };

  class UI {
    constructor(root) {
      this.root = root;
      this.announcer = document.getElementById("announcer");
      this.game = new app.Game({});
      this.labSettings = this.game.getSettings();
      this.labMatchMode = "pvp";
      this.matchMode = "pvp";
      this.screen = "home";
      this.selectedSource = null;
      this.notice = "";
      this.pendingFocus = null;
      this.cpuThinking = false;
      this.cpuTimer = null;
      this.cpuRequestToken = 0;
      this.lastCpuSearch = null;
      this.watchPaused = false;
      this.watchSpeed = "normal";
      this.watchStepPending = false;
      this.announceNextNotice = true;
      this.announceTimer = null;
      this.bindEvents();
      this.render();
    }

    bindEvents() {
      document.addEventListener("click", (event) => {
        const navButton = event.target.closest("[data-nav]");
        if (navButton) {
          this.navigate(navButton.dataset.nav);
          return;
        }

        const actionButton = event.target.closest("[data-action]");
        if (!actionButton || actionButton.disabled) return;
        this.handleAction(actionButton, event.detail);
      });

      document.addEventListener("change", (event) => {
        const target = event.target;
        if (target.matches("[data-rule-toggle]")) {
          this.setRuleEnabled(target.dataset.ruleToggle, target.checked);
        } else if (target.matches("[data-win-length]")) {
          this.labSettings.winLength = Number.parseInt(target.value, 10);
          this.render();
        } else if (target.matches("[data-rule-setting]")) {
          this.setRuleSetting(
            target.dataset.ruleId,
            target.dataset.ruleSetting,
            target.value,
          );
        } else if (target.matches("[data-watch-speed]")) {
          this.setWatchSpeed(target.value);
        }
      });
    }

    handleAction(button, clickCount = 1) {
      const action = button.dataset.action;

      if (clickCount > 1 && ["board-cell", "drop-column"].includes(action)) {
        return;
      }

      if (action === "open-screen") {
        this.navigate(button.dataset.screen);
      } else if (action === "quick-play" || action === "start-match") {
        this.startMatch();
      } else if (action === "cpu-play") {
        this.labMatchMode = "cpu";
        this.startMatch();
      } else if (action === "watch-play") {
        this.labMatchMode = "watch";
        this.startMatch();
      } else if (action === "pvp-play") {
        this.labMatchMode = "pvp";
        this.startMatch();
      } else if (action === "set-match-mode") {
        this.labMatchMode = ["cpu", "watch"].includes(button.dataset.mode)
          ? button.dataset.mode
          : "pvp";
        const reason = this.cpuUnsupportedReason(this.labSettings, this.labMatchMode);
        const labels = {
          pvp: "PLAYER VS PLAYER",
          cpu: "PLAYER VS CPU",
          watch: "CPU VS CPU観戦",
        };
        const profile = this.cpuSearchProfile(this.labSettings, this.labMatchMode);
        this.notice = this.labMatchMode === "pvp"
          ? `${labels.pvp}を選択しました。`
          : `${labels[this.labMatchMode]}を選択しました。${reason || `${profile.label}を使用します。`}`;
        this.render();
      } else if (action === "set-board-size") {
        this.setBoardSize(Number.parseInt(button.dataset.size, 10));
      } else if (action === "step-setting") {
        this.stepRuleSetting(
          button.dataset.ruleId,
          button.dataset.settingKey,
          Number.parseInt(button.dataset.delta, 10),
        );
      } else if (action === "reset-lab") {
        this.labSettings = new app.Game({}).getSettings();
        this.labMatchMode = "pvp";
        this.notice = "RULE LABを初期設定へ戻しました。";
        this.render();
      } else if (action === "board-cell") {
        this.handleBoardCell(Number.parseInt(button.dataset.index, 10));
      } else if (action === "drop-column") {
        this.handleDropColumn(Number.parseInt(button.dataset.column, 10));
      } else if (action === "undo") {
        this.undoTurn();
      } else if (action === "restart") {
        this.restartMatch();
      } else if (action === "toggle-watch") {
        this.toggleWatchPlayback();
      } else if (action === "watch-step") {
        this.stepWatchMatch();
      } else if (action === "edit-rules") {
        this.cancelCpuTurn();
        this.labSettings = this.game.getSettings();
        this.labMatchMode = this.matchMode;
        this.navigate("lab");
      }
    }

    navigate(screen) {
      if (!new Set(["home", "play", "lab", "book"]).has(screen)) return;
      if (screen === this.screen) return;
      if (this.screen === "play" && screen !== "play") this.cancelCpuTurn();
      if (screen === "play" && this.screen !== "play") {
        this.screen = "play";
        this.selectedSource = null;
        const state = this.game.getState();
        const cpuTurn = this.isCpuTurn(state);
        const watchCanRun = this.matchMode !== "watch" || !this.watchPaused;
        const shouldRun = cpuTurn && watchCanRun;
        this.cpuThinking = shouldRun;
        const profile = this.cpuSearchProfile(state, this.matchMode);
        this.notice = state.status !== "playing"
          ? "終了した対局へ戻りました。"
          : this.matchMode === "watch" && this.watchPaused
            ? "観戦画面へ戻りました。対局は一時停止中です。"
            : shouldRun
              ? `対局画面に戻りました。${profile.kind === "strategic" ? "CPUが制限内で候補手を評価しています。" : "CPUが最善手を考えています。"}`
              : "対局画面に戻りました。";
        this.pendingFocus = state.status !== "playing"
          ? "outcome"
          : this.matchMode === "watch"
            ? "watch-controls"
            : cpuTurn
              ? "cpu-status"
              : "next-action";
        this.render();
        if (shouldRun) this.queueCpuTurn();
        return;
      }
      this.screen = screen;
      this.selectedSource = null;
      this.notice = "";
      this.pendingFocus = "screen-heading";
      this.render();
      const reduceMotion = typeof global.matchMedia === "function" &&
        global.matchMedia("(prefers-reduced-motion: reduce)").matches;
      global.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    }

    startMatch() {
      this.cancelCpuTurn();
      const unsupportedReason = this.cpuUnsupportedReason(this.labSettings, this.labMatchMode);
      if (unsupportedReason) {
        this.screen = "lab";
        this.notice = "CPU対戦を開始できません。対応設定の説明へ移動しました。";
        this.pendingFocus = "cpu-warning";
        this.render();
        return;
      }
      this.game.configure(this.labSettings);
      this.labSettings = this.game.getSettings();
      this.matchMode = this.labMatchMode;
      this.screen = "play";
      this.selectedSource = null;
      this.lastCpuSearch = null;
      this.watchPaused = false;
      this.watchStepPending = false;
      const state = this.game.getState();
      const cpuTurn = this.isCpuTurn(state);
      this.cpuThinking = cpuTurn;
      const profile = this.cpuSearchProfile(state, this.matchMode);
      this.notice = this.matchMode === "watch"
        ? `CPU 1とCPU 2の観戦対局を開始しました。${profile.label}を使用します。自動再生中の各手は画面表示のみです。読み上げる場合は一時停止して1手進めるを使用してください。`
        : this.matchMode === "cpu"
          ? `PLAYER 1対CPUの対局を開始しました。${profile.label}を使用します。`
          : "新しい対局を開始しました。";
      this.pendingFocus = this.matchMode === "watch" ? "watch-controls" : "next-action";
      this.render();
      if (cpuTurn) this.queueCpuTurn();
    }

    restartMatch() {
      const keepWatchPaused = this.matchMode === "watch" && this.watchPaused;
      this.cancelCpuTurn();
      this.game.restart();
      this.selectedSource = null;
      this.lastCpuSearch = null;
      this.watchPaused = keepWatchPaused;
      const state = this.game.getState();
      const shouldRun = this.isCpuTurn(state) && !keepWatchPaused;
      this.cpuThinking = shouldRun;
      this.notice = this.matchMode === "watch"
        ? keepWatchPaused
          ? "同じルールで盤面を初期化しました。観戦は一時停止中です。"
          : "同じルールで観戦対局を再開しました。"
        : "同じルールで対局を再開しました。";
      this.pendingFocus = this.matchMode === "watch" ? "watch-controls" : "next-action";
      this.render();
      if (shouldRun) this.queueCpuTurn();
    }

    setBoardSize(size) {
      const previousProfile = this.cpuSearchProfile(this.labSettings, this.labMatchMode);
      const previousWarnings = this.getLabWarnings();
      const previousWinLength = this.labSettings.winLength;
      this.labSettings.boardSize = size;
      this.labSettings.winLength = Math.min(this.labSettings.winLength, size);
      const nextProfile = this.cpuSearchProfile(this.labSettings, this.labMatchMode);
      this.notice = [
        `盤面を${size}×${size}に変更しました。`,
        previousWinLength !== this.labSettings.winLength
          ? `勝利条件も${this.labSettings.winLength}個並べるへ調整しました。`
          : "",
        this.searchProfileChangeText(previousProfile, nextProfile),
        this.newLabWarningText(previousWarnings),
      ].filter(Boolean).join(" ");
      this.render();
    }

    setRuleEnabled(ruleId, enabled) {
      if (!this.labSettings.rules[ruleId]) return;
      const rule = app.ruleRegistry.get(ruleId);
      const previousProfile = this.cpuSearchProfile(this.labSettings, this.labMatchMode);
      const previousWarnings = this.getLabWarnings();
      this.labSettings.rules[ruleId].enabled = enabled;
      const nextProfile = this.cpuSearchProfile(this.labSettings, this.labMatchMode);
      this.notice = [
        `${rule ? rule.name : ruleId}を${enabled ? "有効" : "無効"}にしました。`,
        this.searchProfileChangeText(previousProfile, nextProfile),
        this.newLabWarningText(previousWarnings),
      ].filter(Boolean).join(" ");
      this.render();
    }

    setRuleSetting(ruleId, settingKey, rawValue) {
      const rule = app.ruleRegistry.get(ruleId);
      const setting = rule && rule.settings.find((item) => item.key === settingKey);
      if (!setting) return;
      const previousWarnings = this.getLabWarnings();
      this.labSettings.rules[ruleId].settings[settingKey] = app.utils.clampInteger(
        rawValue,
        setting.min,
        setting.max,
        setting.default,
      );
      this.notice = [
        `${rule.name}の${setting.label}を${this.labSettings.rules[ruleId].settings[settingKey]}${setting.unit || ""}に変更しました。`,
        this.newLabWarningText(previousWarnings),
      ].filter(Boolean).join(" ");
      this.render();
    }

    stepRuleSetting(ruleId, settingKey, delta) {
      const rule = app.ruleRegistry.get(ruleId);
      const setting = rule && rule.settings.find((item) => item.key === settingKey);
      if (!setting) return;
      const current = this.labSettings.rules[ruleId].settings[settingKey];
      this.setRuleSetting(ruleId, settingKey, current + delta * (setting.step || 1));
    }

    setWatchSpeed(speed) {
      if (!WATCH_SPEEDS[speed]) return;
      const shouldReschedule =
        this.matchMode === "watch" &&
        this.screen === "play" &&
        !this.watchPaused &&
        this.game.getState().status === "playing";
      if (shouldReschedule) this.cancelCpuTurn();
      this.watchSpeed = speed;
      this.notice = `観戦速度を「${WATCH_SPEEDS[speed].label}」に変更しました。`;
      if (shouldReschedule) this.cpuThinking = true;
      this.render();
      if (shouldReschedule) this.queueCpuTurn();
    }

    toggleWatchPlayback() {
      if (this.matchMode !== "watch" || this.game.getState().status !== "playing") return;
      if (this.watchPaused) {
        this.cancelCpuTurn();
        this.watchPaused = false;
        this.cpuThinking = true;
        this.notice = "CPU同士の対局を再生します。";
        this.render();
        this.queueCpuTurn();
      } else {
        this.cancelCpuTurn();
        this.watchPaused = true;
        this.notice = "CPU同士の対局を一時停止しました。";
        this.render();
      }
    }

    stepWatchMatch() {
      const state = this.game.getState();
      if (
        this.matchMode !== "watch" ||
        !this.watchPaused ||
        this.cpuThinking ||
        state.status !== "playing"
      ) {
        return;
      }
      this.cancelCpuTurn();
      this.watchPaused = true;
      this.watchStepPending = true;
      this.cpuThinking = true;
      this.notice = `${this.displayPlayerName(state.currentPlayer)}の手を1手進めます。`;
      this.pendingFocus = "watch-controls";
      this.render();
      this.queueCpuTurn({ singleStep: true });
    }

    handleBoardCell(index) {
      const state = this.game.getState();
      if (state.status !== "playing" || this.cpuThinking || this.isCpuTurn(state)) return;
      const mode = this.game.getActionMode();

      if (mode === "move") {
        const piece = state.board[index];
        if (piece && piece.owner === state.currentPlayer) {
          this.selectedSource = this.selectedSource === index ? null : index;
          this.notice = this.selectedSource === null ? "選択を解除しました。" : "移動先を選んでください。";
          if (this.selectedSource !== null && state.rules.GRAVITY.enabled) {
            this.pendingFocus = "move-destination";
          }
          this.render();
          return;
        }
        if (this.selectedSource === null) {
          this.notice = "先に移動する自分の駒を選んでください。";
          this.render();
          return;
        }
      }

      this.commitAction({ type: mode, source: this.selectedSource, requestedTarget: index });
    }

    handleDropColumn(column) {
      const state = this.game.getState();
      if (state.status !== "playing" || this.cpuThinking || this.isCpuTurn(state)) return;
      const mode = this.game.getActionMode();
      if (mode === "move" && this.selectedSource === null) {
        this.notice = "先に移動する自分の駒を選んでください。";
        this.render();
        return;
      }
      this.commitAction({
        type: mode,
        source: this.selectedSource,
        requestedTarget: column,
      });
    }

    commitAction(action) {
      if (this.cpuThinking || this.isCpuTurn(this.game.getState())) return;
      const result = this.game.performAction(action);
      if (!result.ok) {
        this.notice = this.messageForInvalidAction(result.reason);
      } else {
        this.selectedSource = null;
        this.notice = this.describeCompletedAction(result);
        const completedProfile = this.cpuSearchProfile(result.state, this.matchMode);
        if (
          result.state.status !== "playing" &&
          completedProfile.kind === "strategic"
        ) {
          this.notice += ` ${this.strategicResultScope()}`;
        }
        const cpuTurn = this.isCpuTurn(result.state);
        this.cpuThinking = cpuTurn;
        if (cpuTurn) {
          const profile = this.cpuSearchProfile(result.state, this.matchMode);
          this.notice += profile.kind === "strategic"
            ? " CPUが制限内で候補手を評価しています。"
            : " CPUが最善手を考えています。";
        }
        this.pendingFocus = result.state.status === "playing" ? (cpuTurn ? "cpu-status" : "next-action") : "outcome";
      }
      this.render();
      if (result.ok && this.isCpuTurn(result.state)) this.queueCpuTurn();
    }

    describeCompletedAction(result) {
      const state = result.state;
      const action = result.action;
      const actor = app.PLAYERS[action.player];
      const actorName = this.displayPlayerName(action.player);
      const coordinates = app.board.toCoordinates(action.target, state.boardSize);
      const actionText = action.type === "move" && Number.isInteger(action.source)
        ? (() => {
            const source = app.board.toCoordinates(action.source, state.boardSize);
            return `${actorName}が${source.row + 1}行${source.column + 1}列から${coordinates.row + 1}行${coordinates.column + 1}列へ${actor.mark}を移動しました。`;
          })()
        : `${actorName}が${coordinates.row + 1}行${coordinates.column + 1}列へ${actor.mark}を配置しました。`;
      const effectText = this.describeActionEffects(result.effects, state);
      const restrictionText =
        state.status === "playing" &&
        action.type === "place" &&
        state.rules.FORBIDDEN_NEIGHBOR.enabled
          ? " 次の手では、その配置先の上下左右へ新規配置できません。"
          : "";

      if (state.status === "won") {
        const reason = state.reason === "king-lost"
          ? ` ${this.displayPlayerName(state.loser)}のKINGが失われました。`
          : state.reason === "double-line"
            ? " 新しいラインを同時に2本以上完成させました。"
            : state.reason === "misere-line" && state.rules.DOUBLE_LINE.enabled
              ? " DOUBLE LINE条件を満たしたため、MISÈREで敗北しました。"
              : "";
        return `${actionText}${effectText}${reason} ${this.displayPlayerName(state.winner)}の勝利です。`;
      }
      if (state.status === "draw") {
        const reason = state.reason === "threefold-repetition"
          ? "同一局面が3回現れたため"
          : state.reason === "action-limit"
            ? `対局が${state.actionLimit}手の上限に達したため`
            : "合法手がないため";
        return `${actionText}${effectText} ${reason}引き分けです。`;
      }
      return `${actionText}${effectText}${restrictionText} 次は${this.displayPlayerName(state.currentPlayer)}の手番です。`;
    }

    describeActionEffects(effects, state) {
      const descriptions = [];
      const capture = effects.filter((effect) => effect.ruleId === "CAPTURE");
      const flip = effects.filter((effect) => effect.ruleId === "FLIP");
      const vanish = effects.filter((effect) => effect.ruleId === "VANISH");
      const kings = effects.filter((effect) => effect.type === "king-designated");

      if (capture.length > 0) {
        descriptions.push(
          `CAPTUREで${this.formatEffectCoordinates(capture, state)}の敵駒${capture.length}個を除去しました。`,
        );
      }
      if (flip.length > 0) {
        descriptions.push(
          `FLIPで${this.formatEffectCoordinates(flip, state)}の敵駒${flip.length}個を反転しました。`,
        );
      }
      if (vanish.length > 0) {
        descriptions.push(
          `VANISHで${this.formatEffectCoordinates(vanish, state)}の最も古い自分の駒${vanish.length}個が消えました。`,
        );
      }
      kings.forEach((effect) => {
        descriptions.push(`${this.displayPlayerName(effect.player)}の最初の駒をKINGに指定しました。`);
      });
      return descriptions.length ? ` ${descriptions.join(" ")}` : "";
    }

    formatEffectCoordinates(effects, state) {
      return effects
        .map((effect) => app.board.toCoordinates(effect.index, state.boardSize))
        .map(({ row, column }) => `${row + 1}行${column + 1}列`)
        .join("・");
    }

    undoTurn() {
      this.cancelCpuTurn();
      if (this.matchMode === "watch") this.watchPaused = true;
      let undone = this.game.undo();
      if (undone && this.matchMode === "cpu") {
        const restored = this.game.getState();
        if (restored.currentPlayer === 1 && this.game.canUndo()) {
          this.game.undo();
        }
      }
      if (undone) {
        this.selectedSource = null;
        this.lastCpuSearch = null;
        this.notice = this.matchMode === "cpu"
          ? "直前のあなたの手まで戻しました。"
          : this.matchMode === "watch"
            ? "1手戻して観戦を一時停止しました。"
            : "1手戻しました。";
        this.pendingFocus = this.matchMode === "watch" ? "watch-step" : "next-action";
      }
      this.render();
    }

    isCpuControlled(playerId) {
      if (this.matchMode === "watch") return playerId === 0 || playerId === 1;
      return this.matchMode === "cpu" && playerId === 1;
    }

    isCpuTurn(state) {
      return state.status === "playing" && this.isCpuControlled(state.currentPlayer);
    }

    cpuSearchProfile(settings, mode) {
      if (mode === "pvp") {
        return {
          kind: "none",
          label: "CPU探索なし",
          description: "PLAYER VS PLAYERではCPU探索を使用しません。",
          provenByDesign: false,
          reason: null,
        };
      }
      return app.BoundedMinimaxSolver.searchProfile(settings);
    }

    cpuUnsupportedReason(settings, mode) {
      const profile = this.cpuSearchProfile(settings, mode);
      return profile.kind === "unsupported" ? profile.reason : null;
    }

    searchProfileChangeText(previousProfile, nextProfile) {
      if (
        this.labMatchMode === "pvp" ||
        previousProfile.kind === nextProfile.kind
      ) {
        return "";
      }
      if (nextProfile.kind === "exact") {
        return "CPU探索は完全探索・証明済みに切り替わりました。";
      }
      if (nextProfile.kind === "strategic") {
        return "CPU探索は戦略探索・ルールセット未証明に切り替わりました。";
      }
      return `CPUを利用できません。${nextProfile.reason}`;
    }

    describeSearchDecision(decision) {
      const nodes = Number(decision.nodes || 0).toLocaleString("ja-JP");
      const elapsed = Number(decision.elapsedMs || 0).toLocaleString("ja-JP");
      if (decision.method === "exact" && decision.proven) {
        return `完全探索、${nodes}局面、証明済み、${elapsed}ミリ秒。`;
      }
      if (decision.method === "strategic" && decision.proven) {
        const depth = decision.completedDepth || decision.depth || 0;
        return `戦略探索、この局面は深さ${depth}で探索完了、${nodes}局面、${elapsed}ミリ秒、この局面は証明済み。ルールセット全体は未証明です。`;
      }
      const limit = decision.limitReason === "node-budget"
        ? "局面数上限"
        : "深さ上限";
      return `戦略探索、深さ${decision.completedDepth || decision.depth}、${nodes}局面、${elapsed}ミリ秒、${limit}、未証明。`;
    }

    formatSearchSummary(decision) {
      const method = decision.method === "strategic"
        ? `STRATEGIC / ${decision.proven ? "POSITION PROVEN" : "UNPROVEN"}`
        : `EXACT / ${decision.proven ? "PROVEN" : "UNPROVEN"}`;
      const depth = decision.completedDepth || decision.depth || 0;
      const nodes = Number(decision.nodes || 0).toLocaleString("ja-JP");
      const elapsed = Number(decision.elapsedMs || 0).toLocaleString("ja-JP");
      const limit = decision.limitReason === "node-budget"
        ? " / NODE LIMIT"
        : decision.limitReason === "depth-limit"
          ? " / DEPTH LIMIT"
          : "";
      return `${method} / D${depth} / ${nodes} STATES / ${elapsed} MS${limit}`;
    }

    strategicResultScope() {
      return this.matchMode === "watch"
        ? "これはこのCPU観戦対局の結果であり、ルールセットの理論解ではありません。"
        : "これはこの対局の結果であり、ルールセットの理論解ではありません。";
    }

    cancelCpuTurn() {
      this.cpuRequestToken += 1;
      if (this.cpuTimer !== null) global.clearTimeout(this.cpuTimer);
      this.cpuTimer = null;
      this.cpuThinking = false;
      this.watchStepPending = false;
    }

    cpuDelay(singleStep) {
      if (singleStep || this.matchMode !== "watch") return 120;
      return WATCH_SPEEDS[this.watchSpeed].delay;
    }

    queueCpuTurn({ singleStep = false } = {}) {
      const state = this.game.getState();
      if (!this.isCpuTurn(state)) return;
      if (this.matchMode === "watch" && this.watchPaused && !singleStep) return;
      const requestToken = ++this.cpuRequestToken;
      const expectedActionNumber = state.actionNumber;
      const expectedPosition = this.game.positionKey(state);
      const expectedMode = this.matchMode;

      this.cpuTimer = global.setTimeout(async () => {
        this.cpuTimer = null;
        const latest = this.game.getState();
        if (
          requestToken !== this.cpuRequestToken ||
          this.screen !== "play" ||
          this.matchMode !== expectedMode ||
          latest.actionNumber !== expectedActionNumber ||
          this.game.positionKey(latest) !== expectedPosition ||
          (this.matchMode === "watch" && this.watchPaused && !singleStep) ||
          !this.isCpuTurn(latest)
        ) {
          return;
        }

        let decision;
        try {
          const searchProfile = this.cpuSearchProfile(latest, this.matchMode);
          const Solver = searchProfile.kind === "strategic"
            ? app.BoundedMinimaxSolver
            : app.MinimaxSolver;
          const solver = new Solver(this.game);
          decision = await solver.chooseActionAsync(latest, {
            shouldAbort: () => requestToken !== this.cpuRequestToken,
          });
        } catch (error) {
          if (requestToken !== this.cpuRequestToken) return;
          this.cpuThinking = false;
          this.watchStepPending = false;
          if (this.matchMode === "watch") this.watchPaused = true;
          this.notice = "CPUの探索中に問題が発生しました。RESTARTでもう一度試してください。";
          this.pendingFocus = this.matchMode === "watch" ? "watch-controls" : "cpu-status";
          this.render();
          return;
        }
        const current = this.game.getState();
        if (
          requestToken !== this.cpuRequestToken ||
          this.screen !== "play" ||
          this.matchMode !== expectedMode ||
          current.actionNumber !== expectedActionNumber ||
          this.game.positionKey(current) !== expectedPosition ||
          !this.isCpuTurn(current)
        ) {
          return;
        }

        this.cpuThinking = false;
        this.watchStepPending = false;
        this.lastCpuSearch = decision;
        if (!decision.action) {
          if (this.matchMode === "watch") this.watchPaused = true;
          this.notice = decision.reason || "CPUが合法手を見つけられませんでした。";
          this.pendingFocus = this.matchMode === "watch" ? "watch-controls" : "cpu-status";
          this.render();
          return;
        }

        const result = this.game.performAction(decision.action);
        const strategicOutcomeNote =
          result.ok &&
          result.state.status !== "playing" &&
          decision.method === "strategic"
            ? ` ${this.strategicResultScope()}`
            : "";
        const resultNotice = result.ok
          ? `${this.describeCompletedAction(result)} ${this.describeSearchDecision(decision)}${strategicOutcomeNote}`
          : "CPUの手を適用できませんでした。";

        if (this.matchMode === "watch") {
          if (!result.ok) {
            this.watchPaused = true;
            this.notice = resultNotice;
            this.pendingFocus = "watch-controls";
            this.render();
            return;
          }

          const continues = result.state.status === "playing";
          if (continues && !singleStep && !this.watchPaused) {
            this.cpuThinking = true;
            this.notice = `${resultNotice} 次は${this.displayPlayerName(result.state.currentPlayer)}が探索します。`;
            this.announceNextNotice = false;
            this.pendingFocus = null;
            this.render();
            this.queueCpuTurn();
            return;
          }

          this.watchPaused = continues;
          this.notice = continues && singleStep
            ? `${resultNotice} 観戦は一時停止中です。`
            : resultNotice;
          this.pendingFocus = continues && singleStep
            ? "watch-step"
            : continues
              ? null
              : "outcome";
          this.render();
          return;
        }

        this.notice = resultNotice;
        this.pendingFocus = !result.ok
          ? "cpu-status"
          : result.state.status === "playing"
            ? "next-action"
            : "outcome";
        this.render();
      }, this.cpuDelay(singleStep));
    }

    displayPlayerName(playerId) {
      if (this.matchMode === "watch") return `CPU ${playerId + 1}`;
      return this.matchMode === "cpu" && playerId === 1 ? "CPU" : app.PLAYERS[playerId].name;
    }

    matchModeLabel(mode) {
      if (mode === "watch") return "CPU VS CPU";
      if (mode === "cpu") return "VS CPU";
      return "LOCAL PVP";
    }

    messageForInvalidAction(reason) {
      const messages = {
        "destination-not-allowed": "そのマスは使用できません。",
        "no-destination": "その列には置けるマスがありません。",
        "source-not-owned": "自分の駒を選んでください。",
        "same-destination": "別のマスへ移動してください。",
        "action-must-be-move": "この手番は駒を移動します。",
        "action-must-be-place": "この手番は新しい駒を置きます。",
        "game-ended": "この対局は終了しています。",
      };
      return messages[reason] || "その操作は現在のルールでは行えません。";
    }

    render() {
      const activeElement = document.activeElement;
      const focusKey =
        activeElement && this.root.contains(activeElement)
          ? activeElement.getAttribute("data-focus-key")
          : null;
      const renderers = {
        home: () => this.renderHome(),
        play: () => this.renderPlay(),
        lab: () => this.renderLab(),
        book: () => this.renderBook(),
      };
      this.root.innerHTML = renderers[this.screen]();
      this.updateNavigation();
      if (this.notice && this.announceNextNotice) this.announce(this.notice);
      else this.cancelAnnouncement(!this.notice);
      this.announceNextNotice = true;
      this.restoreFocus(focusKey);
    }

    restoreFocus(previousFocusKey) {
      const pending = this.pendingFocus;
      this.pendingFocus = null;
      let target = null;

      if (pending === "outcome") {
        target = this.root.querySelector(".outcome-card");
      } else if (pending === "cpu-status") {
        target = this.root.querySelector(".turn-card");
      } else if (pending === "cpu-warning") {
        target = this.root.querySelector("#cpu-support-reason");
      } else if (pending === "watch-controls") {
        target = this.root.querySelector('[data-focus-key="watch-play-pause"]');
      } else if (pending === "watch-step") {
        target = this.root.querySelector('[data-focus-key="watch-step"]');
      } else if (pending === "screen-heading") {
        target = this.root.querySelector("[data-screen-heading]");
      } else if (pending === "move-destination") {
        target = this.root.querySelector(".gravity-controls button:not(:disabled)");
      } else if (pending === "next-action") {
        target = this.root.querySelector(
          ".gravity-controls button:not(:disabled), .board-cell:not(:disabled)",
        );
      } else if (previousFocusKey) {
        target = [...this.root.querySelectorAll("[data-focus-key]")].find(
          (element) => element.getAttribute("data-focus-key") === previousFocusKey,
        );
      }

      if (target && !target.disabled) {
        const revealTarget = Boolean(pending && pending !== "screen-heading");
        target.focus({ preventScroll: !revealTarget });
        if (revealTarget && typeof target.scrollIntoView === "function") {
          target.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
        }
      }
    }

    updateNavigation() {
      document.querySelectorAll("[data-nav]").forEach((button) => {
        const isCurrent = button.dataset.nav === this.screen;
        button.classList.toggle("is-current", isCurrent);
        if (isCurrent) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
      });
    }

    announce(message) {
      this.cancelAnnouncement();
      if (!this.announcer) return;
      this.announcer.textContent = "";
      this.announceTimer = global.setTimeout(() => {
        this.announceTimer = null;
        this.announcer.textContent = message;
      }, 20);
    }

    cancelAnnouncement(clearText = false) {
      if (this.announceTimer !== null && this.announceTimer !== undefined) {
        global.clearTimeout(this.announceTimer);
        this.announceTimer = null;
      }
      if (clearText && this.announcer) this.announcer.textContent = "";
    }

    renderHome() {
      const activeRules = this.activeRuleIds(this.labSettings);
      const ruleLabel = activeRules.length ? activeRules.join(" + ") : "CLASSIC";
      const cpuProfile = this.cpuSearchProfile(this.labSettings, "cpu");

      return `
        <section class="home-screen" data-screen="home">
          <div class="hero-grid">
            <div class="hero-copy">
              <p class="eyebrow"><span>OPEN RULE SYSTEM</span> / EXPERIMENT 001</p>
              <h1 tabindex="-1" data-screen-heading>ルールを組み替え、<br><em>盤面を発明する。</em></h1>
              <p class="hero-lead">
                三目並べに「消える」「動く」「落ちる」「挟んで取る」「反転する」を重ねる。
                遊びながら新しい抽象戦略ゲームを設計する、ローカル完結のルール研究所です。
              </p>
              <div class="hero-actions">
                <button class="button button-primary" type="button" data-action="cpu-play" aria-describedby="home-cpu-search-profile">
                  <span>CPUと対戦</span><span aria-hidden="true">→</span>
                </button>
                <button class="button button-secondary" type="button" data-action="watch-play" aria-describedby="home-cpu-search-profile">
                  CPU戦を観戦
                </button>
                <button class="button button-secondary" type="button" data-action="pvp-play">
                  対人戦を開始
                </button>
                <button class="button button-secondary" type="button" data-action="open-screen" data-screen="lab">
                  RULE LABを開く
                </button>
              </div>
              <div id="home-cpu-search-profile" class="search-profile home-search-profile is-${cpuProfile.kind}" role="note">
                <span>CURRENT CPU SEARCH</span>
                <strong>${cpuProfile.label}</strong>
                <p>${cpuProfile.description}</p>
              </div>
            </div>

            <div class="hero-specimen" role="img" aria-label="ルールを組み替えた三目並べの標本">
              <div class="specimen-header">
                <span>SPECIMEN / A-03</span><span>LIVE RULESET</span>
              </div>
              <div class="specimen-board" aria-hidden="true">
                <span class="mark-o">○</span><span></span><span class="mark-x">×</span>
                <span class="mark-x">×</span><span class="blocked">×</span><span></span>
                <span></span><span class="mark-o faded">○</span><span class="mark-o">○</span>
              </div>
              <div class="specimen-rules">
                <span>01 / VANISH</span><span>02 / MOVE</span><span>03 / MISÈRE</span>
              </div>
              <div class="specimen-note">THE RULE IS THE PROTAGONIST.</div>
            </div>
          </div>

          <div class="current-rules-bar">
            <div><small>MATCH MODE</small><strong>${this.matchModeLabel(this.labMatchMode)}</strong></div>
            <div><small>CURRENT BOARD</small><strong>${this.labSettings.boardSize} × ${this.labSettings.boardSize}</strong></div>
            <div><small>WIN CONDITION</small><strong>${this.labSettings.winLength} IN A ROW</strong></div>
            <div class="current-rules-main"><small>ACTIVE RULES</small><strong>${ruleLabel}</strong></div>
            <button type="button" data-action="open-screen" data-screen="lab">EDIT RULESET →</button>
          </div>

          <section class="module-section" aria-labelledby="modules-title">
            <div class="section-heading">
              <div><p class="eyebrow">AVAILABLE MODULES</p><h2 id="modules-title">実験を始める</h2></div>
              <p>Phase 1—4 + 6では、対人戦・Minimax CPU・10種類の特殊ルール・ルール編集を利用できます。</p>
            </div>
            <div class="module-grid">
              ${this.renderModuleCard("01", "PLAY", "対人戦、Minimax CPUとの対戦、または設定に応じて完全探索／戦略探索を使うCPU同士の対局を観戦できます。", "watch-play", "WATCH CPU MATCH")}
              ${this.renderModuleCard("02", "RULE LAB", "盤面、勝利条件、10種類の特殊ルールを組み合わせて、新しいゲームを設計します。", "open-screen", "OPEN LAB", "lab")}
              ${this.renderModuleCard("03", "RULE BOOK", "各ルールの効果、設定値、処理カテゴリと組み合わせ時の挙動を確認します。", "open-screen", "READ RULES", "book")}
            </div>
          </section>

          <div class="next-phase">
            <span>NEXT RESEARCH</span>
            <p>Phase 5 / 7 — GAME ANALYSIS &amp; RANDOM GAME</p>
            <span class="status-pill">10 RULES INSTALLED</span>
          </div>
        </section>
      `;
    }

    renderModuleCard(number, title, description, action, label, screen) {
      return `
        <article class="module-card">
          <div class="module-number">${number}</div>
          <h3>${title}</h3>
          <p>${description}</p>
          <button type="button" data-action="${action}"${screen ? ` data-screen="${screen}"` : ""}>
            ${label} <span aria-hidden="true">↗</span>
          </button>
        </article>
      `;
    }

    renderLab() {
      const rules = app.ruleRegistry.getAll();
      const activeCount = this.activeRuleIds(this.labSettings).length;
      const warnings = this.getLabWarnings();
      const cpuProfile = this.cpuSearchProfile(this.labSettings, this.labMatchMode);
      const cpuReason = this.cpuUnsupportedReason(this.labSettings, this.labMatchMode);
      const spectatorAvailable =
        this.labMatchMode === "cpu" &&
        app.BoundedMinimaxSolver.unsupportedReason(this.labSettings) === null;
      const cpuWarning = cpuReason
        ? `${cpuReason} ${spectatorAvailable ? "CPU×CPU観戦へ切り替えるか、" : ""}PVPまたは盤面・ルール設定を変更してください。`
        : null;

      return `
        <section class="lab-screen" data-screen="lab">
          ${this.renderScreenHeading(
            "RULE LAB / CONFIGURATION",
            "ルールを設計する",
            "盤面と特殊ルールを組み替え、対戦用のルールセットを作成します。変更は新しい対局を始めたときに適用されます。",
          )}

          <div class="lab-layout">
            <aside class="lab-sidebar">
              <section class="panel setup-panel">
                <div class="panel-heading"><span>01</span><h2>BOARD SETUP</h2></div>
                <fieldset>
                  <legend>盤面サイズ</legend>
                  <div class="segmented-control">
                    ${[3, 4, 5]
                      .map(
                        (size) => `
                          <button type="button" data-action="set-board-size" data-size="${size}" data-focus-key="board-size-${size}"
                            class="${this.labSettings.boardSize === size ? "is-selected" : ""}"
                            aria-pressed="${this.labSettings.boardSize === size}">${size}×${size}</button>
                        `,
                      )
                      .join("")}
                  </div>
                </fieldset>
                <label class="select-field">
                  <span>勝利条件</span>
                  <select data-win-length data-focus-key="win-length">
                    ${Array.from(
                      { length: this.labSettings.boardSize - 2 },
                      (_, index) => index + 3,
                    )
                      .map(
                        (length) => `<option value="${length}"${length === this.labSettings.winLength ? " selected" : ""}>${length}個並べる</option>`,
                      )
                      .join("")}
                  </select>
                </label>
                <fieldset class="match-mode-field">
                  <legend>対戦モード</legend>
                  <div class="segmented-control mode-control">
                    <button type="button" data-action="set-match-mode" data-mode="pvp" data-focus-key="match-mode-pvp"
                      class="${this.labMatchMode === "pvp" ? "is-selected" : ""}" aria-pressed="${this.labMatchMode === "pvp"}">PVP</button>
                    <button type="button" data-action="set-match-mode" data-mode="cpu" data-focus-key="match-mode-cpu"
                      class="${this.labMatchMode === "cpu" ? "is-selected" : ""}" aria-pressed="${this.labMatchMode === "cpu"}"${this.labMatchMode === "cpu" ? ` aria-describedby="${cpuReason ? "cpu-support-reason" : "cpu-search-profile"}"` : ""}>VS CPU</button>
                    <button type="button" data-action="set-match-mode" data-mode="watch" data-focus-key="match-mode-watch"
                      class="${this.labMatchMode === "watch" ? "is-selected" : ""}" aria-pressed="${this.labMatchMode === "watch"}"${this.labMatchMode === "watch" ? ` aria-describedby="${cpuReason ? "cpu-support-reason" : "cpu-search-profile"}"` : ""}>CPU×CPU</button>
                  </div>
                   <p class="field-help">VS CPUではCPUが×・後手。どちらのCPUモードも3×3〜5×5盤と、拡張ルールを含む全10ルールに対応します。</p>
                  ${this.labMatchMode !== "pvp" && !cpuReason ? `
                    <div id="cpu-search-profile" class="search-profile is-${cpuProfile.kind}" role="note">
                      <span>探索方式</span>
                      <strong>${cpuProfile.label}</strong>
                      <p>${cpuProfile.description}</p>
                    </div>
                  ` : ""}
                  ${cpuWarning ? `<p id="cpu-support-reason" class="field-help cpu-support-warning" tabindex="-1">${cpuWarning}</p>` : ""}
                </fieldset>
              </section>

              <section class="panel preview-panel">
                <div class="panel-heading"><span>02</span><h2>LIVE PREVIEW</h2></div>
                ${this.renderLabPreview()}
                <dl class="preview-stats">
                  <div><dt>BOARD</dt><dd>${this.labSettings.boardSize} × ${this.labSettings.boardSize}</dd></div>
                  <div><dt>LINE</dt><dd>${this.labSettings.winLength}</dd></div>
                  <div><dt>MODULES</dt><dd>${String(activeCount).padStart(2, "0")}</dd></div>
                </dl>
              </section>

              <section class="pipeline-card" aria-label="ターン処理順">
                <span class="pipeline-title">ENGINE PIPELINE</span>
                <ol>
                  <li><span>01</span> ACTION VALIDATION</li>
                  <li><span>02</span> PLACE / MOVE</li>
                  <li><span>03</span> CAPTURE</li>
                  <li><span>04</span> FLIP / VANISH</li>
                  <li><span>05</span> LOSS / WIN</li>
                  <li><span>06</span> NEXT TURN / DRAW</li>
                </ol>
              </section>
            </aside>

            <div class="rules-workbench">
              <div class="workbench-header">
                <div><p class="eyebrow">SPECIAL RULE MODULES</p><h2>${activeCount} / ${rules.length} ENABLED</h2></div>
                <span>Rules execute by registered priority.</span>
              </div>

              ${warnings.length ? `<div class="lab-warnings" role="note">${warnings.map((warning) => `<p>NOTE / ${warning}</p>`).join("")}</div>` : ""}

              <div class="rule-card-list">
                ${rules.map((rule, index) => this.renderRuleCard(rule, index + 1)).join("")}
              </div>

              <div class="lab-actions">
                <button class="button button-secondary" type="button" data-action="reset-lab">RESET DEFAULTS</button>
                <button class="button button-primary" type="button" data-action="start-match"${cpuReason ? ` disabled aria-describedby="cpu-support-reason"` : this.labMatchMode !== "pvp" ? ` aria-describedby="cpu-search-profile"` : ""}>
                  <span>${cpuReason ? "CPU非対応の設定" : this.labMatchMode === "watch" ? cpuProfile.kind === "strategic" ? "戦略探索で観戦" : "完全探索で観戦" : this.labMatchMode === "cpu" ? "CPUと対戦" : "このルールで対戦"}</span><span aria-hidden="true">→</span>
                </button>
              </div>
            </div>
          </div>
        </section>
      `;
    }

    renderRuleCard(rule, number) {
      const config = this.labSettings.rules[rule.id];
      const enabled = config.enabled;
      return `
        <article class="rule-card ${enabled ? "is-enabled" : ""}">
          <div class="rule-index">${String(number).padStart(2, "0")}</div>
          <div class="rule-content">
            <div class="rule-title-row">
              <div>
                <h3>${rule.name}</h3>
                <div class="category-list">${rule.categories.map((category) => `<span>${category}</span>`).join("")}</div>
              </div>
              <label class="toggle">
                <input type="checkbox" data-rule-toggle="${rule.id}" data-focus-key="rule-toggle-${rule.id}"
                  aria-label="${rule.name}ルール"${enabled ? " checked" : ""}>
                <span class="toggle-track" aria-hidden="true"><span></span></span>
                <span class="toggle-label">${enabled ? "ON" : "OFF"}</span>
              </label>
            </div>
            <p>${rule.shortDescription}</p>
            ${
              rule.settings.length
                ? `<div class="rule-settings ${enabled ? "" : "is-disabled"}">
                    ${rule.settings.map((setting) => this.renderRuleSetting(rule, setting, config)).join("")}
                  </div>`
                : ""
            }
          </div>
        </article>
      `;
    }

    renderRuleSetting(rule, setting, config) {
      const value = config.settings[setting.key];
      const minusDisabled = !config.enabled || value <= setting.min;
      const plusDisabled = !config.enabled || value >= setting.max;
      return `
        <div class="stepper-field">
          <span>${setting.label}</span>
          <div class="stepper">
            <button type="button" data-action="step-setting" data-rule-id="${rule.id}" data-setting-key="${setting.key}" data-delta="-1"
              data-focus-key="setting-${rule.id}-${setting.key}-minus"
              aria-label="${rule.name}の${setting.label}を減らす"${minusDisabled ? " disabled" : ""}>−</button>
            <label>
              <span class="sr-only">${setting.label}</span>
              <input type="number" inputmode="numeric" value="${value}" min="${setting.min}" max="${setting.max}" step="${setting.step || 1}"
                data-rule-id="${rule.id}" data-rule-setting="${setting.key}" data-focus-key="setting-${rule.id}-${setting.key}-input"${config.enabled ? "" : " disabled"}>
            </label>
            <span class="stepper-unit">${setting.unit || ""}</span>
            <button type="button" data-action="step-setting" data-rule-id="${rule.id}" data-setting-key="${setting.key}" data-delta="1"
              data-focus-key="setting-${rule.id}-${setting.key}-plus"
              aria-label="${rule.name}の${setting.label}を増やす"${plusDisabled ? " disabled" : ""}>＋</button>
          </div>
        </div>
      `;
    }

    renderLabPreview() {
      const size = this.labSettings.boardSize;
      const noCenter = this.labSettings.rules.NO_CENTER.enabled;
      const gravity = this.labSettings.rules.GRAVITY.enabled;
      const centers = noCenter ? app.board.getCenterIndexes(size) : [];
      const cells = Array.from({ length: size * size }, (_, index) => {
        const blocked = centers.includes(index);
        return `<span class="${blocked ? "is-blocked" : ""}">${blocked ? "×" : ""}</span>`;
      }).join("");
      return `
        <div class="mini-board-wrap" aria-hidden="true">
          ${gravity ? `<div class="mini-gravity" aria-hidden="true">${Array.from({ length: size }, () => "↓").join(" ")}</div>` : ""}
          <div class="mini-board" style="--preview-size:${size}">${cells}</div>
        </div>
      `;
    }

    getLabWarnings() {
      const warnings = [];
      const rules = this.labSettings.rules;
      if (rules.MOVE.enabled && rules.VANISH.enabled) {
        const threshold = rules.MOVE.settings.threshold;
        const maximum = rules.VANISH.settings.maxPieces;
        if (threshold <= maximum) {
          warnings.push("MOVEへの切り替えがVANISHの上限以前のため、この組み合わせではVANISHは発動しません。");
        }
      }
      if (rules.NO_CENTER.enabled && this.labSettings.boardSize % 2 === 0) {
        warnings.push("偶数盤のNO CENTERは、中央の4マスを使用禁止にします。");
      }
      if (rules.GRAVITY.enabled && rules.NO_CENTER.enabled) {
        warnings.push("GRAVITYはNO CENTERの禁止マスを障害物として飛ばし、次の合法マスへ落下します。");
      }
      if (rules.FLIP.enabled && rules.NO_CENTER.enabled) {
        warnings.push("NO CENTERにより中央へ配置できないため、この組み合わせではFLIPは発動しません。");
      }
      if (rules.DOUBLE_LINE.enabled && rules.MISERE.enabled) {
        warnings.push("DOUBLE LINE条件の2本同時完成が成立したプレイヤーは、MISÈREにより敗北します。");
      }
      if (rules.KING.enabled && rules.VANISH.enabled) {
        warnings.push("最初の駒であるKINGがVANISHで消えると、その所有者が敗北します。");
      }
      return warnings;
    }

    newLabWarningText(previousWarnings) {
      const previous = new Set(previousWarnings || []);
      const currentWarnings = this.getLabWarnings();
      const current = new Set(currentWarnings);
      const added = currentWarnings.filter((warning) => !previous.has(warning));
      const removed = [...previous].filter((warning) => !current.has(warning));
      return [
        added.length ? `注意。${added.join(" ")}` : "",
        removed.length ? `組み合わせ上の注意が解消されました。${removed.join(" ")}` : "",
      ].filter(Boolean).join(" ");
    }

    renderPlay() {
      const state = this.game.getState();
      const activeRules = this.game.ruleEngine.describeActiveRules(state);
      const mode = this.game.getActionMode();
      const displayedPlayerId =
        state.status === "playing" || !state.lastAction
          ? state.currentPlayer
          : state.lastAction.player;
      const player = app.PLAYERS[displayedPlayerId];
      const gravity = state.rules.GRAVITY.enabled;
      const searchProfile = this.cpuSearchProfile(state, this.matchMode);
      const matchLabel = this.matchMode === "watch"
        ? "CPU VS CPU / SPECTATOR"
        : this.matchMode === "cpu"
          ? "PLAYER VS CPU"
          : "LOCAL PVP";
      const turnStatusLabel = state.status !== "playing"
        ? "COMPLETE"
        : this.matchMode === "watch" && this.watchPaused && !this.cpuThinking
          ? "PAUSED"
          : this.cpuThinking
            ? "THINKING"
            : mode.toUpperCase();

      return `
        <section class="play-screen" data-screen="play">
          <div class="play-heading">
            <button class="text-button" type="button" data-action="open-screen" data-screen="home" data-focus-key="play-home">← HOME</button>
            <div>
              <p class="eyebrow">LIVE MATCH / ${matchLabel}</p>
              <h1>${state.boardSize}×${state.boardSize} / ${state.winLength} IN A ROW</h1>
            </div>
            <button class="text-button" type="button" data-action="edit-rules" data-focus-key="play-edit-rules">EDIT RULES ↗</button>
          </div>

          <div class="play-layout">
            <aside class="match-console">
              <div class="console-label">MATCH CONSOLE</div>
              <section class="turn-card player-${displayedPlayerId + 1}${this.cpuThinking ? " is-thinking" : ""}${this.matchMode === "watch" && this.watchPaused && !this.cpuThinking ? " is-paused" : ""}" tabindex="-1">
                <span class="turn-count">${state.status === "playing" ? "TURN" : "FINAL ACTION"} ${String(state.status === "playing" ? state.turnNumber : state.actionNumber).padStart(2, "0")}</span>
                <div class="turn-player">
                  <span class="turn-mark" aria-hidden="true">${player.mark}</span>
                  <div><small>${state.status === "playing" ? "CURRENT PLAYER" : "LAST ACTOR"}</small><strong>${this.displayPlayerName(displayedPlayerId)}</strong></div>
                </div>
                <div class="turn-mode"><span>${turnStatusLabel}</span><p>${this.turnInstruction(state, mode, gravity)}</p></div>
                ${this.cpuThinking ? `<div class="cpu-thinking" aria-hidden="true"><i></i><i></i><i></i><span>${searchProfile.kind === "strategic" ? "STRATEGIC SEARCH" : "EXACT SEARCH"}</span></div>` : ""}
              </section>

              <section class="console-section">
                <h2>RULESET</h2>
                <div class="rule-chip-list">
                  <span class="rule-chip is-base">${state.winLength} LINE</span>
                  ${this.matchMode === "cpu" ? `<span class="rule-chip is-cpu">VS CPU</span>` : ""}
                  ${this.matchMode === "watch" ? `<span class="rule-chip is-cpu">CPU SPECTATOR</span>` : ""}
                  ${this.matchMode !== "pvp" ? `<span class="rule-chip is-search-${searchProfile.kind}">${searchProfile.kind === "strategic" ? "STRATEGIC / RULESET UNPROVEN" : "EXACT / PROVEN"}</span>` : ""}
                  ${activeRules.length ? activeRules.map((rule) => `<span class="rule-chip">${this.formatActiveRule(rule)}</span>`).join("") : `<span class="rule-chip">CLASSIC</span>`}
                </div>
              </section>

              <section class="console-section compact-rules">
                <h2>PARAMETERS</h2>
                <dl>
                  <div><dt>BOARD</dt><dd>${state.boardSize} × ${state.boardSize}</dd></div>
                  <div><dt>WIN</dt><dd>${state.winLength} PIECES</dd></div>
                  <div><dt>MODE</dt><dd>${this.matchMode === "watch" ? "CPU VS CPU" : this.matchMode === "cpu" ? "PLAYER VS CPU" : "LOCAL PVP"}</dd></div>
                  ${this.matchMode !== "pvp" ? `<div><dt>SEARCH</dt><dd>${searchProfile.kind === "strategic" ? "戦略探索" : "完全探索"}</dd></div>` : ""}
                  ${this.matchMode !== "pvp" ? `<div><dt>PROOF</dt><dd>${this.lastCpuSearch ? this.lastCpuSearch.proven ? "前回CPU探索の局面は証明済み" : "前回CPU探索は未証明" : searchProfile.provenByDesign ? "証明あり" : "ルールセット未証明"}</dd></div>` : ""}
                  <div><dt>REPETITION</dt><dd>DRAW × 3</dd></div>
                  <div><dt>ACTION LIMIT</dt><dd>DRAW AT ${state.actionLimit}</dd></div>
                  ${this.lastCpuSearch ? `<div><dt>LAST SEARCH</dt><dd>${this.formatSearchSummary(this.lastCpuSearch)}</dd></div>` : ""}
                </dl>
              </section>

              ${this.notice ? `<div class="match-notice">${this.notice}</div>` : ""}
            </aside>

            <div class="board-stage">
              ${this.matchMode === "watch" ? this.renderWatchControls(state) : ""}
              ${gravity ? this.renderGravityControls(state, mode) : ""}
              ${this.renderBoard(state, mode, gravity)}
              ${state.status !== "playing" ? this.renderOutcome(state) : ""}
              <div class="play-toolbar" role="group" aria-label="対局操作">
                <button type="button" data-action="undo" data-focus-key="play-undo"
                  aria-label="${this.matchMode === "cpu" && this.cpuThinking ? "CPU探索を中止して直前の手まで戻す" : this.matchMode === "watch" ? "観戦を一時停止して1手戻す" : "直前の手を戻す"}"
                  ${this.game.canUndo() ? "" : " disabled"}>${this.matchMode === "watch" ? "BACK 1 PLY" : "UNDO"}</button>
                <button type="button" data-action="restart" data-focus-key="play-restart">RESTART</button>
                <button type="button" data-action="open-screen" data-screen="home" data-focus-key="play-back">BACK</button>
              </div>
            </div>

            <aside class="match-notes">
              <div class="notes-label">FIELD NOTES</div>
              <p class="notes-number">${String(state.actionNumber).padStart(3, "0")}</p>
              <p>VALID ACTIONS<br><strong>${this.game.getLegalActions().length}</strong></p>
              <div class="notation-key">
                <span><i class="dot dot-player-1"></i> ${this.displayPlayerName(0)} / ○</span>
                <span><i class="dot dot-player-2"></i> ${this.displayPlayerName(1)} / ×</span>
                ${state.rules.VANISH.enabled ? `<span><i class="age-sample">1</i> PLACEMENT AGE</span>` : ""}
                ${this.lastCpuSearch ? `<span><i class="age-sample">D</i> DEPTH ${this.lastCpuSearch.depth}</span>` : ""}
              </div>
            </aside>
          </div>
        </section>
      `;
    }

    turnInstruction(state, mode, gravity) {
      if (state.status !== "playing") return "対局は終了しました。";
      if (this.matchMode === "watch" && this.watchPaused && !this.cpuThinking) {
        return "観戦は一時停止中です。1手送りで進められます";
      }
      if (this.isCpuTurn(state)) {
        const name = this.displayPlayerName(state.currentPlayer);
        const profile = this.cpuSearchProfile(state, this.matchMode);
        return this.cpuThinking
          ? profile.kind === "strategic"
            ? `${name}が制限内で候補手を評価しています`
            : `${name}が終局まで完全探索しています`
          : `${name}の手番です`;
      }
      if (mode === "move" && this.selectedSource === null) return "移動する自分の駒を選択";
      if (mode === "move" && gravity) return "上の矢印から移動先の列を選択";
      if (mode === "move") return "選んだ駒の移動先を選択";
      if (gravity) return "上の矢印から落とす列を選択";
      return "空いているマスへ駒を配置";
    }

    renderWatchControls(state) {
      const playing = state.status === "playing";
      const paused = this.watchPaused;
      const running = playing && !paused;
      const playbackLabel = !playing ? "終了" : paused ? "再生" : "一時停止";
      return `
        <div class="watch-controls" role="group" aria-label="CPU対戦の観戦操作" aria-describedby="watch-a11y-help">
          <span id="watch-a11y-help" class="sr-only">自動再生中の各着手は読み上げません。着手を読み上げるには一時停止し、1手進めるを使用してください。</span>
          <button type="button" data-action="toggle-watch" data-focus-key="watch-play-pause"
            class="${running ? "is-running" : ""}"${playing ? "" : " disabled"}>
            <span aria-hidden="true">${!playing ? "■" : paused ? "▶" : "Ⅱ"}</span>${playbackLabel}
          </button>
          <button type="button" data-action="watch-step" data-focus-key="watch-step"
            ${playing && paused && !this.cpuThinking && !this.watchStepPending ? "" : "disabled"}>
            <span aria-hidden="true">›</span>1手進める
          </button>
          <label class="watch-speed-field">
            <span>観戦速度</span>
            <select data-watch-speed data-focus-key="watch-speed"${playing ? "" : " disabled"}>
              ${Object.entries(WATCH_SPEEDS).map(([value, option]) => `<option value="${value}"${this.watchSpeed === value ? " selected" : ""}>${option.label}</option>`).join("")}
            </select>
          </label>
        </div>
      `;
    }

    renderGravityControls(state, mode) {
      const legalActions = this.game.getLegalActions();
      const humanCanAct = state.status === "playing" && !this.cpuThinking && !this.isCpuTurn(state);
      const destinationActions = legalActions.filter(
        (action) => mode !== "move" || action.source === this.selectedSource,
      );
      const destinations = new Map(
        destinationActions.map((action) => [action.target % state.boardSize, action.target]),
      );
      return `
        <div class="gravity-controls" role="group" style="--board-size:${state.boardSize}" aria-label="落下させる列">
          ${Array.from({ length: state.boardSize }, (_, column) => {
            const target = destinations.get(column);
            const coordinates = Number.isInteger(target)
              ? app.board.toCoordinates(target, state.boardSize)
              : null;
            const destinationLabel = coordinates
              ? `${coordinates.row + 1}行${coordinates.column + 1}列へ`
              : "";
            return `
              <button type="button" data-action="drop-column" data-column="${column}" data-focus-key="drop-column-${column}"
                aria-label="${column + 1}列目の${destinationLabel}${mode === "move" ? "移動" : "配置"}"
                ${humanCanAct && destinations.has(column) && (mode !== "move" || this.selectedSource !== null) ? "" : "disabled"}>↓<small>${column + 1}</small></button>
            `;
          }).join("")}
        </div>
      `;
    }

    renderBoard(state, mode, gravity) {
      const legalActions = this.game.getLegalActions();
      const noCenter = state.rules.NO_CENTER.enabled;
      const centers = noCenter ? app.board.getCenterIndexes(state.boardSize) : [];
      const temporarilyForbidden = new Set(
        state.status === "playing" &&
        state.rules.FORBIDDEN_NEIGHBOR.enabled &&
        mode === "place" &&
        state.lastAction &&
        state.lastAction.type === "place"
          ? app.board
              .getNeighborIndexes(state.lastAction.target, state.boardSize, false)
              .filter((index) => !state.board[index])
          : [],
      );
      const captured = new Set(
        state.lastEffects
          .filter((effect) => effect.ruleId === "CAPTURE")
          .map((effect) => effect.index),
      );
      const flipped = new Set(
        state.lastEffects
          .filter((effect) => effect.ruleId === "FLIP")
          .map((effect) => effect.index),
      );
      const vanished = new Set(
        state.lastEffects
          .filter((effect) => effect.ruleId === "VANISH")
          .map((effect) => effect.index),
      );
      const winning = new Set(state.winningLine || []);
      const sourceSet = new Set(
        legalActions.filter((action) => action.type === "move").map((action) => action.source),
      );
      const targetSet = new Set(
        legalActions
          .filter((action) => mode !== "move" || action.source === this.selectedSource)
          .map((action) => action.target),
      );
      const legalColumns = new Set([...targetSet].map((index) => index % state.boardSize));
      const ageRanks = this.getAgeRanks(state);
      const humanCanAct = state.status === "playing" && !this.cpuThinking && !this.isCpuTurn(state);

      const cells = state.board.map((piece, index) => {
        const coordinates = app.board.toCoordinates(index, state.boardSize);
        const blocked = centers.includes(index);
        const temporaryBlock = temporarilyForbidden.has(index);
        const ownPiece = piece && piece.owner === state.currentPlayer;
        const sourceSelectable = Boolean(
          humanCanAct && mode === "move" && ownPiece && sourceSet.has(index),
        );
        let clickable = false;

        if (humanCanAct && !blocked && !temporaryBlock) {
          if (mode === "place") {
            clickable = gravity ? false : targetSet.has(index);
          } else if (this.selectedSource === null) {
            clickable = ownPiece && sourceSet.has(index);
          } else if (ownPiece) {
            clickable = sourceSet.has(index);
          } else {
            clickable = gravity ? false : targetSet.has(index);
          }
        }

        const classes = ["board-cell"];
        if (piece) classes.push(`has-player-${piece.owner + 1}`);
        if (blocked) classes.push("is-blocked");
        if (temporaryBlock) classes.push("is-temporarily-forbidden");
        if (captured.has(index)) classes.push("was-captured");
        if (flipped.has(index)) classes.push("was-flipped");
        if (vanished.has(index)) classes.push("was-vanished");
        if (winning.has(index)) classes.push("is-winning");
        if (this.selectedSource === index) classes.push("is-selected-source");
        if (clickable) classes.push("is-clickable");
        if (targetSet.has(index) && this.selectedSource !== null) classes.push("is-legal-target");

        const effectBadge = captured.has(index)
          ? `<span class="piece-effect-badge is-capture" aria-hidden="true">C</span>`
          : vanished.has(index)
            ? `<span class="piece-effect-badge is-vanish" aria-hidden="true">V</span>`
            : flipped.has(index)
              ? `<span class="piece-effect-badge is-flip" aria-hidden="true">F</span>`
              : "";
        const kingBadge = piece && Number.isInteger(piece.kingFor)
          ? `<span class="piece-king" aria-hidden="true">K</span>`
          : "";
        const content = piece
          ? `<span class="piece" aria-hidden="true">${app.PLAYERS[piece.owner].mark}</span>${kingBadge}${state.rules.VANISH.enabled ? `<span class="piece-age" aria-hidden="true">${ageRanks.get(piece.id)}</span>` : ""}${effectBadge}`
          : blocked
            ? `<span class="blocked-mark" aria-hidden="true">×</span>`
            : temporaryBlock
              ? `<span class="temporary-block-mark" aria-hidden="true">!</span>${effectBadge}`
              : `<span class="empty-point" aria-hidden="true"></span>${effectBadge}`;
        const ageLabel = piece && state.rules.VANISH.enabled
          ? `、${this.displayPlayerName(piece.owner)}の駒の中で古い順に${ageRanks.get(piece.id)}番目`
          : "";
        const kingLabel = piece && Number.isInteger(piece.kingFor)
          ? `、${this.displayPlayerName(piece.kingFor)}のKING`
          : "";
        const effectLabel = [
          captured.has(index) ? "、直前のCAPTUREで駒が除去されたマス" : "",
          flipped.has(index) ? "、直前のFLIPで反転した駒" : "",
          vanished.has(index) ? "、直前のVANISHで駒が消えたマス" : "",
        ].join("");
        const temporaryLabel = temporaryBlock ? "、この手番のみ新規配置禁止" : "";
        const selectedSourceLabel = this.selectedSource === index ? "、移動元として選択中" : "";
        const winningLabel = winning.has(index) ? "、決着ライン" : "";
        const label = blocked
          ? `${coordinates.row + 1}行${coordinates.column + 1}列、恒久使用禁止`
          : piece
            ? `${coordinates.row + 1}行${coordinates.column + 1}列、${this.displayPlayerName(piece.owner)}の${app.PLAYERS[piece.owner].mark}${kingLabel}${ageLabel}${effectLabel}${temporaryLabel}${selectedSourceLabel}${winningLabel}`
            : `${coordinates.row + 1}行${coordinates.column + 1}列、空き${effectLabel}${temporaryLabel}${winningLabel}`;

        return `
          <button type="button" class="${classes.join(" ")}" data-action="board-cell" data-index="${index}" data-focus-key="board-cell-${index}"
            aria-label="${label}"${sourceSelectable ? ` aria-pressed="${this.selectedSource === index}"` : ""}${clickable ? "" : " disabled"}>
            <span class="cell-coordinate" aria-hidden="true">${coordinates.row + 1}.${coordinates.column + 1}</span>
            ${content}
          </button>
        `;
      }).join("");

      return `
        <div class="game-board" role="group" style="--board-size:${state.boardSize}" aria-label="${state.boardSize}かける${state.boardSize}のゲーム盤">${cells}</div>
        ${this.renderAccessibleBoard(state, ageRanks, centers, temporarilyForbidden, captured, flipped, vanished, winning)}
      `;
    }

    renderAccessibleBoard(state, ageRanks, centers, temporarilyForbidden, captured, flipped, vanished, winning) {
      const rows = Array.from({ length: state.boardSize }, (_, row) => {
        const cells = Array.from({ length: state.boardSize }, (_, column) => {
          const index = app.board.toIndex(row, column, state.boardSize);
          const piece = state.board[index];
          let text = "空き";
          if (centers.includes(index)) text = "使用禁止";
          else if (piece) {
            const age = state.rules.VANISH.enabled ? `、古い順に${ageRanks.get(piece.id)}番目` : "";
            const king = Number.isInteger(piece.kingFor)
              ? `、${this.displayPlayerName(piece.kingFor)}のKING`
              : "";
            const effect = flipped.has(index) ? "、直前のFLIPで反転" : "";
            const forbidden = temporarilyForbidden.has(index) ? "、この手番のみ新規配置禁止" : "";
            const selected = this.selectedSource === index ? "、移動元として選択中" : "";
            const decisive = winning.has(index) ? "、決着ライン" : "";
            text = `${this.displayPlayerName(piece.owner)}の${app.PLAYERS[piece.owner].mark}${king}${age}${effect}${forbidden}${selected}${decisive}`;
          } else {
            if (captured.has(index)) text += "、直前のCAPTUREで除去";
            if (vanished.has(index)) text += "、直前のVANISHで消滅";
            if (temporarilyForbidden.has(index)) text += "、この手番のみ新規配置禁止";
          }
          return `<td>${text}</td>`;
        }).join("");
        return `<tr><th scope="row">${row + 1}行</th>${cells}</tr>`;
      }).join("");
      return `
        <div class="sr-only">
          <table class="accessible-board-summary">
            <caption>現在の盤面状態</caption>
            <thead><tr><th></th>${Array.from({ length: state.boardSize }, (_, column) => `<th scope="col">${column + 1}列</th>`).join("")}</tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `;
    }

    getAgeRanks(state) {
      const ranks = new Map();
      [0, 1].forEach((playerId) => {
        state.board
          .filter((piece) => piece && piece.owner === playerId)
          .sort((left, right) => left.createdAt - right.createdAt)
          .forEach((piece, index) => ranks.set(piece.id, index + 1));
      });
      return ranks;
    }

    formatActiveRule(rule) {
      const values = rule.settings.map((setting) =>
        `${rule.config.settings[setting.key]}${setting.unit || ""}`,
      );
      return values.length ? `${rule.name} ${values.join(" / ")}` : rule.name;
    }

    renderOutcome(state) {
      let eyebrow = "MATCH COMPLETE";
      let title = "DRAW";
      let detail = "合法手がなくなったため、引き分けです。";
      const strategicResult =
        this.matchMode !== "pvp" &&
        this.cpuSearchProfile(state, this.matchMode).kind === "strategic";

      if (state.status === "won") {
        const winner = app.PLAYERS[state.winner];
        title = `${this.displayPlayerName(state.winner)} WINS`;
        detail =
          state.reason === "misere-line"
            ? state.rules.DOUBLE_LINE.enabled
              ? `${this.displayPlayerName(state.loser)}が新しいラインを同時に2本以上完成させたため、MISÈREルールで敗北しました。`
              : `${this.displayPlayerName(state.loser)}がラインを完成させたため、MISÈREルールで敗北しました。`
            : state.reason === "king-lost"
              ? `${this.displayPlayerName(state.loser)}のKINGが除去または反転され、KINGルールで敗北しました。`
              : state.reason === "double-line"
                ? `${winner.mark} が一手で新しいラインを同時に2本以上完成させました。`
                : `${winner.mark} が${state.winLength}個のラインを完成させました。`;
      } else if (state.reason === "threefold-repetition") {
        eyebrow = "REPETITION DRAW";
        detail = "同じ局面が3回現れたため、有限ゲーム規定により引き分けです。";
      } else if (state.reason === "action-limit") {
        eyebrow = "ACTION LIMIT DRAW";
        detail = `${state.actionLimit}手の対局上限に達したため、有限ゲーム規定により引き分けです。`;
      }

      return `
        <div class="outcome-card" role="region" tabindex="-1" aria-labelledby="outcome-title" aria-describedby="outcome-detail${strategicResult ? " outcome-scope" : ""}">
          <p>${eyebrow}</p>
          <h2 id="outcome-title">${title}</h2>
          <span id="outcome-detail">${detail}</span>
          ${strategicResult ? `<span id="outcome-scope" class="outcome-scope-note">${this.strategicResultScope()}</span>` : ""}
          <div>
            <button type="button" data-action="restart">REMATCH</button>
            <button type="button" data-action="edit-rules">EDIT RULES</button>
          </div>
        </div>
      `;
    }

    renderBook() {
      const rules = app.ruleRegistry.getAll();
      return `
        <section class="book-screen" data-screen="book">
          ${this.renderScreenHeading(
            "RULE BOOK / MODULE CATALOG",
            "実装済みルール",
            "すべての特殊ルールは独立したモジュールとして登録されています。設定、カテゴリ、実行優先順位をここで確認できます。",
          )}

          <div class="book-intro-grid">
            <article class="principle-card">
              <span>DESIGN PRINCIPLE / 01</span>
              <h2>THE RULE IS<br>THE PROTAGONIST.</h2>
              <p>ゲーム本体は駒の配置と状態遷移だけを担当し、特殊な挙動は登録済みルールのフックが処理します。</p>
            </article>
            <article class="order-card">
              <span>TURN RESOLUTION ORDER</span>
              <ol>
                <li><i>01</i><b>VALIDATE</b><small>合法手を判定</small></li>
                <li><i>02</i><b>APPLY</b><small>配置・移動</small></li>
                <li><i>03</i><b>EFFECT</b><small>特殊効果を実行</small></li>
                <li><i>04</i><b>RESOLVE</b><small>敗北→勝利→引分</small></li>
              </ol>
            </article>
          </div>

          <div class="book-rule-list">
            ${rules.map((rule, index) => this.renderBookRule(rule, index + 1)).join("")}
          </div>

          <section class="combination-note cpu-note">
            <div><span>PHASE 04 / SOLVER</span><h2>MINIMAX CPU</h2></div>
            <div>
              <p><strong>EXACT SEARCH</strong>3×3盤で、GRAVITY／MISÈRE／NO CENTERだけを使用する設定は、全合法手を終局まで探索して結果を証明します。</p>
              <p><strong>STRATEGIC SEARCH</strong>4×4／5×5盤、MOVE／VANISH、またはPhase 6拡張ルールを含むCPU対戦では、固定した深さと局面数で候補手を評価します。結果は未証明です。</p>
              <p><strong>RULE AWARE</strong>10ルールの合法手、盤面効果、勝敗、三回反復は、対戦と同じルールエンジンで処理します。</p>
              <p><strong>FINITE MATCH</strong>循環対局は三回反復、または盤面規模に応じた手数上限で正式な引き分けになります。</p>
              <p><strong>SPECTATOR</strong>CPU 1とCPU 2の対局を、再生・一時停止・1手送り・3段階の速度で観戦できます。</p>
              <p><strong>SAFE SCOPE</strong>PLAYER VS CPUとCPU観戦の双方が、3×3〜5×5盤、すべての勝利長、全10ルールに対応します。</p>
            </div>
          </section>

          <section class="combination-note">
            <div><span>COMBINATION NOTE</span><h2>複数ルールの扱い</h2></div>
            <div>
              <p><strong>GRAVITY + NO CENTER</strong>禁止マスを障害物として飛ばし、同じ列の次の合法マスへ落下します。</p>
              <p><strong>VANISH + MOVE</strong>MOVEは累計配置数で切り替わるため、駒が消えても配置フェーズには戻りません。</p>
              <p><strong>VANISH + MISÈRE</strong>駒が消えた後の最終盤面に対して、敗北条件を先に判定します。</p>
              <p><strong>CAPTURE → FLIP → VANISH</strong>盤面効果はこの順に適用し、その後にKINGとMISÈREの敗北、DOUBLE LINEと通常勝利を判定します。</p>
              <p><strong>DOUBLE LINE + MISÈRE</strong>一手で別々の新しいラインを2本以上完成させたプレイヤーが敗北します。</p>
              <p><strong>KING</strong>MOVE後もKING性を維持します。除去だけでなくFLIPで敵駒になった場合も元の所有者が敗北し、同時条件ではKING判定をMISÈREより先に処理します。</p>
              <p><strong>FLIP + NO CENTER</strong>中央へ配置できないためFLIPは発動しません。RULE LABにも注意を表示します。</p>
            </div>
          </section>
        </section>
      `;
    }

    renderBookRule(rule, number) {
      return `
        <article class="book-rule">
          <div class="book-rule-number">${String(number).padStart(2, "0")}</div>
          <div class="book-rule-name"><h2>${rule.name}</h2><span>PRIORITY ${rule.priority}</span></div>
          <div class="book-rule-description"><p>${rule.description}</p>${rule.settings.length ? `<dl>${rule.settings.map((setting) => `<div><dt>${setting.label}</dt><dd>DEFAULT ${setting.default}${setting.unit || ""}</dd></div>`).join("")}</dl>` : ""}</div>
          <div class="book-rule-categories">${rule.categories.map((category) => `<span>${category}</span>`).join("")}</div>
        </article>
      `;
    }

    renderScreenHeading(eyebrow, title, description) {
      return `
        <header class="screen-heading">
          <div><p class="eyebrow">${eyebrow}</p><h1 tabindex="-1" data-screen-heading>${title}</h1></div>
          <p>${description}</p>
        </header>
      `;
    }

    activeRuleIds(settings) {
      return app.ruleRegistry
        .getAll()
        .filter((rule) => settings.rules[rule.id].enabled)
        .map((rule) => rule.name);
    }
  }

  app.UI = UI;
})(globalThis);
