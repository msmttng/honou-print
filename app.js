// --- 定数・グローバル変数 ---
const DEFAULT_CONFIG_URL = "templates_config.json";
const FONT_URL = "ipaexm.ttf"; // カレントディレクトリにダウンロード済みのフォントを参照

let currentTemplate = "10000en";
let config = null;             // テンプレートごとの初期座標・フォントサイズ設定
let designSettings = {};       // ユーザー調整後の座標・フォントサイズ (LocalStorage保存用)
let loadedFontBytes = null;    // キャッシュされたフォントデータのArrayBuffer
let loadedTemplateBytes = {};  // キャッシュされたテンプレートPDFのArrayBuffer
let dbRecords = [];            // 名簿レコード一覧 (LocalStorage保存用)
let autoUpdateTimer = null;    // リアルタイムプレビュー用デバウンスタイマー

// --- 起動時の初期化処理 ---
window.addEventListener("DOMContentLoaded", async () => {
    showStatus("システム初期化中...", true);
    
    // 1. デザイン設定および名簿DBの復元
    loadDesignSettings();
    loadDbRecords();
    renderTable();

    // 2. 設定ファイルの読み込み
    try {
        const response = await fetch(DEFAULT_CONFIG_URL);
        if (!response.ok) throw new Error("設定ファイルの読み込みに失敗しました");
        config = await response.ok ? await response.json() : getFallbackConfig();
    } catch (e) {
        console.warn("設定ファイル fetch 失敗。内蔵フォールバック設定を使用します:", e);
        config = getFallbackConfig();
    }

    // 3. デザイン設定の初期座標マージ
    initDesignSettings();
    updateCalibrationUI();

    // 4. 日本語フォントのプリロード (バックグラウンドでキャッシュ)
    try {
        showStatus("日本語フォントロード中...", true);
        const fontResponse = await fetch(FONT_URL);
        if (!fontResponse.ok) throw new Error("フォントファイルの読み込みに失敗しました");
        loadedFontBytes = await fontResponse.arrayBuffer();
        showStatus("準備完了", false);
    } catch (e) {
        console.error("フォントのロードに失敗しました:", e);
        showStatus("フォントロード失敗 (システムフォント使用)", false);
        showToast("フォントの読み込みに失敗しました。標準フォントで描画します。", "error");
    }

    // 5. 初回プレビュー更新
    updatePreview();
});

// --- フォールバック設定 (config.jsonがない場合のデフォルト定義) ---
function getFallbackConfig() {
    return {
        "default_font": "IPAexMincho",
        "templates": {
            "10000en": {
                "template_file": "奉納ビラ縦.pdf",
                "fields": {
                    "name": { "x_mm": 105, "y_mm": 120, "font_size": 28, "alignment": "center" }
                }
            },
            "1000en": {
                "template_file": "奉納ビラ縦阡.pdf",
                "fields": {
                    "name": { "x_mm": 105, "y_mm": 120, "font_size": 28, "alignment": "center" }
                }
            },
            "free": {
                "template_file": "奉納ビラフリー.pdf",
                "fields": {
                    "name": { "x_mm": 105, "y_mm": 160, "font_size": 28, "alignment": "center" },
                    "amount": { "x_mm": 105, "y_mm": 90, "font_size": 24, "alignment": "center" }
                }
            }
        }
    };
}

// --- デザイン設定の初期化とLocalStorage連携 ---
function initDesignSettings() {
    // configの内容をベースに、LocalStorageにない設定値のみ初期値で埋める
    for (const [tKey, tVal] of Object.entries(config.templates)) {
        if (!designSettings[tKey]) {
            designSettings[tKey] = {};
        }
        for (const [fKey, fVal] of Object.entries(tVal.fields)) {
            if (!designSettings[tKey][fKey]) {
                designSettings[tKey][fKey] = {
                    x: fVal.x_mm,
                    y: fVal.y_mm,
                    font_size: fVal.font_size
                };
            }
        }
    }
    saveDesignSettings();
}

function loadDesignSettings() {
    const saved = localStorage.getItem("pdf_mail_merge_design_settings");
    if (saved) {
        try {
            designSettings = JSON.parse(saved);
        } catch (e) {
            console.error("LocalStorageデザイン設定パースエラー:", e);
            designSettings = {};
        }
    }
}

function saveDesignSettings() {
    localStorage.setItem("pdf_mail_merge_design_settings", JSON.stringify(designSettings));
}

// --- 名簿データベース（履歴）のLocalStorage連携 ---
function loadDbRecords() {
    const saved = localStorage.getItem("pdf_mail_merge_db");
    if (saved) {
        try {
            dbRecords = JSON.parse(saved);
        } catch (e) {
            console.error("LocalStorage名簿DBパースエラー:", e);
            dbRecords = [];
        }
    }
}

function saveDbRecords() {
    localStorage.setItem("pdf_mail_merge_db", JSON.stringify(dbRecords));
}

// --- テンプレートPDFの取得 (キャッシュ対応) ---
async function getTemplateBytes(templateKey) {
    if (loadedTemplateBytes[templateKey]) {
        return loadedTemplateBytes[templateKey];
    }
    
    const filename = config.templates[templateKey].template_file;
    showStatus("テンプレートPDF読み込み中...", true);
    
    const response = await fetch(encodeURI(filename));
    if (!response.ok) {
        throw new Error(`テンプレートファイルが見つかりません: ${filename}`);
    }
    
    const bytes = await response.arrayBuffer();
    loadedTemplateBytes[templateKey] = bytes; // オンメモリキャッシュ
    showStatus("準備完了", false);
    return bytes;
}

// --- 状態表示の更新 ---
function showStatus(text, isLoading) {
    const statusText = document.getElementById("statusText");
    const icon = document.querySelector("#loadingStatus i");
    
    statusText.textContent = text;
    if (isLoading) {
        icon.className = "fa-solid fa-circle-notch";
        icon.style.display = "inline-block";
    } else {
        icon.className = "fa-solid fa-circle-check";
        icon.style.color = "#34d399";
        // 準備完了時はしばらくしてアイコンだけチェックマークにして点滅を止める
    }
}

// --- テンプレート切り替え処理 ---
function selectTemplate(templateKey) {
    currentTemplate = templateKey;
    
    // UIボタンのアクティブ表示変更
    document.querySelectorAll(".template-btn").forEach(btn => btn.classList.remove("active"));
    document.getElementById(`btn-${templateKey}`).classList.add("active");
    
    // フリー用の金額フィールド表示切替
    const amountField = document.getElementById("amountField");
    const amountCalibSection = document.getElementById("amountCalibSection");
    if (templateKey === "free") {
        amountField.style.display = "block";
        amountCalibSection.style.display = "block";
    } else {
        amountField.style.display = "none";
        amountCalibSection.style.display = "none";
    }
    
    // 微調整UIの値を現在のテンプレートのデータに更新
    updateCalibrationUI();
    
    // プレビュー再描画
    updatePreview();
}

// --- 微調整UI数値の更新 ---
function updateCalibrationUI() {
    const settings = designSettings[currentTemplate];
    if (!settings) return;

    for (const [fieldKey, fieldVal] of Object.entries(settings)) {
        const valX = document.getElementById(`val-${fieldKey}-x`);
        const valY = document.getElementById(`val-${fieldKey}-y`);
        const valFontSize = document.getElementById(`val-${fieldKey}-font_size`);
        
        if (valX) valX.textContent = fieldVal.x;
        if (valY) valY.textContent = fieldVal.y;
        if (valFontSize) valFontSize.textContent = fieldVal.font_size;
    }
}

// --- 画面上での数値調整処理 ---
function adjustValue(fieldKey, param, change) {
    const settings = designSettings[currentTemplate];
    if (!settings || !settings[fieldKey]) return;

    settings[fieldKey][param] = parseFloat((settings[fieldKey][param] + change).toFixed(1));
    
    // UI数値を即時更新
    document.getElementById(`val-${fieldKey}-${param}`).textContent = settings[fieldKey][param];
    
    // LocalStorage保存
    saveDesignSettings();
    
    // プレビューの自動更新（デバウンスで実行）
    triggerAutoUpdate();
}

// --- デザイン調整の初期値リセット ---
function resetCalibration() {
    const defaultFields = config.templates[currentTemplate].fields;
    for (const [fieldKey, fieldVal] of Object.entries(defaultFields)) {
        designSettings[currentTemplate][fieldKey] = {
            x: fieldVal.x_mm,
            y: fieldVal.y_mm,
            font_size: fieldVal.font_size
        };
    }
    saveDesignSettings();
    updateCalibrationUI();
    updatePreview();
    showToast("デザイン調整を初期値にリセットしました");
}

// --- リアルタイムプレビュー用デバウンス制御 ---
function triggerAutoUpdate() {
    if (autoUpdateTimer) clearTimeout(autoUpdateTimer);
    autoUpdateTimer = setTimeout(() => {
        updatePreview();
    }, 300); // 300ms 入力が止まったらリレンダリング
}

// --- 単位変換: mm -> pt ---
function mmToPt(mm) {
    return mm * 72 / 25.4;
}

// --- PDFの動的合成処理（コア機能） ---
async function generatePDF() {
    const nameInput = document.getElementById("nameInput").value.trim();
    const amountInput = document.getElementById("amountInput").value.trim();
    
    // 氏名がない場合は合成処理をスキップ (プレビュークリア状態に)
    if (!nameInput) {
        return null;
    }

    try {
        // 1. テンプレートPDFの取得
        const templateBytes = await getTemplateBytes(currentTemplate);
        
        // 2. pdf-libでPDFをロード
        const pdfDoc = await PDFLib.PDFDocument.load(templateBytes);
        
        // 3. 日本語フォントの読み込みと埋め込み
        let fontToUse = null;
        if (loadedFontBytes) {
            pdfDoc.registerFontkit(window.fontkit); // 必要な場合はfontkitを使用。通常TrueTypeの埋め込みで不要な場合もあるが、日本語TTFはregisterFontkitが必要。
            // ※ pdf-lib.min.js に標準の日本語フォントは含まれていないため、TTFを埋め込みます
            fontToUse = await pdfDoc.embedFont(loadedFontBytes, { subset: true });
        } else {
            // フォールバック: 標準フォント (日本語文字化けする可能性大)
            fontToUse = await pdfDoc.embedStandardFont(PDFLib.StandardFonts.Helvetica);
        }

        const pages = pdfDoc.getPages();
        const firstPage = pages[0];
        
        // デザイン調整値の読み出し
        const settings = designSettings[currentTemplate];
        const data = {
            name: nameInput,
            amount: amountInput
        };

        // 各フィールドの描画
        for (const [fieldKey, fieldVal] of Object.entries(settings)) {
            const textValue = data[fieldKey];
            if (!textValue) continue;

            const x_pt = mmToPt(fieldVal.x);
            const y_pt = mmToPt(fieldVal.y);
            const fontSize = fieldVal.font_size;
            
            // アライメント（中央揃えなど）の計算
            let drawX = x_pt;
            const textWidth = fontToUse.widthOfTextAtSize(textValue, fontSize);
            const alignment = config.templates[currentTemplate].fields[fieldKey].alignment || "left";
            
            if (alignment === "center") {
                drawX = x_pt - (textWidth / 2);
            } else if (alignment === "right") {
                drawX = x_pt - textWidth;
            }

            // 文字描画
            firstPage.drawText(textValue, {
                x: drawX,
                y: y_pt,
                size: fontSize,
                font: fontToUse,
                color: PDFLib.rgb(0.1, 0.1, 0.1) // ほぼ黒
            });
        }

        // 4. PDFを保存してBlobを生成
        const pdfBytes = await pdfDoc.save();
        return new Blob([pdfBytes], { type: "application/pdf" });

    } catch (e) {
        console.error("PDF合成エラー:", e);
        showToast("PDF合成中にエラーが発生しました", "error");
        showStatus("PDF生成エラー", false);
        return null;
    }
}

// --- リアルタイムプレビュー更新 ---
async function updatePreview() {
    const pdfPreview = document.getElementById("pdfPreview");
    const previewPlaceholder = document.getElementById("previewPlaceholder");
    
    showStatus("PDF生成中...", true);
    const pdfBlob = await generatePDF();
    
    if (pdfBlob) {
        const pdfUrl = URL.createObjectURL(pdfBlob);
        pdfPreview.src = pdfUrl;
        pdfPreview.style.display = "block";
        previewPlaceholder.style.display = "none";
        showStatus("プレビュー更新完了", false);
    } else {
        // 氏名未入力等の場合は初期表示へ
        pdfPreview.style.display = "none";
        previewPlaceholder.style.display = "flex";
        showStatus("準備完了", false);
    }
}

// --- 印刷 / PDF保存アクション ---
async function printPDF() {
    const nameInput = document.getElementById("nameInput").value.trim();
    if (!nameInput) {
        showToast("氏名を入力してから印刷してください", "error");
        return;
    }

    showStatus("印刷用データを準備中...", true);
    const pdfBlob = await generatePDF();
    
    if (pdfBlob) {
        const pdfUrl = URL.createObjectURL(pdfBlob);
        
        // 別タブで開いて印刷を実行させる
        const newWindow = window.open(pdfUrl, "_blank");
        if (newWindow) {
            newWindow.onload = () => {
                newWindow.print();
            };
            showToast("印刷プレビューを別タブで開きました");
        } else {
            // ポップアップがブロックされた場合は直接ダウンロード
            const link = document.createElement("a");
            link.href = pdfUrl;
            link.download = `奉納ビラ_${nameInput}.pdf`;
            link.click();
            showToast("ポップアップがブロックされたため、PDFをダウンロードしました");
        }
        showStatus("印刷データ出力完了", false);
        
        // 印刷履歴への登録
        saveRecord(false); // 重複を避けるため静かに自動登録
    }
}

// --- データベース（履歴登録・表示）処理 ---
function saveRecord(showNotice = true) {
    const nameInput = document.getElementById("nameInput").value.trim();
    const amountInput = document.getElementById("amountInput").value.trim();
    
    if (!nameInput) {
        if (showNotice) showToast("氏名を入力してください", "error");
        return;
    }

    // 重複チェック (同一の氏名かつ金額かつテンプレートが直近にあればスキップ)
    const isDuplicate = dbRecords.some(r => 
        r.name === nameInput && 
        r.amount === amountInput && 
        r.template === currentTemplate &&
        (new Date().getTime() - new Date(r.date).getTime() < 30000) // 30秒以内の同一データ
    );
    
    if (isDuplicate) return;

    const newRecord = {
        id: "rec_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
        date: new Date().toISOString(),
        template: currentTemplate,
        name: nameInput,
        amount: currentTemplate === "free" ? amountInput : (currentTemplate === "10000en" ? "金萬圓也" : "金阡圆也")
    };

    dbRecords.unshift(newRecord); // 先頭に追加
    saveDbRecords();
    renderTable();
    
    if (showNotice) {
        showToast("名簿に正常に登録しました！");
    }
}

function deleteRecord(id) {
    if (confirm("このレコードを名簿から削除しますか？")) {
        dbRecords = dbRecords.filter(r => r.id !== id);
        saveDbRecords();
        renderTable();
        showToast("名簿から削除しました");
    }
}

// --- 名簿アイテムのフォーム呼び出し ---
function loadRecordToForm(id) {
    const record = dbRecords.find(r => r.id === id);
    if (!record) return;

    // 1. テンプレートの変更
    selectTemplate(record.template);
    
    // 2. フォーム入力値の設定
    document.getElementById("nameInput").value = record.name;
    if (record.template === "free") {
        document.getElementById("amountInput").value = record.amount;
    } else {
        document.getElementById("amountInput").value = "";
    }

    // 3. プレビューの再描画
    updatePreview();
    showToast("名簿データを入力フォームに読み込みました");
}

// --- 名簿テーブルのレンダリング ---
function renderTable() {
    const tbody = document.getElementById("historyTableBody");
    const searchInput = document.getElementById("searchInput").value.trim().toLowerCase();
    
    tbody.innerHTML = "";
    
    // 検索フィルタリング
    const filteredRecords = dbRecords.filter(r => 
        r.name.toLowerCase().includes(searchInput) || 
        r.amount.toLowerCase().includes(searchInput)
    );

    if (filteredRecords.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="no-data">登録されている名簿データはありません。</td></tr>`;
        return;
    }

    filteredRecords.forEach(r => {
        const tr = document.createElement("tr");
        
        // 日付フォーマット
        const d = new Date(r.date);
        const dateStr = `${d.getFullYear()}/${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getDate().toString().padStart(2,'0')} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
        
        // テンプレートバッジ
        let badgeClass = "badge-10000";
        let badgeText = "萬圓用";
        if (r.template === "1000en") {
            badgeClass = "badge-100";
            badgeText = "阡圓用";
        } else if (r.template === "free") {
            badgeClass = "badge-free";
            badgeText = "フリー";
        }

        tr.innerHTML = `
            <td>${dateStr}</td>
            <td><span class="badge ${badgeClass}">${badgeText}</span></td>
            <td style="font-weight: 500;">${escapeHTML(r.name)}</td>
            <td>${escapeHTML(r.amount)}</td>
            <td>
                <div class="action-btns">
                    <button class="btn-table btn-table-edit" onclick="loadRecordToForm('${r.id}')">
                        <i class="fa-solid fa-arrows-spin"></i>呼び出す
                    </button>
                    <button class="btn-table btn-table-del" onclick="deleteRecord('${r.id}')">
                        <i class="fa-solid fa-trash-can"></i>削除
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// --- CSVエクスポート機能 ---
function exportCSV() {
    if (dbRecords.length === 0) {
        showToast("エクスポートするデータがありません", "error");
        return;
    }

    let csvContent = "\ufeff"; // Excelでの文字化けを防ぐためのBOM付きUTF-8
    csvContent += "日時,テンプレート種類,奉納者氏名,金額/物品名\n";

    dbRecords.forEach(r => {
        const d = new Date(r.date);
        const dateStr = `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${d.getMinutes()}`;
        const templateStr = r.template === "10000en" ? "萬圓用" : (r.template === "1000en" ? "阡圓用" : "フリー用");
        
        // カンマやダブルクォーテーションのエスケープ
        const escapedName = `"${r.name.replace(/"/g, '""')}"`;
        const escapedAmount = `"${r.amount.replace(/"/g, '""')}"`;

        csvContent += `${dateStr},${templateStr},${escapedName},${escapedAmount}\n`;
    });

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `奉納名簿履歴_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("名簿データをCSVとして出力しました！");
}

// --- アコーディオンの開閉 ---
function toggleAccordion() {
    const accordion = document.getElementById("calibrationAccordion");
    const arrow = document.getElementById("accordionArrow");
    
    accordion.classList.toggle("open");
    if (accordion.classList.contains("open")) {
        arrow.className = "fa-solid fa-chevron-up";
    } else {
        arrow.className = "fa-solid fa-chevron-down";
    }
}

// --- フォームのクリア ---
function clearForm() {
    document.getElementById("nameInput").value = "";
    document.getElementById("amountInput").value = "";
    updatePreview();
    showToast("フォームをクリアしました");
}

// --- HTMLエスケープ ---
function escapeHTML(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// --- トースト通知の表示 ---
function showToast(message, type = "success") {
    const toast = document.getElementById("toast");
    const icon = toast.querySelector("i");
    const msgSpan = document.getElementById("toastMessage");
    
    msgSpan.textContent = message;
    
    if (type === "error") {
        toast.className = "toast show toast-error";
        icon.className = "fa-solid fa-circle-xmark";
    } else {
        toast.className = "toast show";
        icon.className = "fa-solid fa-circle-check";
    }
    
    setTimeout(() => {
        toast.classList.remove("show");
    }, 3000);
}
