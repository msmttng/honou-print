// --- エラー収集ロジック ---
window.addEventListener("error", function(e) {
    logError("Global Error: " + e.message + " at " + e.filename + ":" + e.lineno);
});
window.addEventListener("unhandledrejection", function(e) {
    logError("Unhandled Promise Rejection: " + (e.reason && e.reason.stack ? e.reason.stack : e.reason));
});

function logError(msg) {
    console.error("LOG:", msg);
    const debugLog = document.getElementById("debugLog");
    const container = document.getElementById("debugLogContainer");
    if (debugLog && container) {
        debugLog.textContent += new Date().toLocaleTimeString() + " - " + msg + "\n";
        container.style.display = "block";
    }
}

function copyDebugLog() {
    const debugLog = document.getElementById("debugLog");
    if (debugLog) {
        navigator.clipboard.writeText(debugLog.textContent).then(() => {
            alert("ログをクリップボードにコピーしました！");
        }).catch(err => {
            alert("コピーに失敗しました。直接選択してコピーしてください。");
        });
    }
}

// --- 定数・グローバル変数 ---
const FONT_URL = "yuji_syuku.ttf"; // 代替の美しい毛筆行書体（TTF形式）を使用
const DEFAULT_CONFIG_URL = "templates_config.json"; // テンプレート座標設定ファイル

let currentTemplate = "10000en";
let config = null;             // テンプレートごとの初期座標・フォントサイズ設定
let designSettings = {};       // ユーザー調整後の座標・フォントサイズ (LocalStorage保存用)
let loadedFontBytes = null;    // キャッシュされたフォントデータのArrayBuffer
let loadedTemplateBytes = {};  // キャッシュされたテンプレートPDFのArrayBuffer
let dbRecords = [];            // 名簿レコード一覧 (LocalStorage保存用)
let autoUpdateTimer = null;    // リアルタイムプレビュー用デバウンスタイマー
let isAppReady = false;        // アプリケーション（DB等）の初期化完了フラグ

// --- IndexedDB ストレージ管理 ---
const DB_NAME = "PdfMailMergeDB";
const STORE_NAME = "files";

async function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function saveFileToDB(key, arrayBuffer) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.put(arrayBuffer, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function getFileFromDB(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function checkRequiredFiles() {
    const required = ["font_yuji", "pdf_10000en", "pdf_1000en", "pdf_free"];
    const results = {};
    for (const key of required) {
        results[key] = (await getFileFromDB(key)) !== undefined;
    }
    return results;
}

// --- 起動時の初期化処理 ---
window.addEventListener("DOMContentLoaded", async () => {
    // file:// プロトコルの警告は起動用ブラウザ（--allow-file-access-from-files）を使用することで回避するため削除

    showStatus("システム初期化中...", true);
    
    // 1. デザイン設定および名簿DBの復元
    loadDesignSettings();
    loadDbRecords();
    renderTable();

    // 2. 設定ファイルの読み込み (ローカル設定をハードコードで使用)
    config = getFallbackConfig();

    // 3. バージョンチェックによるLocalStorageキャッシュクリア (新設定強制適用)
    const currentVersion = config.config_version || 1;
    try {
        const savedVersion = localStorage.getItem("pdf_mail_merge_config_version");
        if (savedVersion !== String(currentVersion)) {
            console.log(`設定バージョンが更新されました (${savedVersion} -> ${currentVersion})。キャッシュをリセットします。`);
            localStorage.removeItem("pdf_mail_merge_design_settings");
            localStorage.setItem("pdf_mail_merge_config_version", currentVersion);
            designSettings = {}; // キャッシュをクリア
            // 再度ロードして空の状態に初期化
            loadDesignSettings();
        }
    } catch (e) {
        console.warn("LocalStorageアクセスエラー(バージョンチェック):", e);
    }

    // 4. デザイン設定の初期座標マージ
    initDesignSettings();
    updateCalibrationUI();

    // --- ここからローカルファイルチェッカー ---
    showStatus("ローカルファイル確認中...", true);
    const fileStatus = await checkRequiredFiles();
    const allFilesReady = fileStatus.font_yuji && fileStatus.pdf_10000en && fileStatus.pdf_1000en && fileStatus.pdf_free;

    if (allFilesReady) {
        // 全てのファイルがDBにある場合、フォントをメモリに読み込んでアプリ起動
        await loadAppFromDB();
    } else {
        // 足りないファイルがある場合、自動ダウンロードを試行
        showStatus("初回セットアップ中...（通信環境により数秒かかります）", true);
        const placeholder = document.getElementById("previewPlaceholder");
        if (placeholder) {
            placeholder.innerHTML = '<i class="fa-solid fa-cloud-arrow-down fa-bounce"></i><p>初期ファイルをダウンロードしています...<br>少々お待ちください</p><p style="font-size:11px;opacity:0.7">（初回のみ8MB程度の通信が発生します）</p>';
        }
        try {
            const fetchFile = async (url, key) => {
                const response = await fetch(encodeURI(url));
                if (!response.ok) throw new Error(`ファイルが見つかりません: ${url}`);
                const buffer = await response.arrayBuffer();
                await saveFileToDB(key, buffer);
            };

            const promises = [];
            if (!fileStatus.font_yuji) promises.push(fetchFile("yuji_syuku.ttf", "font_yuji"));
            if (!fileStatus.pdf_10000en) promises.push(fetchFile("奉納ビラ縦.pdf", "pdf_10000en"));
            if (!fileStatus.pdf_1000en) promises.push(fetchFile("奉納ビラ縦阡.pdf", "pdf_1000en"));
            if (!fileStatus.pdf_free) promises.push(fetchFile("奉納ビラフリー.pdf", "pdf_free"));

            await Promise.all(promises);
            
            // ダウンロード成功後、アプリを起動
            await loadAppFromDB();
        } catch (e) {
            // 自動ダウンロードに失敗した場合のみ、手動セットアップ画面を表示
            logError("自動ダウンロード失敗: " + e.message);
            showSetupOverlay(fileStatus);
        }
    }
});

// アプリ本体の起動プロセス
async function loadAppFromDB() {
    try {
        showStatus("フォント読み込み中...", true);
        loadedFontBytes = await getFileFromDB("font_yuji");
        loadedTemplateBytes["10000en"] = await getFileFromDB("pdf_10000en");
        loadedTemplateBytes["1000en"] = await getFileFromDB("pdf_1000en");
        loadedTemplateBytes["free"] = await getFileFromDB("pdf_free");
        
        showStatus("準備完了", false);
        isAppReady = true;
        selectTemplate("10000en"); // プレビュー更新開始
    } catch (e) {
        logError("データベースからの読み込みに失敗しました: " + e);
    }
}

// セットアップオーバーレイ制御
function showSetupOverlay(status) {
    const overlay = document.getElementById("setupOverlay");
    overlay.classList.remove("hidden");
    
    const fileInput = document.getElementById("fileInput");
    const dropZone = document.getElementById("dropZone");
    const btnComplete = document.getElementById("btnCompleteSetup");
    
    // UI初期化
    updateSetupUI(status);

    // ドラッグ＆ドロップイベント
    dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("dragover"); });
    dropZone.addEventListener("dragleave", e => { e.preventDefault(); dropZone.classList.remove("dragover"); });
    dropZone.addEventListener("drop", async e => {
        e.preventDefault();
        dropZone.classList.remove("dragover");
        if (e.dataTransfer.files) {
            await handleSetupFiles(e.dataTransfer.files, status);
        }
    });

    // クリックでファイル選択
    dropZone.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async e => {
        if (e.target.files) {
            await handleSetupFiles(e.target.files, status);
        }
    });

    // 保存して開始ボタン
    btnComplete.addEventListener("click", async () => {
        if (btnComplete.classList.contains("ready")) {
            overlay.classList.add("hidden");
            await loadAppFromDB();
        }
    });
}

function updateSetupUI(status) {
    const updateItem = (id, isReady) => {
        const el = document.getElementById(id);
        if (isReady) {
            el.innerHTML = '<i class="fa-solid fa-circle-check success"></i> ' + el.innerText.trim();
        }
    };
    if (status.font_yuji) updateItem("status-font", true);
    if (status.pdf_10000en) updateItem("status-pdf-10000", true);
    if (status.pdf_1000en) updateItem("status-pdf-1000", true);
    if (status.pdf_free) updateItem("status-pdf-free", true);

    if (status.font_yuji && status.pdf_10000en && status.pdf_1000en && status.pdf_free) {
        document.getElementById("btnCompleteSetup").classList.add("ready");
    }
}

async function handleSetupFiles(files, status) {
    for (const file of files) {
        const name = file.name.toLowerCase();
        const buffer = await file.arrayBuffer();
        
        if (name.endsWith(".ttf") || name.endsWith(".ttc")) {
            await saveFileToDB("font_yuji", buffer);
            status.font_yuji = true;
        } else if (name.includes("縦") && !name.includes("阡")) {
            await saveFileToDB("pdf_10000en", buffer);
            status.pdf_10000en = true;
        } else if (name.includes("阡")) {
            await saveFileToDB("pdf_1000en", buffer);
            status.pdf_1000en = true;
        } else if (name.includes("フリー")) {
            await saveFileToDB("pdf_free", buffer);
            status.pdf_free = true;
        }
    }
    updateSetupUI(status);
}

// --- フォールバック設定 (config.jsonがない場合のデフォルト定義) ---
function getFallbackConfig() {
    return {
        "config_version": 8,
        "default_font": "HGSGyoshotai",
        "templates": {
            "10000en": {
                "template_file": "奉納ビラ縦.pdf",
                "fields": {
                    "name": { "x_mm": 21.5, "y_mm": 151, "font_size": 98, "alignment": "center", "vertical": true, "width_mm": 24, "height_mm": 150 },
                    "amount": { "x_mm": 62.5, "y_mm": 222, "font_size": 131, "alignment": "center", "width_mm": 80, "height_mm": 50 }
                }
            },
            "1000en": {
                "template_file": "奉納ビラ縦阡.pdf",
                "fields": {
                    "name": { "x_mm": 21.5, "y_mm": 151, "font_size": 98, "alignment": "center", "vertical": true, "width_mm": 24, "height_mm": 150 },
                    "amount": { "x_mm": 62.5, "y_mm": 222, "font_size": 131, "alignment": "center", "width_mm": 80, "height_mm": 50 }
                }
            },
            "free": {
                "template_file": "奉納ビラフリー.pdf",
                "fields": {
                    "name": { "x_mm": 21.5, "y_mm": 132, "font_size": 98, "alignment": "center", "vertical": true, "width_mm": 25, "height_mm": 126 },
                    "amount": { "x_mm": 62.5, "y_mm": 264, "font_size": 98, "alignment": "center", "vertical": true, "width_mm": 45, "height_mm": 190 }
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
                designSettings[tKey][fKey] = {};
            }
            if (designSettings[tKey][fKey].x === undefined) designSettings[tKey][fKey].x = fVal.x_mm;
            if (designSettings[tKey][fKey].y === undefined) designSettings[tKey][fKey].y = fVal.y_mm;
            if (designSettings[tKey][fKey].font_size === undefined) designSettings[tKey][fKey].font_size = fVal.font_size;
            if (designSettings[tKey][fKey].width_mm === undefined) designSettings[tKey][fKey].width_mm = fVal.width_mm || 30;
            if (designSettings[tKey][fKey].height_mm === undefined) designSettings[tKey][fKey].height_mm = fVal.height_mm || 150;
            if (designSettings[tKey][fKey].valign === undefined) designSettings[tKey][fKey].valign = fVal.valign || "top";
        }
    }
    saveDesignSettings();
}

function loadDesignSettings() {
    try {
        const saved = localStorage.getItem("pdf_mail_merge_design_settings");
        if (saved) {
            designSettings = JSON.parse(saved);
        }
    } catch (e) {
        console.error("LocalStorageデザイン設定アクセスエラー:", e);
        designSettings = {};
    }
}

function saveDesignSettings() {
    try {
        localStorage.setItem("pdf_mail_merge_design_settings", JSON.stringify(designSettings));
    } catch (e) {
        console.warn("LocalStorage保存エラー:", e);
    }
}

// --- 名簿データベース（履歴）のLocalStorage連携 ---
function loadDbRecords() {
    try {
        const saved = localStorage.getItem("pdf_mail_merge_db");
        if (saved) {
            dbRecords = JSON.parse(saved);
        }
    } catch (e) {
        console.error("LocalStorage名簿DBアクセスエラー:", e);
        dbRecords = [];
    }
}

function saveDbRecords() {
    try {
        localStorage.setItem("pdf_mail_merge_db", JSON.stringify(dbRecords));
    } catch (e) {
        console.warn("LocalStorage保存エラー:", e);
    }
}

// --- テンプレートPDFの取得 (キャッシュ対応) ---
async function getTemplateBytes(templateKey) {
    if (loadedTemplateBytes[templateKey]) {
        return loadedTemplateBytes[templateKey];
    }
    
    const filename = config.templates[templateKey].template_file;
    showStatus("テンプレートPDF読み込み中...", true);
    
    // ブラウザのキャッシュを回避するため、クエリパラメータを付与
    const response = await fetch(encodeURI(filename) + "?t=" + new Date().getTime());
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
    
    // すべてのテンプレートで金額を印字・微調整可能にするため、常に金額フィールドを表示
    const amountField = document.getElementById("amountField");
    const amountCalibSection = document.getElementById("amountCalibSection");
    amountField.style.display = "block";
    amountCalibSection.style.display = "block";

    // 選択されたテンプレートに応じて自動的に金額の初期値・ラベル・プレースホルダーを設定
    const amountLabel = document.getElementById("amountLabel") || document.querySelector("label[for='amountInput']");
    const amountInput = document.getElementById("amountInput");
    const amountSelect = document.getElementById("amountSelect");
    
    if (templateKey === "10000en" || templateKey === "1000en") {
        amountLabel.textContent = "任意の金額の数字一文字 (例: 一, 二, 五)";
        amountInput.style.display = "none";
        if(amountSelect) amountSelect.style.display = "block";
    } else {
        amountLabel.textContent = "任意の金額 または 物品名";
        amountInput.placeholder = "例: 金 五阡圓也、お神酒 二升";
        amountInput.style.display = "block";
        if(amountSelect) amountSelect.style.display = "none";
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
        const valWidth = document.getElementById(`val-${fieldKey}-width_mm`);
        const valHeight = document.getElementById(`val-${fieldKey}-height_mm`);
        const valValign = document.getElementById(`val-${fieldKey}-valign`);
        
        if (valX) valX.textContent = fieldVal.x;
        if (valY) valY.textContent = fieldVal.y;
        if (valFontSize) valFontSize.textContent = fieldVal.font_size;
        if (valWidth) valWidth.textContent = fieldVal.width_mm;
        if (valHeight) valHeight.textContent = fieldVal.height_mm;
        if (valValign) valValign.value = fieldVal.valign || "top";
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

function changeValign(fieldKey, value) {
    const settings = designSettings[currentTemplate];
    if (!settings || !settings[fieldKey]) return;
    
    settings[fieldKey].valign = value;
    saveDesignSettings();
    triggerAutoUpdate();
}

// --- デザイン調整の初期値リセット ---
function resetCalibration() {
    const defaultFields = config.templates[currentTemplate].fields;
    for (const [fieldKey, fieldVal] of Object.entries(defaultFields)) {
        designSettings[currentTemplate][fieldKey] = {
            x: fieldVal.x_mm,
            y: fieldVal.y_mm,
            font_size: fieldVal.font_size,
            width_mm: fieldVal.width_mm || 30,
            height_mm: fieldVal.height_mm || 150,
            valign: fieldVal.valign || "top"
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
async function generatePDF(isPrinting = false) {
    if (!isAppReady) {
        return null;
    }

    const nameInput = document.getElementById("nameInput").value.trim();
    const amountSelect = document.getElementById("amountSelect");
    const amountInput = currentTemplate === "free" ? document.getElementById("amountInput").value.trim() : (amountSelect ? amountSelect.value : document.getElementById("amountInput").value.trim());
    
    // 氏名がない場合は合成処理をスキップ (プレビュークリア状態に)
    if (!nameInput) {
        return null;
    }

    try {
        // 1. テンプレートPDFの取得（IndexedDBから事前にロード済み）
        const templateBytes = loadedTemplateBytes[currentTemplate];
        if (!templateBytes) {
            throw new Error(`テンプレートデータが見つかりません: ${currentTemplate}`);
        }
        
        // 2. pdf-libでPDFをロード
        const pdfDoc = await PDFLib.PDFDocument.load(templateBytes);
        
        // 3. 日本語フォントの読み込みと埋め込み
        let fontToUse = null;
        if (loadedFontBytes) {
            try {
                pdfDoc.registerFontkit(window.fontkit);
                fontToUse = await pdfDoc.embedFont(new Uint8Array(loadedFontBytes), { subset: false });
            } catch (fontError) {
                console.error("フォントの埋め込みに失敗しました。標準フォントにフォールバックします:", fontError);
                fontToUse = await pdfDoc.embedStandardFont(PDFLib.StandardFonts.Helvetica);
            }
        } else {
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
            const baseFontSize = fieldVal.font_size;
            const width_pt = mmToPt(fieldVal.width_mm || 30);
            const height_pt = mmToPt(fieldVal.height_mm || 150);
            
            const fieldConfig = config.templates[currentTemplate].fields[fieldKey];
            if (!fieldConfig) {
                console.warn(`フィールド設定が見つかりません: ${fieldKey}`);
                continue;
            }
            const alignment = fieldConfig.alignment || "left";
            const isVertical = fieldConfig.vertical || false;

            let currentFontSize = baseFontSize;
            const showBoundingBox = document.getElementById("showBoundingBox") && document.getElementById("showBoundingBox").checked;

            if (isVertical) {
                // 縦書きの描画処理
                const chars = Array.from(textValue);
                // 枠の高さに収まるようにフォントサイズを縮小
                const currentHeight_pt = chars.length * (currentFontSize * 1.02);
                if (currentHeight_pt > height_pt) {
                    currentFontSize = height_pt / (chars.length * 1.02);
                }
                // 枠の幅（1文字の横幅）にも収まるように縮小
                if (currentFontSize > width_pt) {
                    currentFontSize = width_pt;
                }

                // ボックスの上端を計算（元々のフォントサイズを基準に固定）
                const boxTop = y_pt + baseFontSize;

                // 枠線の描画
                if (showBoundingBox && !isPrinting) {
                    firstPage.drawRectangle({
                        x: x_pt - (width_pt / 2),
                        y: boxTop - height_pt,
                        width: width_pt,
                        height: height_pt,
                        borderColor: PDFLib.rgb(1, 0, 0),
                        borderWidth: 1,
                    });
                }

                // テキストの上端が boxTop に合うように最初の文字の baseline を設定 (top)
                const spacing = currentFontSize * 1.02;
                let currentY = boxTop - currentFontSize;
                const valign = fieldVal.valign || "top";
                if (valign !== "top") {
                    const textHeight_pt = (chars.length - 1) * spacing + currentFontSize;
                    if (valign === "center") {
                        currentY = boxTop - (height_pt / 2) + (textHeight_pt / 2) - currentFontSize;
                    } else if (valign === "bottom") {
                        currentY = boxTop - height_pt + textHeight_pt - currentFontSize;
                    }
                }
                
                for (const char of chars) {
                    let drawX = x_pt;
                    const charWidth = fontToUse.widthOfTextAtSize(char, currentFontSize);
                    
                    if (alignment === "center") {
                        drawX = x_pt - (charWidth / 2);
                    } else if (alignment === "right") {
                        drawX = x_pt - charWidth;
                    }
                    
                    let charToDraw = char;
                    if (char === "ー" || char === "─" || char === "―" || char === "-") {
                        charToDraw = "丨";
                    } else if (char === "（") {
                        charToDraw = "︵";
                    } else if (char === "）") {
                        charToDraw = "︶";
                    }
                    
                    firstPage.drawText(charToDraw, {
                        x: drawX,
                        y: currentY,
                        size: currentFontSize,
                        font: fontToUse,
                        color: PDFLib.rgb(0.1, 0.1, 0.1)
                    });
                    currentY -= spacing;
                }
            } else {
                // 通常の横書き描画処理
                // 枠の幅に収まるようにフォントサイズを縮小
                const currentWidth_pt = fontToUse.widthOfTextAtSize(textValue, currentFontSize);
                if (currentWidth_pt > width_pt) {
                    currentFontSize = currentFontSize * (width_pt / currentWidth_pt);
                }
                // 枠の高さ（1文字の高さ）にも収まるように縮小
                if (currentFontSize > height_pt) {
                    currentFontSize = height_pt;
                }

                if (showBoundingBox && !isPrinting) {
                    let boxX = x_pt;
                    if (alignment === "center") boxX = x_pt - (width_pt / 2);
                    else if (alignment === "right") boxX = x_pt - width_pt;
                    
                    // ベースラインの少し下を枠の下端とする
                    const boxY = y_pt - (baseFontSize * 0.2);

                    firstPage.drawRectangle({
                        x: boxX,
                        y: boxY, 
                        width: width_pt,
                        height: height_pt,
                        borderColor: PDFLib.rgb(1, 0, 0),
                        borderWidth: 1,
                    });
                }

                let drawX = x_pt;
                // 縮小後のフォントサイズで再計算
                const newTextWidth = fontToUse.widthOfTextAtSize(textValue, currentFontSize);
                
                let drawY = y_pt; // default: top/baseline
                const valign = fieldVal.valign || "top";
                const boxY = y_pt - (baseFontSize * 0.2);
                
                if (valign === "center") {
                    drawY = boxY + (height_pt / 2) - (currentFontSize / 2) + (currentFontSize * 0.2);
                } else if (valign === "bottom") {
                    drawY = boxY + (currentFontSize * 0.2);
                }

                if (alignment === "center") {
                    drawX = x_pt - (newTextWidth / 2);
                } else if (alignment === "right") {
                    drawX = x_pt - newTextWidth;
                }

                firstPage.drawText(textValue, {
                    x: drawX,
                    y: drawY,
                    size: currentFontSize,
                    font: fontToUse,
                    color: PDFLib.rgb(0.1, 0.1, 0.1)
                });
            }
        }

        // 4. PDFを保存してBlobを生成
        const pdfBytes = await pdfDoc.save();
        return new Blob([pdfBytes], { type: "application/pdf" });

    } catch (e) {
        console.error("PDF合成エラー:", e);
        logError("PDF合成エラーのキャッチ: " + (e.stack || e.message));
        showToast("PDF合成中にエラーが発生しました: " + e.message, "error");
        showStatus("PDF生成エラー", false);
        return null;
    }
}

// --- リアルタイムプレビュー更新 ---
async function updatePreview() {
    const pdfPreview = document.getElementById("pdfPreview");
    const previewPlaceholder = document.getElementById("previewPlaceholder");
    
    showStatus("PDF生成中...", true);
    const pdfBlob = await generatePDF(false);
    
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
    const pdfBlob = await generatePDF(true);
    
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
    const amountSelect = document.getElementById("amountSelect");
    const amountInput = currentTemplate === "free" ? document.getElementById("amountInput").value.trim() : (amountSelect ? amountSelect.value : document.getElementById("amountInput").value.trim());
    
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

    let dbAmount = amountInput;
    if (currentTemplate === "10000en") {
        dbAmount = `金${amountInput || "一"}萬圓也`;
    } else if (currentTemplate === "1000en") {
        dbAmount = `金${amountInput || "一"}阡圓也`;
    }

    const newRecord = {
        id: "rec_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
        date: new Date().toISOString(),
        template: currentTemplate,
        name: nameInput,
        amount: dbAmount
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
    
    if (record.template === "10000en" || record.template === "1000en") {
        // 履歴DBの "金五萬圓也" から "五" を抽出してUIに入力
        let val = record.amount;
        if (val.startsWith("金")) {
            val = val.substring(1);
        }
        if (val.endsWith("萬圓也")) {
            val = val.substring(0, val.length - 3);
        } else if (val.endsWith("阡圓也")) {
            val = val.substring(0, val.length - 3);
        } else if (val.endsWith("阡圆也")) {
            val = val.substring(0, val.length - 3);
        }
        const amountSelect = document.getElementById("amountSelect");
        if (amountSelect) amountSelect.value = val;
        document.getElementById("amountInput").value = val;
    } else {
        document.getElementById("amountInput").value = record.amount;
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
    const amountSelect = document.getElementById("amountSelect");
    if (amountSelect) amountSelect.value = "一";
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
