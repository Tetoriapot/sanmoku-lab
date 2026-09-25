# SANMOKU / LAB

三目並べを土台に、特殊ルールを自由に組み合わせて遊ぶローカルWebアプリです。現在は企画書の Phase 1〜4 と Phase 6（追加ルール）を実装しています。

## 起動方法

公開版は [GitHub Pagesで遊ぶ](https://tetoriapot.github.io/sanmoku-lab/) から起動できます。

ローカルでは `index.html` をブラウザで開いてください。ビルド、インストール、サーバー、アカウント、外部通信は不要です。

- HTML / CSS / Vanilla JavaScript のみ
- npm依存なし
- 外部API・データベースなし
- `file://` 起動と互換性を持つclassic script方式（ES Modules、`fetch`不使用）

GitHub Pagesは `main` ブランチのルートを公開します。`main` へのpushで公開版も更新されます。`.nojekyll` により、HTML・CSS・JavaScriptを静的ファイルとして配信します。

## 実装済み機能

- 3×3、4×4、5×5盤
- 盤面サイズに応じた3〜5個のライン勝利条件
- PLAYER 1（○）対 PLAYER 2（×）
- PLAYER 1（○）対 CPU（×・後手）
- CPU 1（○）対 CPU 2（×）の観戦モード
- 勝利、敗北、引き分け判定
- UNDO、RESTART
- RULE LABでのルールON/OFF・数値設定
- RULE BOOK
- レスポンシブUI、キーボード操作、スクリーンリーダー向けラベル

### CPU対戦

CPUはUIから独立し、対戦設定に応じて2種類の探索を使い分けます。どちらもゲーム本体の合法手・状態遷移・勝敗判定をそのまま利用します。

| 設定 | 観戦時の探索 | 表示 |
| --- | --- | --- |
| 3×3、拡張ルールなし、またはGRAVITY／MISÈRE／NO CENTERのみ | 終局までの完全Minimax | 完全探索・証明済み |
| 3×3、MOVE／VANISHまたはPhase 6ルールあり | 反復深化による制限探索（最大5手・1,500局面） | 戦略探索・ルールセット未証明 |
| 4×4、全ルール | 反復深化による制限探索（最大3手・1,000局面） | 戦略探索・ルールセット未証明 |
| 5×5、全ルール | 反復深化による制限探索（最大2手・700局面） | 戦略探索・ルールセット未証明 |

- PLAYER VS CPUとCPU VS CPU観戦の双方が、3×3〜5×5、すべての勝利長、全10ルール・全1,024組み合わせに対応します
- 6種類の盤面・勝利長と1,024ルールセットを合わせた6,144設定を、各CPUモードで利用できます
- CPUはPLAYER VS CPUではPLAYER 2（×・後手）です
- 戦略探索は固定ノード予算で決定的に動きますが、その手が理論上の最善手であることやルールセットの勝敗は証明しません
- 戦略探索が終盤の現在局面を制限内で読み切った場合だけ「この局面は証明済み」と表示しますが、ルールセット全体は未証明のままです
- CPU対戦中のUNDOは、直前のCPU手とその前のプレイヤー手をまとめて戻します
- CPU同士の観戦は自動再生で始まり、一時停止、再開、1手送り、3段階の速度変更ができます
- 観戦中のUNDOは自動再生を停止し、1手だけ戻します。RESTARTは現在の再生・停止状態を維持します

RULE LABとPLAY画面には、現在の探索方式、証明状態、探索深さ、局面数、所要時間、打ち切り理由を表示します。戦略探索による対局結果は観戦した1局の結果であり、ルールセットの理論解とは扱いません。

特殊ルールは次の10種類です。

| ルール | 効果 | 主な設定 |
| --- | --- | --- |
| VANISH | 新規配置で上限を超えると、自分の最古の駒を除去 | 盤上に残せる駒数 |
| MOVE | 規定数を配置した後は、新規配置の代わりに自駒を移動 | 累計配置数 |
| GRAVITY | 選択列の最下段にある合法マスへ落下 | なし |
| FORBIDDEN NEIGHBOR | 直前の配置先に隣接する上下左右を次の配置先から除外 | なし |
| CAPTURE | 配置・移動した駒と既存自駒で挟んだ直交方向の敵駒を除去 | なし |
| FLIP | 中央への新規配置時、上下左右の隣接敵駒を反転 | なし |
| MISÈRE | ラインを完成させたプレイヤーが敗北 | なし |
| KING | 各プレイヤーの最初の駒を失うと敗北 | なし |
| DOUBLE LINE | 一手で別々の新規ラインを2本以上完成した場合だけ勝利 | なし |
| NO CENTER | 中央を使用禁止（偶数盤は中央4マス） | なし |

## 仕様上の決定

企画書で解釈が分かれる箇所は、組み合わせの一貫性を優先して次のように定義しています。

- MOVEは「盤上の現在個数」ではなく、プレイヤーごとの累計配置数で移動フェーズへ切り替わります。VANISHで駒が消えても配置フェーズへ戻りません。
- MOVEした駒はIDと配置時刻を維持するため、VANISH上の古さは変わりません。
- GRAVITYは配置とMOVEの移動先の双方に適用されます。既存の駒や、VANISHで生じた隙間が一斉落下することはありません。
- GRAVITYとNO CENTERの併用時、禁止マスは障害物として飛ばし、同じ列の次の合法マスへ落下します。
- CAPTUREは配置とMOVEの双方で発動します。行動先から上下左右へ連続する敵駒を自駒で挟んだ場合にすべて除去し、複数方向も同時に処理します。斜め方向は対象外です。
- FLIPは最終的な着地先が中央である新規配置だけで発動します。偶数盤では中央4マスのいずれでも発動し、反転した駒はIDとVANISH上の古さを維持します。NO CENTERとの併用時は発動不能になるためRULE LABに注意を表示します。
- FORBIDDEN NEIGHBORは直前の新規配置の実着地先を基準にし、その上下左右を次のプレイヤーの新規配置先から1手だけ除外します。MOVE先には適用せず、GRAVITYは一時禁止マスを飛ばして次の合法マスへ落下します。
- DOUBLE LINEは行動前後の差分を比較し、その一手で新しく完成した別々の直線が2本以上の場合だけ成立します。同一直線上で重なる勝利長区間は1本と数えます。MISÈRE併用時は同じ二本条件を満たしたプレイヤーが敗北します。
- KINGは各プレイヤーの最初の新規配置駒です。MOVEしてもKING性を維持し、CAPTURE／VANISHで除去された場合と、FLIPで敵駒へ変わった場合に元の所有者が敗北します。両KINGが同じ行動で失われた場合は行動したプレイヤーが敗北します。
- 盤面効果は `CAPTURE → FLIP → VANISH`、終局条件は `KING敗北 → MISÈRE敗北 → DOUBLE LINE／通常勝利 → 引き分け` の順で解決します。
- MOVEによる永久循環を避け、有限ゲームという前提を守るため、同じ実効局面が3回現れた場合は引き分けです。
- 大盤面で同一局面へ戻らない長い循環も有限にするため、3×3／4×4は128手、5×5は200手で正式な引き分けになります。三回反復が同時に成立する場合は三回反復を先に判定します。

## アーキテクチャ

```text
index.html
css/
  style.css
js/
  namespace.js
  board.js
  ruleRegistry.js
  ruleEngine.js
  game.js
  minimax.js
  boundedMinimax.js
  ui.js
  app.js
  rules/
    vanish.js
    move.js
    gravity.js
    forbiddenNeighbor.js
    capture.js
    flip.js
    misere.js
    king.js
    doubleLine.js
    noCenter.js
tests/
  engine.test.js
  minimax.test.js
  cpu-ui.test.js
  spectator-ui.test.js
```

ゲーム状態はJSON化可能な単一Stateへ集約され、DOMを参照しません。UIはStateを読み取って描画するだけです。

`RuleRegistry` がルールのメタデータ、設定スキーマ、競合、優先順位、探索方針、フックを管理します。`RuleEngine` は有効なルールを優先順位順に実行します。RULE LABとRULE BOOKの一覧・設定UIはレジストリのメタデータから自動生成されます。

1ターンの処理順は次のとおりです。

1. 行動モード判定（PLACE / MOVE）
2. 対象マス変換（GRAVITY）
3. 合法手判定（NO CENTERなど）
4. 配置・移動
5. 挟み取り（CAPTURE）
6. 駒変換（FLIP）
7. ターン終了効果（VANISHなど）
8. 敗北条件（KING → MISÈRE）
9. 勝利条件（DOUBLE LINE → 通常勝利）
10. 非終局時は次プレイヤーを手番候補として準備
11. 次手番を含む局面で、三回反復・手数上限・合法手なしによる引き分けを判定

反復判定は「次に誰が指すか」を局面の一部にするため、引き分け終局Stateの `currentPlayer` には次手番候補が残ります。PLAY画面の終局表示は混同を避け、`lastAction.player` を「LAST ACTOR」として表示します。

## 新しい特殊ルールの追加

1. `js/rules/newRule.js` を作り、`SanmokuLab.ruleRegistry.register({...})` で定義を登録します。
2. `index.html` のルールスクリプト一覧へ1行追加します。

ルール定義には以下を持たせられます。

- `id`, `name`, `description`
- `categories`
- `settings`（RULE LABのUIも自動生成）
- `conflicts`
- `priority`
- `exactSearchSafe`（明示的に`true`のルールだけ完全探索へ参加。未知ルールは安全側で戦略探索）
- `usesPieceAge`（駒の配置順が将来の状態遷移に影響するルール）
- `transfersPieceOwnership`（駒の所有者を変えるルール。年齢依存ルールとの併用時は全駒共通の古さを局面キーへ含める）
- `hooks`（行動モード、対象変換、合法手、盤面効果、敗北・勝利・引き分け条件、局面キーへの寄与）

既存フックで表現できるルールは基本ゲームを変更せず追加できます。まったく新しい処理段階や固有の盤面操作UIを必要とするルールでは、対応する汎用フックまたは表示支援を一度追加します。

## Minimax / 将来のゲーム解析

解析処理はDOMなしで次のAPIを利用できます。

- `game.getLegalActions(state)`：正規化・重複排除済みの合法手
- `game.simulateAction(state, action)`：入力Stateを変更せず次Stateを返す
- `game.positionKey(state)`：ルール設定、手番、ルール固有状態に加え、年齢依存ルール時だけ駒の相対的な古さ（所有移転ルール併用時は全駒共通順）を含む反復判定キー
- `game.transpositionKey(state)`：反復履歴まで含み、探索キャッシュで安全に使えるキー

`MinimaxSolver` は3×3かつ有効ルールがすべて `exactSearchSafe` の設定を完全探索します。`BoundedMinimaxSolver` は4×4／5×5、MOVE／VANISH、またはPhase 6ルールを含む設定で、反復履歴と手数上限を含む `transpositionKey`、反復深化、Alpha-Beta pruning、盤面別の固定局面予算、決定的な評価関数を使用します。子局面は必要になった時だけ生成し、盤面遷移そのものを予算へ含めます。どちらも盤面更新を独自実装せず、同じState APIを再利用します。

## テスト

Node.jsがある環境では、npmなしで実行できます。

```powershell
node tests/engine.test.js
node tests/minimax.test.js
node tests/cpu-ui.test.js
node tests/spectator-ui.test.js
```

通常対戦、全方向の勝利、引き分け、無効操作、UNDO/RESTART、10ルール単独、主要な複合ルール、効果順、三回反復・手数上限、State非破壊性を検証します。Phase 6については多方向CAPTURE、MOVEからのCAPTURE、奇数・偶数盤FLIP、一時禁止、DOUBLE LINEの差分・同一直線集約、KINGのMOVE／除去／反転／同時喪失を個別に確認します。CPUは全1,024ルールセットの探索方式、全6,144設定／各CPUモードのルーティング、新5ルールと全10ルールでの合法手、即時KING捕獲、即時DOUBLE LINE、正式終局、探索予算と中断を検証します。盤面のK/C/F/一時禁止表示、結果説明、観戦操作、UNDO、予約済み／探索中処理の取消も個別にテストします。

## 今回の対象外

ゲーム解析、RANDOM GAME、CAPTUREの斜め設定、4×4／5×5や循環・Phase 6ルールの理論解を求める完全探索は次Phase以降の作業として意図的に含めていません。
