# テスト

## 設計方針

このリポジトリの `app.js` はビルド工程なし・ES Modules不使用の単一ファイル（5000行超）で、
全ての関数がグローバルスコープに宣言されています。`app.js` の分割・モジュール化はリファクタ方針として
行わないことが決まっているため、テストのために本体コード（`app.js` / `index.html` / `letter.html` /
`sw.js` / `gas_script.js`）は一切書き換えていません。

代わりに `tests/load-app-functions.mjs` が `app.js` をテキストとして読み込み、テスト対象の純粋関数
（および、その関数が参照しているグローバル定数）だけを波括弧の深さを数えて正確に切り出し、
`new Function()` で評価してオブジェクトとしてエクスポートします。切り出したコードは
`new Function()` に通した時点で構文エラーがあれば例外になるため検証を兼ねています。
指定した関数が1つでも見つからない・抽出できない場合は例外を投げてテストスイート全体を
失敗させます（`app.js` のリファクタで関数名が変わったときにテストが静かにスキップされず、
気づけるようにするため）。

## 実行方法

```bash
# 依存関係のインストール（初回のみ）
npm i -D vitest

# ユニットテスト（純粋関数のみ、Node上で実行）
npm test

# E2Eスモークテスト（Playwright / chromium を実ブラウザで起動）
npm run test:e2e
```

## ユニットテスト（`tests/unit.test.mjs`）

対象: `parseKanjiNumber`, `normalizeAddress`, `stableIdFromRow`, `tokenizeVertical`,
`kanaNormalize`, `formatRelativeTime`, `hasEmptyTag`, `stripEmptyTag`, `parseFlexibleDate`。

期待値は推測ではなく `app.js` の実装を実際に読んで決定しています。実装のバグと思われる挙動を
見つけた場合は、そのバグを「再現するテスト」として明示的なコメント付きで記録しており、
`app.js` 自体は修正していません（詳細はテストファイル内の `[本体のバグ]` コメントを参照）。

## E2Eスモークテスト（`tests/smoke.spec.mjs`）

`@playwright/test` ランナーは未導入（`playwright` パッケージのみ）のため、素の Node スクリプトとして
`chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })` を直接呼び出しています。
`http://localhost:8766/` が応答していればそれを使い、応答しなければ `python3 -m http.server` を
一時的に自前で起動する（終了時に必ず後片付けする）ため、単独実行でも再現可能です。

Google Fonts・GAS(script.google.com) へのアクセスはネットワーク制限により失敗しますが、これらに
起因する `console.error` / `ERR_FAILED` / `Failed to fetch` はテストの合否に影響しないようにフィルタ
しています。一方 `pageerror`（未捕捉のJS例外）は無視せず、1件でもあれば失敗として扱います。
