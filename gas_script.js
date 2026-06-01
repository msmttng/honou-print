/**
 * 奉納ビラ 印刷＆名簿管理システム 用 Google Apps Script
 * 
 * 【セットアップ手順】
 * 1. スプレッドシートを新規作成（または既存のものを開く）します。
 * 2. シートを2つ作成し、それぞれ以下の名前に変更します。
 *    - 「履歴」 シート
 *    - 「サジェスト」 シート
 * 3. 各シートの1行目（ヘッダー）に以下を入力します。
 *    - 「履歴」シート: A1に「日時」、B1に「台紙種類」、C1に「奉納者氏名」、D1に「金額/物品名」
 *    - 「サジェスト」シート: A1に「萬圓_氏名サジェスト」、B1に「阡圓_氏名サジェスト」、C1に「フリー_氏名サジェスト」、D1に「フリー_物品サジェスト」
 * 4. スプレッドシートのメニュー「拡張機能」 ➡️ 「Apps Script」を開きます。
 * 5. 最初から入っている `myFunction` をすべて消去し、このコード全体を貼り付けます。
 * 6. 右上の「デプロイ」 ➡️ 「新しいデプロイ」をクリックします。
 * 7. 種類の選択（歯車アイコン）で「ウェブアプリ」を選択します。
 * 8. 設定：
 *    - 説明: 任意（例: 奉納ビラ連携API）
 *    - 次のユーザーとして実行: 「自分（あなたのGoogleアカウント）」
 *    - アクセスできるユーザー: 「全員」 (※重要！ログイン不要でアプリから連携できるようにするため)
 * 9. 「デプロイ」をクリックします（初回はGoogleアカウントへのアクセス承認を求められるので「アクセスを承認」し、「詳細を表示」➡️「安全ではないページに移動」をクリックして許可してください）。
 * 10. 発行された「ウェブアプリのURL」をコピーし、印刷アプリの「スプレッドシート（GAS）連携設定」のURL欄に貼り付けます。
 */

// GETリクエスト: サジェストデータの取得
function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  const data = {
    "names": [],
    "items": []
  };
  
  // 「履歴」から始まるすべてのシートから奉納者名（C列）と物品名（D列）を読み込む
  const allSheets = ss.getSheets();
  for (let i = 0; i < allSheets.length; i++) {
    const s = allSheets[i];
    if (s.getName().startsWith("履歴")) {
      const hLastRow = s.getLastRow();
      if (hLastRow >= 2) {
        // C列（3列目）とD列（4列目）を一括取得
        const historyData = s.getRange(2, 3, hLastRow - 1, 2).getValues();
        for (let r = 0; r < historyData.length; r++) {
          // 氏名
          const hName = historyData[r][0];
          if (hName !== undefined && hName !== null && hName.toString().trim() !== "") {
            data.names.push(hName.toString().trim());
          }
          
          // 金額/物品名
          const hItem = historyData[r][1];
          if (hItem !== undefined && hItem !== null && hItem.toString().trim() !== "") {
            const val = hItem.toString().trim();
            // 金額っぽい文字列（数字のみ、または金・円・圓・也・空が含まれる）を除外して物品名のみを抽出
            if (!/^[0-9,]+$/.test(val) && !val.includes("金") && !val.includes("円") && !val.includes("圓") && !val.includes("也") && !val.includes("空")) {
              data.items.push(val);
            }
          }
        }
      }
    }
  }
  
  // 重複を排除
  data.names = data.names.filter((v, i, a) => a.indexOf(v) === i);
  data.items = data.items.filter((v, i, a) => a.indexOf(v) === i);
  
  return ContentService.createTextOutput(JSON.stringify(data))
                       .setMimeType(ContentService.MimeType.JSON);
}

// POSTリクエスト: 履歴データの書き込み
function doPost(e) {
  try {
    const params = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName("履歴");
    
    // 履歴シートがない場合は自動作成
    if (!sheet) {
      sheet = ss.insertSheet("履歴");
      sheet.appendRow(["日時", "台紙種類", "奉納者氏名", "金額/物品名"]);
    }
    
    const timestamp = params.timestamp || new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
    const templateType = params.templateType || "";
    const name = params.name || "";
    const amount = params.amount || "";
    
    sheet.appendRow([timestamp, templateType, name, amount]);
    
    return ContentService.createTextOutput(JSON.stringify({ result: "success" }))
                         .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ result: "error", message: error.toString() }))
                         .setMimeType(ContentService.MimeType.JSON);
  }
}

