/**
 * 奉納ビラ 印刷＆名簿管理システム 用 Google Apps Script
 */

// GETリクエスト: サジェストデータの取得、およびリストア
function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // mode=restore の場合は全履歴を返す
  if (e.parameter && e.parameter.mode === "restore") {
    let records = [];
    const sheet = ss.getSheetByName("履歴");
    if (sheet) {
      const hLastRow = getRealLastRow(sheet);
      if (hLastRow >= 2) {
        // A列からH列まで取得 (日時, 氏名, 金額, 物品, 奉納袋番号, 住所, ID, Token)
        const historyData = sheet.getRange(2, 1, hLastRow - 1, 8).getValues();
        for (let r = 0; r < historyData.length; r++) {
          const row = historyData[r];
          if (row[0] === "" && row[1] === "" && row[2] === "") continue;
          records.push({
            timestamp: row[0],
            name: row[1],
            amount: row[2] || row[3] || "", 
            bagNo: row[4] || "",
            address: row[5] || "",
            id: row[6] || "",
            token: row[7] || ""
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
  
  const allSheets = ss.getSheets();
  for (let i = 0; i < allSheets.length; i++) {
    const s = allSheets[i];
    if (s.getName().startsWith("履歴")) {
      const hLastRow = getRealLastRow(s);
      if (hLastRow >= 2) {
        const historyData = s.getRange(2, 2, hLastRow - 1, 3).getValues(); // B列(氏名), C列(金額), D列(物品)
        for (let r = 0; r < historyData.length; r++) {
          const hName = historyData[r][0]; // B列: 氏名
          if (hName !== undefined && hName !== null && hName.toString().trim() !== "") {
            data.names.push(hName.toString().trim());
          }
          
          const hAmount = historyData[r][1]; // C列
          const hItem = historyData[r][2];   // D列
          [hAmount, hItem].forEach(val => {
            if (val !== undefined && val !== null && val.toString().trim() !== "") {
              const str = val.toString().trim();
              if (!/^[¥\\0-9,]+$/.test(str) && !str.includes("合計")) {
                data.items.push(str);
              }
            }
          });
        }
      }
    }
  }
  
  data.names = data.names.filter((v, i, a) => a.indexOf(v) === i);
  data.items = data.items.filter((v, i, a) => a.indexOf(v) === i);
  
  return ContentService.createTextOutput(JSON.stringify(data))
                       .setMimeType(ContentService.MimeType.JSON);
}

// POSTリクエスト: 履歴データの書き込み
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(10000)) {
      return ContentService.createTextOutput(JSON.stringify({ result: "error", message: "System busy. Please try again." }))
                           .setMimeType(ContentService.MimeType.JSON);
    }

    const params = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName("履歴");
    
    if (!sheet) {
      sheet = ss.insertSheet("履歴");
    }
    
    // ヘッダーの初期化・更新（A:日時, B:奉納者氏名, C:金額, D:物品/[空], E:奉納袋番号, F:住所, G:ID, H:Token）
    setupHeaders(sheet);

    const timestamp = params.timestamp || new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
    const name = params.name || "";
    const rawAmount = (params.amount || "").toString().trim();
    const reqId = params.id || "";
    const token = params.token || "";
    const bagNo = params.bagNo || "";
    const address = params.address || "";
    
    // [空] データ判定
    const isKuu = rawAmount.includes("[空]") || rawAmount.includes("空");
    const parsedAmount = parseAmount(rawAmount);
    
    let amountVal = "";
    let itemVal = "";
    
    if (isKuu || parsedAmount === null) {
      itemVal = rawAmount;
    } else {
      amountVal = parsedAmount;
    }

    // 削除アクション (G列/7列目が ID)
    if (params.action === "delete" && reqId) {
      const dataLastRow = getRealDataLastRow(sheet);
      if (dataLastRow >= 2) {
        const idVals = sheet.getRange(2, 7, dataLastRow - 1, 1).getValues();
        for (let i = 0; i < idVals.length; i++) {
          if (idVals[i][0] === reqId) {
            sheet.deleteRow(i + 2);
            applyFormattingAndSummary(sheet);
            return ContentService.createTextOutput(JSON.stringify({ result: "success", action: "deleted" }))
                                 .setMimeType(ContentService.MimeType.JSON);
          }
        }
      }
      return ContentService.createTextOutput(JSON.stringify({ result: "success", action: "not_found" }))
                           .setMimeType(ContentService.MimeType.JSON);
    }

    const realDataLastRow = getRealDataLastRow(sheet);
    let targetRow = realDataLastRow + 1;
    
    // 冪等性チェック (G列/7列目が ID)
    if (reqId && realDataLastRow >= 2) {
      const idVals = sheet.getRange(2, 7, realDataLastRow - 1, 1).getValues();
      for (let i = 0; i < idVals.length; i++) {
        if (idVals[i][0] === reqId) {
          targetRow = i + 2;
          break;
        }
      }
    }

    // 列配置: A:日時, B:氏名, C:金額, D:物品/[空], E:奉納袋番号, F:住所, G:ID, H:Token
    const rowValues = [timestamp, name, amountVal, itemVal, bagNo, address, reqId, token];
    sheet.getRange(targetRow, 1, 1, 8).setValues([rowValues]);

    // デザイン適用＆合計・まとめ行更新
    applyFormattingAndSummary(sheet);

    return ContentService.createTextOutput(JSON.stringify({ result: "success", action: "processed" }))
                         .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ result: "error", message: error.toString() }))
                         .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

// ヘッダー初期化・全8列の項目名を正しくバナー設定
function setupHeaders(sheet) {
  const headers = ["日時", "奉納者氏名", "金額", "物品 / [空]", "奉納袋番号", "住所", "ID", "Token"];
  sheet.getRange(1, 1, 1, 8).setValues([headers]);
}

// 金額パース関数
function parseAmount(valStr) {
  if (!valStr || valStr.includes("[空]") || valStr.includes("空")) return null;
  
  let cleaned = valStr.replace(/[¥\\,円金也\s]/g, "");
  
  if (/^\d+$/.test(cleaned)) {
    const num = parseInt(cleaned, 10);
    return "¥" + num.toLocaleString("ja-JP");
  }
  
  const kanjiMap = { '零':0, '一':1, '二':2, '三':3, '四':4, '五':5, '伍':5, '六':6, '七':7, '八':8, '九':9, '壱':1, '弐':2, '参':3 };
  const unitMap = { '十':10, '拾':10, '百':100, '佰':100, '千':1000, '阡':1000, '万':10000, '萬':10000 };
  
  let total = 0;
  let section = 0;
  let number = 0;
  
  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];
    if (kanjiMap[char] !== undefined) {
      number = kanjiMap[char];
    } else if (/\d/.test(char)) {
      number = parseInt(char, 10);
    } else if (unitMap[char] !== undefined) {
      const unit = unitMap[char];
      if (unit === 10000) {
        section = (section + number) * unit;
        total += section;
        section = 0;
      } else {
        section += (number === 0 ? 1 : number) * unit;
      }
      number = 0;
    }
  }
  total += section + number;
  
  if (total > 0) {
    return "¥" + total.toLocaleString("ja-JP");
  }
  
  return null;
}

// データ最終行の取得 (G列/7列目のIDまたはA~F列のデータ存在で判定)
function getRealDataLastRow(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 1;
  
  const values = sheet.getRange(1, 1, lastRow, 8).getValues();
  let dataLast = 1;
  
  for (let r = 1; r < lastRow; r++) {
    const row = values[r];
    if (row[1] === "合計金額" || (row[2] && row[2].toString().startsWith("合計金額")) || (row[3] && row[3].toString().startsWith("物品まとめ"))) {
      break;
    }
    // A~Hのいずれかにデータがあればデータ行
    if (row[0] || row[1] || row[2] || row[3] || row[4] || row[5] || row[6] || row[7]) {
      dataLast = r + 1;
    }
  }
  return dataLast;
}

function getRealLastRow(sheet) {
  return sheet.getLastRow();
}

// フォーマット・デザイン適用
function applyFormattingAndSummary(sheet) {
  const dataLastRow = getRealDataLastRow(sheet);
  const maxRow = sheet.getLastRow();
  
  if (maxRow > dataLastRow) {
    sheet.getRange(dataLastRow + 1, 1, maxRow - dataLastRow, 8).clearContent().clearFormat();
  }
  
  // 1. ヘッダー全8列のスタイル (エンジ色背景 #4A1C1D、白文字太字、中央寄せ)
  const headerRange = sheet.getRange(1, 1, 1, 8);
  headerRange.setBackground("#4A1C1D")
             .setFontColor("#FFFFFF")
             .setFontWeight("bold")
             .setHorizontalAlignment("center")
             .setVerticalAlignment("middle");
             
  if (dataLastRow >= 2) {
    // 2. データ行ゼブラスタイル (交互背景色)
    const dataRange = sheet.getRange(2, 1, dataLastRow - 1, 8);
    dataRange.setFontColor("#1E293B")
             .setFontWeight("normal")
             .setBorder(true, true, true, true, true, true, "#CBD5E1", SpreadsheetApp.BorderStyle.SOLID);
             
    for (let r = 2; r <= dataLastRow; r++) {
      const bgColor = (r % 2 === 0) ? "#FFFFFF" : "#FDF2F4";
      sheet.getRange(r, 1, 1, 8).setBackground(bgColor);
    }
    
    // アライメント
    sheet.getRange(2, 1, dataLastRow - 1, 1).setHorizontalAlignment("center"); // 日時
    sheet.getRange(2, 2, dataLastRow - 1, 1).setHorizontalAlignment("left");   // 氏名
    sheet.getRange(2, 3, dataLastRow - 1, 1).setHorizontalAlignment("right");  // 金額
    sheet.getRange(2, 4, dataLastRow - 1, 1).setHorizontalAlignment("left");   // 物品
    sheet.getRange(2, 5, dataLastRow - 1, 1).setHorizontalAlignment("center"); // 奉納袋番号
    sheet.getRange(2, 6, dataLastRow - 1, 1).setHorizontalAlignment("left");   // 住所
    sheet.getRange(2, 7, dataLastRow - 1, 2).setHorizontalAlignment("left");   // ID, Token
    
    // 3. 合計計算＆物品まとめ
    let totalAmount = 0;
    let itemsList = [];
    
    const cData = sheet.getRange(2, 3, dataLastRow - 1, 2).getValues();
    for (let i = 0; i < cData.length; i++) {
      const cVal = cData[i][0];
      const dVal = cData[i][1];
      
      if (cVal) {
        const num = parseInt(cVal.toString().replace(/[¥\\,]/g, ""), 10);
        if (!isNaN(num)) {
          totalAmount += num;
        }
      }
      if (dVal && dVal.toString().trim() !== "") {
        itemsList.push(dVal.toString().trim());
      }
    }
    
    // 4. 2行空けた位置に「合計金額」と「物品まとめ」行を追加
    const summaryRow1 = dataLastRow + 3;
    const summaryRow2 = summaryRow1 + 1;
    
    // 行1: 合計金額
    sheet.getRange(summaryRow1, 2).setValue("合計金額").setFontWeight("bold").setHorizontalAlignment("right");
    sheet.getRange(summaryRow1, 3).setValue("¥" + totalAmount.toLocaleString("ja-JP")).setFontWeight("bold").setHorizontalAlignment("right");
    sheet.getRange(summaryRow1, 1, 1, 8).setBackground("#EAD7DA")
                                         .setBorder(true, false, false, false, false, false, "#4A1C1D", SpreadsheetApp.BorderStyle.DOUBLE);
    
    // 行2: 物品まとめ (D列に記載)
    const itemsSummaryStr = itemsList.length > 0 
      ? `物品まとめ (${itemsList.length}件): ` + itemsList.join(" / ")
      : "物品まとめ: なし";
      
    sheet.getRange(summaryRow2, 2).setValue("物品まとめ").setFontWeight("bold").setHorizontalAlignment("right");
    sheet.getRange(summaryRow2, 4).setValue(itemsSummaryStr).setFontWeight("bold").setHorizontalAlignment("left");
    sheet.getRange(summaryRow2, 1, 1, 8).setBackground("#FDF2F4");
  }
}
