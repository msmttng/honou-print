/**
 * 奉納ビラ 印刷＆名簿管理システム 用 Google Apps Script
 *
 * 【現行シート「履歴」の列配置 (8列)】
 * A列: 日時        B列: 奉納者氏名   C列: 金額/物品名   D列: 金額［空］/物品
 * E列: ID          F列: Token        G列: 奉納袋番号     H列: 住所
 *
 * 【旧シート「履歴2025」の列配置 (6列)】
 * A列: 日時  B列: 台紙種類  C列: 奉納者氏名  D列: 金額/物品名  E列: ID  F列: Token
 *
 * どちらも1行目の見出し名から列を自動解決するため、GAS側の書き換えは不要。
 */

/**
 * 【重要】列位置はヘッダー行(1行目)の見出し名から自動解決します。
 * シートの列順を変えても、GAS側を書き換える必要はありません。
 * 見出しが読めない場合のみ、上記の標準8列配置にフォールバックします。
 */
var COL_ALIASES = {
  ts:     ["日時", "タイムスタンプ", "日付"],
  name:   ["奉納者氏名", "氏名", "名前", "奉納者"],
  amount: ["金額/物品名", "金額・物品名", "金額", "金額／物品名"],
  item:   ["金額［空］/物品", "金額[空]/物品", "物品 / [空]", "物品", "物品名"],
  id:     ["ID", "id"],
  token:  ["Token", "token", "トークン"],
  bag:    ["奉納袋番号", "袋番号", "番号"],
  addr:   ["住所"],
  disp:   ["表示用金額", "数値化金額"]
};
// 標準配置 (1始まりの列番号)
var COL_FALLBACK = { ts:1, name:2, amount:3, id:4, token:5, bag:6, addr:7, disp:8, item:0 };

function normHeader(s) {
  return (s === null || s === undefined) ? "" : s.toString().replace(/[\s　]/g, "").toLowerCase();
}

/** ヘッダー行から列番号(1始まり)を解決。見つからない項目は 0。 */
function resolveCols(sheet) {
  var cols = { ts:0, name:0, amount:0, item:0, id:0, token:0, bag:0, addr:0, disp:0 };
  var lastCol = sheet.getLastColumn();
  var found = 0;
  if (lastCol >= 1) {
    var hdr = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    for (var key in COL_ALIASES) {
      var aliases = COL_ALIASES[key].map(normHeader);
      for (var c = 0; c < hdr.length; c++) {
        if (aliases.indexOf(normHeader(hdr[c])) !== -1) { cols[key] = c + 1; found++; break; }
      }
    }
  }
  // ヘッダーが実質読めない場合は標準配置にフォールバック
  if (found < 3 || !cols.name) {
    for (var k in COL_FALLBACK) cols[k] = COL_FALLBACK[k];
  }
  return cols;
}

/** 集計行(合計金額 / 物品まとめ)のラベルかどうか */
function isSummaryLabel(v) {
  var t = (v === null || v === undefined) ? "" : v.toString().trim();
  return t.indexOf("合計") === 0 || t.indexOf("物品まとめ") === 0;
}

/** 解決済み列で1行分の値を取り出すヘルパー */
function pick(row, colIdx) {
  if (!colIdx || colIdx > row.length) return "";
  var v = row[colIdx - 1];
  return (v === null || v === undefined) ? "" : v;
}

// GETリクエスト: サジェストデータの取得、およびリストア
function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // mode=restore の場合は全履歴を返す (既存互換: tokenは含めない)
  if (e.parameter && e.parameter.mode === "restore") {
    let records = [];
    const sheet = ss.getSheetByName("履歴");
    if (sheet) {
      const hLastRow = getRealDataLastRow(sheet);
      const C = resolveCols(sheet);
      const width = Math.max(sheet.getLastColumn(), 8);
      if (hLastRow >= 2) {
        const historyData = sheet.getRange(2, 1, hLastRow - 1, width).getValues();
        for (let r = 0; r < historyData.length; r++) {
          const row = historyData[r];
          const nm = pick(row, C.name).toString().trim();
          let amt = pick(row, C.amount).toString().trim();
          if (!amt) amt = pick(row, C.item).toString().trim();
          if (!nm && !amt) continue;                 // 空行スキップ
          if (isSummaryLabel(nm)) continue;          // 合計金額 / 物品まとめ 行スキップ
          records.push({
            timestamp: pick(row, C.ts),
            templateType: "",
            name: nm,
            amount: amt,
            id: pick(row, C.id),
            bagNo: pick(row, C.bag),
            address: pick(row, C.addr)
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
      const C = resolveCols(s);
      const width = Math.max(s.getLastColumn(), 8);
      if (hLastRow >= 2) {
        const raw = s.getRange(2, 1, hLastRow - 1, width).getValues();
        const historyData = raw.map(function (row) {
          let a = pick(row, C.amount).toString().trim();
          if (!a) a = pick(row, C.item).toString().trim();
          return [pick(row, C.name), a];
        });
        for (let r = 0; r < historyData.length; r++) {
          const hName = historyData[r][0];
          if (hName !== undefined && hName !== null && hName.toString().trim() !== ""
              && !isSummaryLabel(hName.toString().trim())) {
            data.names.push(hName.toString().trim());
          }
          
          const hAmountOrItem = historyData[r][1];
          if (hAmountOrItem !== undefined && hAmountOrItem !== null && hAmountOrItem.toString().trim() !== "") {
            const str = hAmountOrItem.toString().trim();
            // 数値のみ/金額のみを除いた物品名を抽出
            if (!/^[¥\\0-9,]+$/.test(str) && !isSummaryLabel(str) && str.indexOf("物品まとめ") !== 0) {
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
    
    // ヘッダー初期化: 空シートのときだけ。既存シートの見出しは絶対に上書きしない
    if (sheet.getLastRow() === 0) setupHeaders(sheet);
    const C = resolveCols(sheet);

    const timestamp = params.timestamp || new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
    const name = params.name || "";
    const rawAmount = (params.amount || "").toString().trim();
    const reqId = params.id || "";
    const token = params.token || "";
    const bagNo = params.bagNo || "";
    const address = params.address || "";
    
    // 表示専用の数値化金額 (I列用)
    const formattedAmount = parseAmountToDisplay(rawAmount);

    // 削除アクション (D列/4列目が ID)
    if (params.action === "delete" && reqId) {
      const dataLastRow = getRealDataLastRow(sheet);
      if (dataLastRow >= 2) {
        const idVals = sheet.getRange(2, C.id || 4, dataLastRow - 1, 1).getValues();
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
    
    // 冪等性チェック (D列/4列目が ID)
    if (reqId && realDataLastRow >= 2) {
      const idVals = sheet.getRange(2, C.id || 4, realDataLastRow - 1, 1).getValues();
      for (let i = 0; i < idVals.length; i++) {
        if (idVals[i][0] === reqId) {
          targetRow = i + 2;
          isUpdate = true;
          break;
        }
      }
    }

    // データ行: 解決済みの列位置へ書き込む（シートの列順に追従）
    // [空]/物品 は専用列があればそちらへ振り分ける
    const isItem = rawAmount.indexOf("[空]") !== -1 || rawAmount.indexOf("［空］") !== -1;
    const amountCell = (isItem && C.item) ? "" : rawAmount;
    const itemCell   = (isItem && C.item) ? rawAmount : null;

    const writeMap = [
      [C.ts, timestamp], [C.name, name], [C.amount, amountCell],
      [itemCell === null ? 0 : C.item, itemCell],
      [C.id, reqId], [C.token, token], [C.bag, bagNo],
      [C.addr, address], [C.disp, formattedAmount]
    ];
    for (let w = 0; w < writeMap.length; w++) {
      const colIdx = writeMap[w][0];
      if (colIdx) sheet.getRange(targetRow, colIdx).setValue(writeMap[w][1]);
    }

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
  const headers = ["日時", "奉納者氏名", "金額/物品名", "金額［空］/物品", "ID", "Token", "奉納袋番号", "住所"];
  sheet.getRange(1, 1, 1, 8).setValues([headers]);
  // ヘッダースタイル (ワインレッドバナー)
  sheet.getRange(1, 1, 1, 8)
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
  
  const values = sheet.getRange(1, 1, lastRow, 8).getValues();
  let dataLast = 1;
  
  for (let r = 1; r < lastRow; r++) {
    const row = values[r];
    if (row[1] === "合計金額" || (row[2] && row[2].toString().startsWith("合計金額")) || (row[2] && row[2].toString().startsWith("物品まとめ"))) {
      break;
    }
    if (row[0] || row[1] || row[2] || row[3]) {
      dataLast = r + 1;
    }
  }
  return dataLast;
}

// 高速化: 単一行のみスタイル適用 (全再描画を回避)
function applySingleRowFormatting(sheet, rowIdx) {
  const range = sheet.getRange(rowIdx, 1, 1, 8);
  const bgColor = (rowIdx % 2 === 0) ? "#FFFFFF" : "#FDF2F4";
  
  range.setBackground(bgColor)
       .setFontColor("#1E293B")
       .setFontWeight("normal")
       .setBorder(true, true, true, true, true, true, "#CBD5E1", SpreadsheetApp.BorderStyle.SOLID);
       
  sheet.getRange(rowIdx, 1).setHorizontalAlignment("center"); // 日時
  sheet.getRange(rowIdx, 2).setHorizontalAlignment("left");   // 氏名
  sheet.getRange(rowIdx, 3).setHorizontalAlignment("left");   // 金額/物品名
  sheet.getRange(rowIdx, 4, 1, 2).setHorizontalAlignment("left"); // ID, Token
  sheet.getRange(rowIdx, 6).setHorizontalAlignment("center"); // 袋番号
  sheet.getRange(rowIdx, 7).setHorizontalAlignment("left");   // 住所
  sheet.getRange(rowIdx, 8).setHorizontalAlignment("right");  // 表示用金額
}

// 末尾合計行の軽量更新 (2行空けた位置)
function updateSummaryRow(sheet) {
  const dataLastRow = getRealDataLastRow(sheet);
  const maxRow = sheet.getLastRow();
  
  // 既存の合計行エリアのみクリア
  if (maxRow > dataLastRow) {
    sheet.getRange(dataLastRow + 1, 1, maxRow - dataLastRow, Math.max(sheet.getLastColumn(), 8)).clearContent().clearFormat();
  }
  
  if (dataLastRow >= 2) {
    let totalAmount = 0;
    let itemsList = [];
    
    const C = resolveCols(sheet);
    const width = Math.max(sheet.getLastColumn(), 8);
    const data = sheet.getRange(2, 1, dataLastRow - 1, width).getValues();
    for (let i = 0; i < data.length; i++) {
      const amtCell  = pick(data[i], C.amount).toString();
      const itemCell = pick(data[i], C.item).toString();
      let rawAmt = amtCell.trim() ? amtCell : itemCell;
      const dispAmt = pick(data[i], C.disp).toString();
      
      const hasLeadingNum = /^\s*[0-9,]+\s*[\[［]空/.test(rawAmt);
      const num = parseInt((dispAmt || rawAmt).replace(/[¥\\,円金也\s]/g, ""), 10);
      const isMoney = !isNaN(num) && num > 0 &&
                      (hasLeadingNum || (!rawAmt.includes("[空]") && !rawAmt.includes("［空］")));
      if (isMoney) {
        totalAmount += num;
      } else if (rawAmt.trim() !== "") {
        itemsList.push(rawAmt.trim());
      }
    }
    
    const summaryRow1 = dataLastRow + 3;
    const summaryRow2 = summaryRow1 + 1;
    
    // 合計金額行
    sheet.getRange(summaryRow1, 2).setValue("合計金額").setFontWeight("bold").setHorizontalAlignment("right");
    sheet.getRange(summaryRow1, 3).setValue("¥" + totalAmount.toLocaleString("ja-JP")).setFontWeight("bold").setHorizontalAlignment("right");
    if (C.disp) sheet.getRange(summaryRow1, C.disp).setValue("¥" + totalAmount.toLocaleString("ja-JP")).setFontWeight("bold").setHorizontalAlignment("right");
    sheet.getRange(summaryRow1, 1, 1, width).setBackground("#D6E4F2")
                                         .setBorder(true, false, false, false, false, false, "#2E5C8A", SpreadsheetApp.BorderStyle.DOUBLE);
    
    // 物品まとめ行
    const itemsStr = itemsList.length > 0 ? `物品まとめ (${itemsList.length}件): ` + itemsList.join(" / ") : "物品まとめ: なし";
    sheet.getRange(summaryRow2, 2).setValue("物品まとめ").setFontWeight("bold").setHorizontalAlignment("right");
    sheet.getRange(summaryRow2, C.item || 3).setValue(itemsStr).setFontWeight("bold").setHorizontalAlignment("left");
    sheet.getRange(summaryRow2, 1, 1, width).setBackground("#EEF4FB");
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
    const C = resolveCols(historySheet);
    const width = Math.max(historySheet.getLastColumn(), 8);
    const rawData = historySheet.getRange(2, 1, dataLastRow - 1, width).getValues();
    for (let r = 0; r < rawData.length; r++) {
      const dateVal = pick(rawData[r], C.ts).toString();
      let rawAmt = pick(rawData[r], C.amount).toString();
      if (!rawAmt.trim()) rawAmt = pick(rawData[r], C.item).toString();
      const dispAmt = pick(rawData[r], C.disp).toString();
      
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
