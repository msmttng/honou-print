/**
 * 奉納ビラ 印刷＆名簿管理システム 用 Google Apps Script
 * 
 * 【列配置 (既存完全後方互換)】
 * A列: 日時 (timestamp)
 * B列: 台紙種類 (templateType)
 * C列: 奉納者氏名 (name)
 * D列: 金額/物品名 (amount - 元の入力文字列のまま保存)
 * E列: ID (reqId - 参照・検索キー)
 * F列: Token (token)
 * G列: 奉納袋番号 (bagNo)
 * H列: 住所 (address)
 * I列: 数値化金額 (表示専用: ¥10,000 等)
 */

// GETリクエスト: サジェストデータの取得、およびリストア
function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // mode=restore の場合は全履歴を返す (既存互換: tokenは含めない)
  if (e.parameter && e.parameter.mode === "restore") {
    let records = [];
    const sheet = ss.getSheetByName("履歴");
    if (sheet) {
      const hLastRow = getRealDataLastRow(sheet);
      if (hLastRow >= 2) {
        const historyData = sheet.getRange(2, 1, hLastRow - 1, 8).getValues();
        for (let r = 0; r < historyData.length; r++) {
          const row = historyData[r];
          if (!row[0] && !row[2] && !row[3]) continue; // 空行・合計行スキップ
          records.push({
            timestamp: row[0],
            templateType: row[1] || "",
            name: row[2] || "",
            amount: row[3] || "",
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
  
  const allSheets = ss.getSheets();
  for (let i = 0; i < allSheets.length; i++) {
    const s = allSheets[i];
    if (s.getName().startsWith("履歴")) {
      const hLastRow = getRealDataLastRow(s);
      if (hLastRow >= 2) {
        const historyData = s.getRange(2, 3, hLastRow - 1, 2).getValues(); // C列(氏名), D列(金額/物品名)
        for (let r = 0; r < historyData.length; r++) {
          const hName = historyData[r][0];
          if (hName !== undefined && hName !== null && hName.toString().trim() !== "") {
            data.names.push(hName.toString().trim());
          }
          
          const hAmountOrItem = historyData[r][1];
          if (hAmountOrItem !== undefined && hAmountOrItem !== null && hAmountOrItem.toString().trim() !== "") {
            const str = hAmountOrItem.toString().trim();
            // 数値のみ/金額のみを除いた物品名を抽出
            if (!/^[¥\\0-9,]+$/.test(str) && !str.includes("合計")) {
              data.items.push(str);
            }
          }
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
    
    // ヘッダー初期化（既存互換配置）
    setupHeaders(sheet);

    const timestamp = params.timestamp || new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
    const templateType = params.templateType || "";
    const name = params.name || "";
    const rawAmount = (params.amount || "").toString().trim();
    const reqId = params.id || "";
    const token = params.token || "";
    const bagNo = params.bagNo || "";
    const address = params.address || "";
    
    // 表示専用の数値化金額 (I列用)
    const formattedAmount = parseAmountToDisplay(rawAmount);

    // 削除アクション (E列/5列目が ID)
    if (params.action === "delete" && reqId) {
      const dataLastRow = getRealDataLastRow(sheet);
      if (dataLastRow >= 2) {
        const idVals = sheet.getRange(2, 5, dataLastRow - 1, 1).getValues();
        for (let i = 0; i < idVals.length; i++) {
          if (idVals[i][0] === reqId) {
            sheet.deleteRow(i + 2);
            updateSummaryRow(sheet);
            updateDashboardSheet(ss);
            return ContentService.createTextOutput(JSON.stringify({ result: "success", action: "deleted" }))
                                 .setMimeType(ContentService.MimeType.JSON);
          }
        }
      }
      return ContentService.createTextOutput(JSON.stringify({ result: "success", action: "not_found" }))
                           .setMimeType(ContentService.MimeType.JSON);
    }

    // 既存データの末尾を特定
    const realDataLastRow = getRealDataLastRow(sheet);
    let targetRow = realDataLastRow + 1;
    let isUpdate = false;
    
    // 冪等性チェック (E列/5列目が ID)
    if (reqId && realDataLastRow >= 2) {
      const idVals = sheet.getRange(2, 5, realDataLastRow - 1, 1).getValues();
      for (let i = 0; i < idVals.length; i++) {
        if (idVals[i][0] === reqId) {
          targetRow = i + 2;
          isUpdate = true;
          break;
        }
      }
    }

    // 旧配置完全互換データ行: A:日時, B:種類, C:氏名, D:金額/物品名(原形), E:ID, F:Token, G:袋番号, H:住所, I:表示用金額
    const rowValues = [timestamp, templateType, name, rawAmount, reqId, token, bagNo, address, formattedAmount];
    sheet.getRange(targetRow, 1, 1, 9).setValues([rowValues]);

    // 高速化: 全再描画ではなく対象行のみフォーマット適用
    applySingleRowFormatting(sheet, targetRow);
    
    // 末尾合計行と集計ダッシュボードの更新
    updateSummaryRow(sheet);
    updateDashboardSheet(ss);

    return ContentService.createTextOutput(JSON.stringify({ result: "success", action: isUpdate ? "updated" : "inserted" }))
                         .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ result: "error", message: error.toString() }))
                         .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

// ヘッダーの初期化（旧配置互換）
function setupHeaders(sheet) {
  const headers = ["日時", "台紙種類", "奉納者氏名", "金額/物品名", "ID", "Token", "奉納袋番号", "住所", "表示用金額"];
  if (sheet.getLastRow() < 1 || sheet.getRange(1, 1).getValue() === "") {
    sheet.getRange(1, 1, 1, 9).setValues([headers]);
  } else {
    // 既存ヘッダーの上書き（G, H, I列まで拡張）
    sheet.getRange(1, 1, 1, 9).setValues([headers]);
  }
  // ヘッダースタイル (ワインレッドバナー)
  sheet.getRange(1, 1, 1, 9)
       .setBackground("#4A1C1D")
       .setFontColor("#FFFFFF")
       .setFontWeight("bold")
       .setHorizontalAlignment("center")
       .setVerticalAlignment("middle");
}

// 原形文字列から表示専用の数値化金額（例: ¥10,000）へパース
function parseAmountToDisplay(valStr) {
  if (!valStr || valStr.includes("[空]") || valStr.includes("空")) return "";
  
  let cleaned = valStr.replace(/[¥\\,円金也\s]/g, "");
  if (/^\d+$/.test(cleaned)) {
    const num = parseInt(cleaned, 10);
    return "¥" + num.toLocaleString("ja-JP");
  }
  
  const kanjiMap = { '零':0, '一':1, '二':2, '三':3, '四':4, '五':5, '伍':5, '六':6, '七':7, '八':8, '九':9, '壱':1, '弐':2, '参':3 };
  const unitMap = { '十':10, '拾':10, '百':100, '佰':100, '千':1000, '阡':1000, '万':10000, '萬':10000 };
  
  let total = 0, section = 0, number = 0;
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
  return total > 0 ? "¥" + total.toLocaleString("ja-JP") : "";
}

// 実際のデータ最終行を取得（E列のID・D列のデータ・合計行除外）
function getRealDataLastRow(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 1;
  
  const values = sheet.getRange(1, 1, lastRow, 9).getValues();
  let dataLast = 1;
  
  for (let r = 1; r < lastRow; r++) {
    const row = values[r];
    if (row[2] === "合計金額" || (row[3] && row[3].toString().startsWith("合計金額")) || (row[3] && row[3].toString().startsWith("物品まとめ"))) {
      break;
    }
    if (row[0] || row[1] || row[2] || row[3] || row[4]) {
      dataLast = r + 1;
    }
  }
  return dataLast;
}

// 高速化: 単一行のみスタイル適用 (全再描画を回避)
function applySingleRowFormatting(sheet, rowIdx) {
  const range = sheet.getRange(rowIdx, 1, 1, 9);
  const bgColor = (rowIdx % 2 === 0) ? "#FFFFFF" : "#FDF2F4";
  
  range.setBackground(bgColor)
       .setFontColor("#1E293B")
       .setFontWeight("normal")
       .setBorder(true, true, true, true, true, true, "#CBD5E1", SpreadsheetApp.BorderStyle.SOLID);
       
  sheet.getRange(rowIdx, 1).setHorizontalAlignment("center"); // 日時
  sheet.getRange(rowIdx, 2).setHorizontalAlignment("center"); // 種類
  sheet.getRange(rowIdx, 3).setHorizontalAlignment("left");   // 氏名
  sheet.getRange(rowIdx, 4).setHorizontalAlignment("left");   // 金額/物品名
  sheet.getRange(rowIdx, 5, 1, 2).setHorizontalAlignment("left"); // ID, Token
  sheet.getRange(rowIdx, 7).setHorizontalAlignment("center"); // 袋番号
  sheet.getRange(rowIdx, 8).setHorizontalAlignment("left");   // 住所
  sheet.getRange(rowIdx, 9).setHorizontalAlignment("right");  // 表示用金額
}

// 末尾合計行の軽量更新 (2行空けた位置)
function updateSummaryRow(sheet) {
  const dataLastRow = getRealDataLastRow(sheet);
  const maxRow = sheet.getLastRow();
  
  // 既存の合計行エリアのみクリア
  if (maxRow > dataLastRow) {
    sheet.getRange(dataLastRow + 1, 1, maxRow - dataLastRow, 9).clearContent().clearFormat();
  }
  
  if (dataLastRow >= 2) {
    let totalAmount = 0;
    let itemsList = [];
    
    const data = sheet.getRange(2, 4, dataLastRow - 1, 6).getValues(); // D列(4)〜I列(9)
    for (let i = 0; i < data.length; i++) {
      const rawAmt = data[i][0] ? data[i][0].toString() : ""; // D列
      const dispAmt = data[i][5] ? data[i][5].toString() : ""; // I列
      
      const num = parseInt((dispAmt || rawAmt).replace(/[¥\\,円金也\s]/g, ""), 10);
      if (!isNaN(num) && num > 0 && !rawAmt.includes("[空]") && !rawAmt.includes("空")) {
        totalAmount += num;
      } else if (rawAmt.trim() !== "") {
        itemsList.push(rawAmt.trim());
      }
    }
    
    const summaryRow1 = dataLastRow + 3;
    const summaryRow2 = summaryRow1 + 1;
    
    // 合計金額行
    sheet.getRange(summaryRow1, 3).setValue("合計金額").setFontWeight("bold").setHorizontalAlignment("right");
    sheet.getRange(summaryRow1, 4).setValue("¥" + totalAmount.toLocaleString("ja-JP")).setFontWeight("bold").setHorizontalAlignment("right");
    sheet.getRange(summaryRow1, 9).setValue("¥" + totalAmount.toLocaleString("ja-JP")).setFontWeight("bold").setHorizontalAlignment("right");
    sheet.getRange(summaryRow1, 1, 1, 9).setBackground("#EAD7DA")
                                         .setBorder(true, false, false, false, false, false, "#4A1C1D", SpreadsheetApp.BorderStyle.DOUBLE);
    
    // 物品まとめ行
    const itemsStr = itemsList.length > 0 ? `物品まとめ (${itemsList.length}件): ` + itemsList.join(" / ") : "物品まとめ: なし";
    sheet.getRange(summaryRow2, 3).setValue("物品まとめ").setFontWeight("bold").setHorizontalAlignment("right");
    sheet.getRange(summaryRow2, 4).setValue(itemsStr).setFontWeight("bold").setHorizontalAlignment("left");
    sheet.getRange(summaryRow2, 1, 1, 9).setBackground("#FDF2F4");
  }
}

// 集計ダッシュボード（「集計」シート）の効率的更新
function updateDashboardSheet(ss) {
  let dSheet = ss.getSheetByName("集計");
  if (!dSheet) {
    dSheet = ss.insertSheet("集計", 0);
  }
  
  const historySheet = ss.getSheetByName("履歴");
  if (!historySheet) return;
  
  const dataLastRow = getRealDataLastRow(historySheet);
  const now = new Date();
  const todayStr = Utilities.formatDate(now, "Asia/Tokyo", "yyyy/M/d");
  const monthStr = Utilities.formatDate(now, "Asia/Tokyo", "yyyy/M");
  
  let todayTotal = 0, todayCount = 0, todayItemsCount = 0;
  let monthTotal = 0, monthCount = 0;
  let allTotal = 0, allCount = 0, allItemsCount = 0;
  
  let breakdown = {
    "10,000円": { count: 0, sum: 0 },
    "5,000円": { count: 0, sum: 0 },
    "3,000円": { count: 0, sum: 0 },
    "その他（1,000円等）": { count: 0, sum: 0 },
    "物品（[空]等）": { count: 0, sum: 0 }
  };
  
  if (dataLastRow >= 2) {
    const rawData = historySheet.getRange(2, 1, dataLastRow - 1, 9).getValues();
    for (let r = 0; r < rawData.length; r++) {
      const dateVal = rawData[r][0] ? rawData[r][0].toString() : "";
      const rawAmt = rawData[r][3] ? rawData[r][3].toString() : ""; // D列
      const dispAmt = rawData[r][8] ? rawData[r][8].toString() : ""; // I列
      
      const num = parseInt((dispAmt || rawAmt).replace(/[¥\\,円金也\s]/g, ""), 10);
      const isNum = !isNaN(num) && num > 0 && !rawAmt.includes("[空]") && !rawAmt.includes("空");
      
      allCount++;
      if (isNum) {
        allTotal += num;
        if (num === 10000) { breakdown["10,000円"].count++; breakdown["10,000円"].sum += num; }
        else if (num === 5000) { breakdown["5,000円"].count++; breakdown["5,000円"].sum += num; }
        else if (num === 3000) { breakdown["3,000円"].count++; breakdown["3,000円"].sum += num; }
        else { breakdown["その他（1,000円等）"].count++; breakdown["その他（1,000円等）"].sum += num; }
      } else if (rawAmt !== "") {
        allItemsCount++;
        breakdown["物品（[空]等）"].count++;
      }
      
      if (dateVal.includes(todayStr)) {
        todayCount++;
        if (isNum) todayTotal += num;
        if (!isNum && rawAmt !== "") todayItemsCount++;
      }
      if (dateVal.includes(monthStr)) {
        monthCount++;
        if (isNum) monthTotal += num;
      }
    }
  }

  // 高速なセル値直接書き換え（毎回クリアせずに値のみ一元更新）
  if (dSheet.getRange("A1").getValue() !== "奉納会計・集計ダッシュボード") {
    dSheet.clear();
    dSheet.getRange("A1:F2").merge().setValue("奉納会計・集計ダッシュボード").setBackground("#4A1C1D").setFontColor("#FFFFFF").setFontSize(18).setFontWeight("bold").setHorizontalAlignment("center").setVerticalAlignment("middle");
    dSheet.getRange("A6:B6").merge().setValue("☀️ 本日の奉納").setBackground("#8C2D38").setFontColor("#FFF").setFontWeight("bold").setHorizontalAlignment("center");
    dSheet.getRange("C6:D6").merge().setValue("📅 今月の奉納 (" + monthStr + ")").setBackground("#8C2D38").setFontColor("#FFF").setFontWeight("bold").setHorizontalAlignment("center");
    dSheet.getRange("E6:F6").merge().setValue("🏆 全 累 計").setBackground("#4A1C1D").setFontColor("#FFF").setFontWeight("bold").setHorizontalAlignment("center");
    dSheet.getRange("A10:F10").merge().setValue("📊 金額・金種別 内訳集計").setBackground("#8C2D38").setFontColor("#FFF").setFontWeight("bold").setHorizontalAlignment("left");
    dSheet.getRange("A11:D11").setValues([["区分・金種", "件数", "小計 (金額)", "構成比"]]).setBackground("#EAD7DA").setFontWeight("bold").setHorizontalAlignment("center");
    dSheet.getRange("A6:F8").setBorder(true, true, true, true, true, true, "#8C2D38", SpreadsheetApp.BorderStyle.SOLID);
    dSheet.setColumnWidth(1, 160); dSheet.setColumnWidth(2, 100); dSheet.setColumnWidth(3, 140); dSheet.setColumnWidth(4, 100); dSheet.setColumnWidth(5, 140); dSheet.setColumnWidth(6, 140);
  }

  // 値の更新
  dSheet.getRange("A4:F4").setValue("最終更新日時: " + Utilities.formatDate(now, "Asia/Tokyo", "yyyy年MM月dd日 HH:mm:ss"));
  dSheet.getRange("A7:B7").setValue("¥" + todayTotal.toLocaleString("ja-JP"));
  dSheet.getRange("A8:B8").setValue(`奉納件数: ${todayCount}件 (物品: ${todayItemsCount}件)`);
  dSheet.getRange("C7:D7").setValue("¥" + monthTotal.toLocaleString("ja-JP"));
  dSheet.getRange("C8:D8").setValue(`奉納件数: ${monthCount}件`);
  dSheet.getRange("E7:F7").setValue("¥" + allTotal.toLocaleString("ja-JP"));
  dSheet.getRange("E8:F8").setValue(`全件数: ${allCount}件 (物品: ${allItemsCount}件)`);
  
  let rowIdx = 12;
  const categories = ["10,000円", "5,000円", "3,000円", "その他（1,000円等）", "物品（[空]等）"];
  categories.forEach(cat => {
    const item = breakdown[cat];
    const ratio = allCount > 0 ? (item.count / allCount * 100).toFixed(1) + "%" : "0.0%";
    const sumStr = cat.includes("物品") ? "-" : "¥" + item.sum.toLocaleString("ja-JP");
    dSheet.getRange(rowIdx, 1, 1, 4).setValues([[cat, item.count + " 件", sumStr, ratio]]);
    rowIdx++;
  });
  dSheet.getRange(rowIdx, 1, 1, 4).setValues([["総合計", allCount + " 件", "¥" + allTotal.toLocaleString("ja-JP"), "100.0%"]]);
  dSheet.getRange("A11:D" + rowIdx).setBorder(true, true, true, true, true, true, "#CBD5E1", SpreadsheetApp.BorderStyle.SOLID);
}
