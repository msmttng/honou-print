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

// GETリクエスト: サジェストデータの取得、およびリストア
function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // mode=restore の場合は全履歴を返す
  if (e.parameter && e.parameter.mode === "restore") {
    let records = [];
    const sheet = ss.getSheetByName("履歴");
    if (sheet) {
      const hLastRow = sheet.getLastRow();
      if (hLastRow >= 2) {
        // A列からE列まで取得 (日時, 種類, 氏名, 金額, ID)
        const historyData = sheet.getRange(2, 1, hLastRow - 1, 8).getValues();
        for (let r = 0; r < historyData.length; r++) {
          const row = historyData[r];
          records.push({
            timestamp: row[0],
            templateType: row[1],
            name: row[2],
            amount: row[3],
            id: row[4] || "",
            bagNo: row[6] || "",
            address: row[7] || ""
          });
        }
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ records: records }))
                         .setMimeType(ContentService.MimeType.JSON);
  }

  // サジェストデータの取得ロジック
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
            // 金額っぽい文字列を除外して物品名のみを抽出
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

// POSTリクエスト: 履歴データの書き込み (LockService + 冪等性対応)
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    // 同時アクセス防ぐため最大10秒ロックを待機
    if (!lock.tryLock(10000)) {
      return ContentService.createTextOutput(JSON.stringify({ result: "error", message: "System busy. Please try again." }))
                           .setMimeType(ContentService.MimeType.JSON);
    }

    const params = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName("履歴");
    
    // 履歴シートがない場合は自動作成
    if (!sheet) {
      sheet = ss.insertSheet("履歴");
      sheet.appendRow(["日時", "台紙種類", "奉納者氏名", "金額/物品名", "ID", "Token", "奉納袋番号", "住所"]);
    }
    
    // 既存シートに新カラム（奉納袋番号・住所）のヘッダが無ければ補う
    if (sheet.getRange(1, 7).getValue() === "") {
      sheet.getRange(1, 7, 1, 2).setValues([["奉納袋番号", "住所"]]);
    }

    const timestamp = params.timestamp || new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
    const templateType = params.templateType || "";
    const name = params.name || "";
    const amount = params.amount || "";
    const reqId = params.id || "";
    const token = params.token || "";
    const bagNo = params.bagNo || "";
    const address = params.address || "";
    
    // 削除アクションの処理
    if (params.action === "delete" && reqId) {
      const lastRow = sheet.getLastRow();
      if (lastRow >= 2) {
        const idVals = sheet.getRange(2, 5, lastRow - 1, 1).getValues();
        for (let i = 0; i < idVals.length; i++) {
          if (idVals[i][0] === reqId) {
            sheet.deleteRow(i + 2);
            return ContentService.createTextOutput(JSON.stringify({ result: "success", action: "deleted" }))
                                 .setMimeType(ContentService.MimeType.JSON);
          }
        }
      }
      return ContentService.createTextOutput(JSON.stringify({ result: "success", action: "not_found" }))
                           .setMimeType(ContentService.MimeType.JSON);
    }
    
    // 冪等性: reqId がある場合、すでに同じIDが登録されていないか確認
    if (reqId) {
      const lastRow = sheet.getLastRow();
      if (lastRow >= 2) {
        // E列(5列目)がID
        const idVals = sheet.getRange(2, 5, lastRow - 1, 1).getValues();
        for (let i = 0; i < idVals.length; i++) {
          if (idVals[i][0] === reqId) {
            // すでに存在する場合は上書きして終了（再送時の重複回避）
            sheet.getRange(i + 2, 1, 1, 8).setValues([[timestamp, templateType, name, amount, reqId, token, bagNo, address]]);
            return ContentService.createTextOutput(JSON.stringify({ result: "success", action: "updated" }))
                                 .setMimeType(ContentService.MimeType.JSON);
          }
        }
      }
    }
    
    // 新規追加
    sheet.appendRow([timestamp, templateType, name, amount, reqId, token, bagNo, address]);
    
    return ContentService.createTextOutput(JSON.stringify({ result: "success", action: "inserted" }))
                         .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ result: "error", message: error.toString() }))
                         .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

