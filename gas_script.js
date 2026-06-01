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
  let sheet = ss.getSheetByName("サジェスト");
  
  // 【自動作成機能】もし「サジェスト」シートがなければ、自動的に作成して正しいヘッダーを書き込む
  if (!sheet) {
    sheet = ss.insertSheet("サジェスト");
    // 1行目に統合したシンプルなヘッダーを書き込み (共通氏名サジェストとフリー物品サジェストの2列)
    sheet.appendRow(["氏名サジェスト", "物品サジェスト"]);
    // 2行目に動作テスト用のサンプルデータを自動追加
    sheet.appendRow(["山田 太郎", "ビール 1ケース"]);
    sheet.appendRow(["佐藤 花子", "お神酒 二升"]);
    sheet.appendRow(["鈴木 一郎", "清酒 三本"]);
    SpreadsheetApp.flush();
  }
  
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  
  // データがない（ヘッダーのみ）の場合
  if (lastRow < 2) {
    return ContentService.createTextOutput(JSON.stringify({ 
      "names": [], 
      "items": [] 
    })).setMimeType(ContentService.MimeType.JSON);
  }
  
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const values = sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();
  
  const data = {
    "names": [],
    "items": []
  };
  
  // ==========================================
  // 【追加】「履歴」から始まるすべてのシートから奉納者名を読み込む（年度別対応）
  // ==========================================
  const allSheets = ss.getSheets();
  for (let i = 0; i < allSheets.length; i++) {
    const s = allSheets[i];
    if (s.getName().startsWith("履歴")) {
      const hLastRow = s.getLastRow();
      if (hLastRow >= 2) {
        // C列（3列目）が奉納者氏名
        const historyNames = s.getRange(2, 3, hLastRow - 1, 1).getValues();
        for (let r = 0; r < historyNames.length; r++) {
          const hName = historyNames[r][0];
          if (hName !== undefined && hName !== null && hName.toString().trim() !== "") {
            data.names.push(hName.toString().trim());
          }
        }
      }
    }
  }
  
  for (let col = 0; col < lastColumn; col++) {
    const header = headers[col];
    
    // 【超強力後方互換マージ】新ヘッダー名（2列構成）でも旧ヘッダー名（4列構成）でも、自動判別してnames/itemsに統合します
    const isName = header === "氏名サジェスト" || 
                   header === "萬圓_氏名サジェスト" || 
                   header === "阡圓_氏名サジェスト" || 
                   header === "フリー_氏名サジェスト";
    const isItem = header === "物品サジェスト" || 
                   header === "フリー_物品サジェスト";
    
    let key = "";
    if (isName) key = "names";
    else if (isItem) key = "items";
    
    if (key) {
      for (let row = 0; row < values.length; row++) {
        const val = values[row][col];
        if (val !== undefined && val !== null && val.toString().trim() !== "") {
          data[key].push(val.toString().trim());
        }
      }
    }
  }
  
  // 重複した氏名を綺麗に排除
  data.names = data.names.filter((v, i, a) => a.indexOf(v) === i);
  
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

