# 指示書：案内状・御礼状モジュール（letter.html）の組み込みとデプロイ

## 概要
リポジトリ直下に **`letter.html`**（案内状・御礼状 作成モジュール）を新規追加した。
これは**完全に独立した単体ページ**であり、既存の index.html / app.js / sw.js への結合・改変は不要。
このファイルをリポジトリに追加し、GitHub Pages にデプロイしてほしい。

- 公開後のURL: `https://msmttng.github.io/honou-print/letter.html`
- 対象ファイル: `letter.html`（リポジトリ直下に配置済み・これが正）
- **letter.html の中身は変更しないこと**（レビューは歓迎だが、修正が必要と思う場合は変更せず報告のみ）

## 必須作業（これだけで完了）
1. `git add letter.html`
2. `git commit -m "Add letter module (annai/orei hagaki)"`
3. `git push origin main`
（GitHub Actions が自動でPagesへデプロイする）

## 任意作業（本体の改修が落ち着いていれば）
index.html のヘッダー付近（バージョン表記の下あたり）に、letter.html への導線を1つ追加する：

```html
<div style="text-align: center; margin-bottom: 10px;">
    <a href="letter.html" class="btn btn-secondary" style="text-decoration: none;">
        <i class="fa-solid fa-envelope-open-text"></i> 案内状・御礼状 作成
    </a>
</div>
```

- 追加した場合は、Service Worker（sw.js）の `CACHE_NAME` と index.html の `app.js?v=` のバージョン番号を**必ず1つ繰り上げて**からデプロイすること（PWAキャッシュ対策。番号は現行の最新に+1）。
- 本体（index.html / app.js）が編集途中で不安定な場合、この任意作業は**やらなくてよい**。letter.html はURL直打ちで動く。

## letter.html の仕様（参考情報・変更不要）
- 案内状タブ: はがき裏面＝出欠返信面（縦書き）。表題／日程①②（日付・時刻）／「参加・不参加（　名）」／団体名・代表者名の記入欄／結びの文を編集可能。参考画像（IMG_3010 2.JPG の返信面レイアウト）準拠。
- 御礼状タブ: テンプレート4種（奉納御礼・祭礼終了報告・御寄進御礼・汎用）から選択→本文をテキストエリアで自由修正→縦書き出力。文面は仮のもので、後日正式文面に差し替え予定。
- フォント: 7種（ローカルの hgs_gyoshotai.ttf ＋ Google Fonts: Noto Serif JP / Noto Sans JP / Shippori Mincho B1 / Yuji Syuku / Zen Maru Gothic / Kaisei Tokumin）。
- 宛名: 本体アプリと同じ IndexedDB（DB名 `PdfMailMergeDB` v2 / ストア `records`）から名簿を読み込み、検索・複数選択。氏名＋住所を宛名面に差し込み、住所内の7桁数字から郵便番号を自動抽出。
- 印刷: `window.print()`。`@page { size: 100mm 148mm; margin: 0 }` ではがき原寸。選択者ごとに「裏面→表面」の順でページ出力（両面印刷・短辺とじで1枚に収まる）。

## 制約・注意
- **既存の index.html / app.js / sw.js / gas_script.js を letter.html のために書き換えないこと**（任意作業のリンク追加を除く）。
- letter.html は IndexedDB を**読み取り専用**で使う。名簿への書き込みは行わない設計。
- hgs_gyoshotai.ttf は既存のものをそのまま参照している。リネーム・移動しないこと。
- letter.html を Service Worker のキャッシュ対象に加える必要はない（オンライン時に開ければよい。Google Fonts を使うため元々オンライン前提）。
