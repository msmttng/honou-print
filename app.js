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

// --- PDF.js 初期設定 ---
const pdfjsLib = window['pdfjs-dist/build/pdf'];
if (pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// --- 定数・グローバル変数 ---
const FONT_URL = "yuji_syuku.ttf"; // 代替の美しい毛筆行書体（TTF形式）を使用
const DEFAULT_CONFIG_URL = "templates_config.json"; // テンプレート座標設定ファイル

let currentTemplate = "10000en";
let config = null;             // テンプレートごとの初期座標・フォントサイズ設定
let designSettings = {};       // ユーザー調整後の座標・フォントサイズ (LocalStorage保存用)
let paperSizeSettings = { width: 109, height: 399 }; // 用紙サイズ設定 (mm, 全テンプレート共通)
let loadedFontBytes = null;    // キャッシュされたフォントデータのArrayBuffer
let loadedTemplateBytes = {};  // キャッシュされたテンプレートPDFのArrayBuffer
let dbRecords = [];            // 名簿レコード一覧 (LocalStorage保存用)
let autoUpdateTimer = null;    // リアルタイムプレビュー用デバウンスタイマー
let isAppReady = false;        // アプリケーション（DB等）の初期化完了フラグ

// --- スプレッドシート連携（GAS） ---
let gasUrl = "https://script.google.com/macros/s/AKfycbxVFWGyZTgPPVDo430RzF3QCjuS7qYHGtjifv_KK6clkVUB0zVHYd5d-k9Gw9nGNcNc/exec"; // GAS ウェブアプリの URL (LocalStorage保存用・デフォルト値あり)
let suggestData = {            // スプレッドシート（GAS）から取得したサジェストデータ
    "names": [],
    "items": []
};

// GAS アコーディオンの開閉トグル
function toggleGasAccordion() {
    const accordion = document.getElementById("gasAccordion");
    const arrow = document.getElementById("gasAccordionArrow");
    if (!accordion) return;
    
    accordion.classList.toggle("open");
    if (accordion.classList.contains("open")) {
        if (arrow) arrow.className = "fa-solid fa-chevron-up";
    } else {
        if (arrow) arrow.className = "fa-solid fa-chevron-down";
    }
}

// GAS URLの入力時保存
function saveGasUrl() {
    const input = document.getElementById("gasUrlInput");
    if (input) {
        gasUrl = input.value.trim();
        try {
            localStorage.setItem("pdf_mail_merge_gas_url", gasUrl);
        } catch (e) {
            console.warn("GAS URL保存失敗:", e);
        }
    }
}

// 起動時のGAS設定とキャッシュの読み込み
function loadGasSettings() {
    try {
        // GAS URL of recovery
        const savedUrl = localStorage.getItem("pdf_mail_merge_gas_url");
        if (savedUrl) {
            gasUrl = savedUrl;
        }
        const input = document.getElementById("gasUrlInput");
        if (input) input.value = gasUrl;

        // サジェストデータのキャッシュ復元と新方式への自動コンバート
        const cachedSuggests = localStorage.getItem("pdf_mail_merge_suggests");
        if (cachedSuggests) {
            const rawData = JSON.parse(cachedSuggests);
            suggestData = {
                names: rawData.names || [
                    ...(rawData["10000en_names"] || []),
                    ...(rawData["1000en_names"] || []),
                    ...(rawData["free_names"] || [])
                ],
                items: rawData.items || rawData["free_items"] || []
            };
            // 重複排除
            suggestData.names = [...new Set(suggestData.names)];
        }
    } catch (e) {
        console.error("GAS設定の復元失敗:", e);
    }

    // GAS URLが設定されていれば、バックグラウンドで同期を実行
    if (gasUrl) {
        syncFromGAS(true).catch(() => {});
    }
}

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
    updateDpadUI();
    
    // 5. GAS設定の復元
    loadGasSettings();

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
    updatePaperSizeUI();
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
    // 用紙サイズ設定の読み込み
    try {
        const savedPaper = localStorage.getItem("pdf_mail_merge_paper_size");
        if (savedPaper) {
            paperSizeSettings = JSON.parse(savedPaper);
        }
    } catch (e) {
        console.error("用紙サイズ設定アクセスエラー:", e);
    }
}

function saveDesignSettings() {
    try {
        localStorage.setItem("pdf_mail_merge_design_settings", JSON.stringify(designSettings));
        localStorage.setItem("pdf_mail_merge_paper_size", JSON.stringify(paperSizeSettings));
    } catch (e) {
        console.warn("LocalStorage保存エラー:", e);
    }
}

// --- 用紙サイズ調整 ---
function adjustPaperSize(dimension, change) {
    if (dimension === 'width') {
        paperSizeSettings.width = parseFloat((paperSizeSettings.width + change).toFixed(1));
        if (paperSizeSettings.width < 50) paperSizeSettings.width = 50;
        if (paperSizeSettings.width > 300) paperSizeSettings.width = 300;
    } else {
        paperSizeSettings.height = parseFloat((paperSizeSettings.height + change).toFixed(1));
        if (paperSizeSettings.height < 100) paperSizeSettings.height = 100;
        if (paperSizeSettings.height > 600) paperSizeSettings.height = 600;
    }
    saveDesignSettings();
    updatePaperSizeUI();
    triggerAutoUpdate();
}

function resetPaperSize() {
    paperSizeSettings = { width: 109, height: 399 };
    saveDesignSettings();
    updatePaperSizeUI();
    triggerAutoUpdate();
    showToast('用紙サイズをデフォルト（109 x 399mm）に戻しました');
}

function updatePaperSizeUI() {
    const wEl = document.getElementById('paper-val-width');
    const hEl = document.getElementById('paper-val-height');
    if (wEl) wEl.textContent = paperSizeSettings.width.toFixed(1);
    if (hEl) hEl.textContent = paperSizeSettings.height.toFixed(1);
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
    if (amountField) amountField.style.display = "block";

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
    updateDpadUI();
    
    // プレビュー再描画
    updatePreview();
}

// --- 微調整UI数値の更新 ---


// --- 画面上での数値調整処理 ---
function adjustValue(fieldKey, param, change) {
    const settings = designSettings[currentTemplate];
    if (!settings || !settings[fieldKey]) return;

    settings[fieldKey][param] = parseFloat((settings[fieldKey][param] + change).toFixed(1));
    
    // LocalStorage保存
    saveDesignSettings();
    
    // プレビューの自動更新（デバウンスで実行）
    triggerAutoUpdate();
    updateDpadUI();
}

function updateDpadUI() {
    const badge = document.getElementById("dpadCoordinates");
    if (!badge) return;
    
    const targetRadios = document.getElementsByName("dpadTarget");
    let targetKey = "name";
    for (let i = 0; i < targetRadios.length; i++) {
        if (targetRadios[i].checked) {
            targetKey = targetRadios[i].value;
            break;
        }
    }
    
    const settings = designSettings[currentTemplate];
    if (settings && settings[targetKey]) {
        badge.textContent = `X: ${settings[targetKey].x.toFixed(1)} / Y: ${settings[targetKey].y.toFixed(1)}`;
        
        const elFontSize = document.getElementById("dpad-val-font_size");
        const elWidth = document.getElementById("dpad-val-width_mm");
        const elHeight = document.getElementById("dpad-val-height_mm");
        const elValign = document.getElementById("dpad-val-valign");
        
        if (elFontSize) elFontSize.textContent = settings[targetKey].font_size;
        if (elWidth) elWidth.textContent = settings[targetKey].width_mm;
        if (elHeight) elHeight.textContent = settings[targetKey].height_mm;
        if (elValign) elValign.value = settings[targetKey].valign || "top";
    }
    updatePaperSizeUI();
}

function adjustTargetValue(param, change) {
    const targetRadios = document.getElementsByName("dpadTarget");
    let targetKey = "name";
    for (let i = 0; i < targetRadios.length; i++) {
        if (targetRadios[i].checked) {
            targetKey = targetRadios[i].value;
            break;
        }
    }
    adjustValue(targetKey, param, change);
}

function changeTargetValign(value) {
    const targetRadios = document.getElementsByName("dpadTarget");
    let targetKey = "name";
    for (let i = 0; i < targetRadios.length; i++) {
        if (targetRadios[i].checked) {
            targetKey = targetRadios[i].value;
            break;
        }
    }
    changeValign(targetKey, value);
}

function changeValign(fieldKey, value) {
    const settings = designSettings[currentTemplate];
    if (!settings || !settings[fieldKey]) return;
    
    settings[fieldKey].valign = value;
    saveDesignSettings();
    triggerAutoUpdate();
    updateDpadUI();
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
    updateDpadUI();
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

// --- D-Pad (十字キー) 制御 ---
let dpadInterval = null;

function startDpad(direction) {
    if (dpadInterval) return;
    moveDpad(direction); // 初回移動
    dpadInterval = setInterval(() => {
        moveDpad(direction);
    }, 120); // 長押し時の連続移動
}

function stopDpad() {
    if (dpadInterval) {
        clearInterval(dpadInterval);
        dpadInterval = null;
    }
}

function moveDpad(direction) {
    const targetRadios = document.getElementsByName("dpadTarget");
    let targetKey = "name";
    for (let i = 0; i < targetRadios.length; i++) {
        if (targetRadios[i].checked) {
            targetKey = targetRadios[i].value;
            break;
        }
    }
    
    const change = 0.5; // 0.5mm単位で移動
    let param = "";
    let amount = 0;
    
    switch (direction) {
        case 'up': param = 'y'; amount = change; break;
        case 'down': param = 'y'; amount = -change; break;
        case 'left': param = 'x'; amount = -change; break;
        case 'right': param = 'x'; amount = change; break;
    }
    
    adjustValue(targetKey, param, amount);
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
        // 2. pdf-libでPDFをロードまたは新規作成
        let pdfDoc;
        let firstPage;
        const includeBackground = document.getElementById("includeBackground") ? document.getElementById("includeBackground").checked : true;

        // 用紙サイズ変更の計算 (原本との差分で translateContent + setSize)
        const origDoc = await PDFLib.PDFDocument.load(templateBytes);
        const origPage = origDoc.getPages()[0];
        const origWidthPt = origPage.getSize().width;
        const origHeightPt = origPage.getSize().height;
        const newWidthPt = mmToPt(paperSizeSettings.width);
        const newHeightPt = mmToPt(paperSizeSettings.height);
        const shiftXPt = (newWidthPt - origWidthPt) / 2;
        const shiftYPt = (newHeightPt - origHeightPt) / 2;

        if (includeBackground) {
            pdfDoc = await PDFLib.PDFDocument.load(templateBytes);
            firstPage = pdfDoc.getPages()[0];
            // デザインをセンタリングしてからページサイズを変更
            firstPage.translateContent(shiftXPt, shiftYPt);
            firstPage.setSize(newWidthPt, newHeightPt);
        } else {
            // 白紙のPDFを新規作成（新しい用紙サイズで）
            pdfDoc = await PDFLib.PDFDocument.create();
            firstPage = pdfDoc.addPage([newWidthPt, newHeightPt]);
        }
        
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

            // 用紙サイズ変更に伴うテキスト座標のオフセット適用
            const x_pt = mmToPt(fieldVal.x) + shiftXPt;
            const y_pt = mmToPt(fieldVal.y) + shiftYPt;
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
    const pdfCanvas = document.getElementById("pdfCanvas");
    const previewPlaceholder = document.getElementById("previewPlaceholder");
    
    showStatus("PDF生成中...", true);
    const pdfBlob = await generatePDF(false);
    
    if (pdfBlob && pdfjsLib) {
        try {
            const arrayBuffer = await pdfBlob.arrayBuffer();
            const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
            const pdf = await loadingTask.promise;
            const page = await pdf.getPage(1);
            
            const context = pdfCanvas.getContext('2d');
            const container = pdfCanvas.parentElement;
            
            const containerWidth = container.clientWidth - 40; 
            const containerHeight = container.clientHeight - 40;
            
            const unscaledViewport = page.getViewport({ scale: 1.0 });
            const scale = Math.min(containerWidth / unscaledViewport.width, containerHeight / unscaledViewport.height);
            
            const viewport = page.getViewport({ scale: scale });
            
            const outputScale = window.devicePixelRatio || 1;
            
            pdfCanvas.width = Math.floor(viewport.width * outputScale);
            pdfCanvas.height = Math.floor(viewport.height * outputScale);
            pdfCanvas.style.width = Math.floor(viewport.width) + "px";
            pdfCanvas.style.height =  Math.floor(viewport.height) + "px";
            
            const transform = outputScale !== 1 
              ? [outputScale, 0, 0, outputScale, 0, 0] 
              : null;

            const renderContext = {
              canvasContext: context,
              transform: transform,
              viewport: viewport
            };
            
            await page.render(renderContext).promise;
            
            pdfCanvas.style.display = "block";
            previewPlaceholder.style.display = "none";
            showStatus("プレビュー更新完了", false);
        } catch (error) {
            logError("PDF.js Render Error: " + error);
            showStatus("プレビュー表示エラー", false);
        }
    } else {
        pdfCanvas.style.display = "none";
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
    
    // スプレッドシート連携（GAS）へ非同期で履歴を送信
    sendToGAS(newRecord);
    
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
            <td data-label="日時">${dateStr}</td>
            <td data-label="台紙種類"><span class="badge ${badgeClass}">${badgeText}</span></td>
            <td data-label="氏名" style="font-weight: 500;">${escapeHTML(r.name)}</td>
            <td data-label="金額/物品">${escapeHTML(r.amount)}</td>
            <td data-label="">
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

// #8 スマホでは微調整アコーディオンをデフォルトで開く
if (window.innerWidth <= 768) {
    window.addEventListener("DOMContentLoaded", () => {
        const accordion = document.getElementById("calibrationAccordion");
        const arrow = document.getElementById("accordionArrow");
        if (accordion && !accordion.classList.contains("open")) {
            accordion.classList.add("open");
            if (arrow) arrow.className = "fa-solid fa-chevron-up";
        }
    });
}

// #9 スマホ用PDF保存（直接ダウンロード）
async function mobilePrintPDF() {
    const nameInput = document.getElementById("nameInput").value.trim();
    if (!nameInput) {
        showToast("氏名を入力してから保存してください", "error");
        return;
    }

    showStatus("PDF生成中...", true);
    const pdfBlob = await generatePDF(true);
    
    if (pdfBlob) {
        const pdfUrl = URL.createObjectURL(pdfBlob);
        const link = document.createElement("a");
        link.href = pdfUrl;
        link.download = `奉納ビラ_${nameInput}.pdf`;
        link.click();
        URL.revokeObjectURL(pdfUrl);
        showToast("PDFを保存しました");
        showStatus("PDF保存完了", false);
        saveRecord(false);
    }
}

// iPhone AirPrint用の印刷機能
async function mobilePrintAirPrint() {
    const nameInput = document.getElementById("nameInput").value.trim();
    if (!nameInput) {
        showToast("氏名を入力してから印刷してください", "error");
        return;
    }

    showStatus("印刷データ準備中...", true);
    
    try {
        const pdfBlob = await generatePDF(true);
        
        if (!pdfBlob) {
            showToast("PDFの生成に失敗しました", "error");
            showStatus("準備完了", false);
            return;
        }

        const fileName = `奉納ビラ_${nameInput}.pdf`;

        // 方法1: iOS Web Share API でPDFを共有シートに送る
        // 共有シートから「プリント」→ AirPrint
        if (navigator.share) {
            try {
                const pdfFile = new File([pdfBlob], fileName, { type: "application/pdf" });
                const shareData = { files: [pdfFile] };
                
                if (navigator.canShare && navigator.canShare(shareData)) {
                    await navigator.share(shareData);
                    showStatus("印刷準備完了", false);
                    saveRecord(false);
                    return;
                }
            } catch (e) {
                if (e.name === "AbortError") {
                    showStatus("準備完了", false);
                    return;
                }
                console.warn("Share API:", e);
            }
        }

        // 方法2: 別タブでPDFを開く（共有ボタン→プリント）
        const pdfUrl = URL.createObjectURL(pdfBlob);
        const link = document.createElement("a");
        link.href = pdfUrl;
        link.target = "_blank";
        link.rel = "noopener";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        showToast("PDFを開きました。共有ボタン→「プリント」で印刷できます。");
        showStatus("印刷準備完了", false);
        saveRecord(false);
        
    } catch (e) {
        logError("印刷エラー: " + e.message);
        showToast("印刷に失敗しました: " + e.message, "error");
        showStatus("準備完了", false);
    }
}

// #7 長押しリピート機能（+/-ボタン）
(function setupLongPressRepeat() {
    document.addEventListener("DOMContentLoaded", () => {
        document.querySelectorAll(".calib-btn").forEach(btn => {
            let intervalId = null;
            let timeoutId = null;

            const startRepeat = (e) => {
                e.preventDefault();
                // 初回は通常のクリックで処理済み
                timeoutId = setTimeout(() => {
                    intervalId = setInterval(() => {
                        btn.click();
                    }, 80);
                }, 400);
            };

            const stopRepeat = () => {
                clearTimeout(timeoutId);
                clearInterval(intervalId);
                intervalId = null;
                timeoutId = null;
            };

            btn.addEventListener("touchstart", startRepeat, { passive: false });
            btn.addEventListener("touchend", stopRepeat);
            btn.addEventListener("touchcancel", stopRepeat);
            btn.addEventListener("mousedown", startRepeat);
            btn.addEventListener("mouseup", stopRepeat);
            btn.addEventListener("mouseleave", stopRepeat);
        });
    });
})();

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

// --- スプレッドシート連携（GAS）API ---

// GASからサジェストデータを取得（GET）
async function syncFromGAS(isBackground = false) {
    if (!gasUrl) {
        if (!isBackground) showToast("GASのウェブアプリURLを設定してください", "error");
        return;
    }

    const btn = document.getElementById("btnSyncGAS");
    if (btn) {
        btn.innerHTML = '<i class="fa-solid fa-rotate"></i> 同期中...';
        btn.style.opacity = "0.7";
        btn.disabled = true;
    }

    try {
        // キャッシュクリアのためのタイムスタンプを追加
        const fetchUrl = gasUrl + (gasUrl.includes("?") ? "&" : "?") + "t=" + Date.now();
        const response = await fetch(fetchUrl, {
            method: "GET",
            mode: "cors"
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        if (data.error) {
            throw new Error(data.error);
        }

        // サジェストデータを更新（新方式のnames/itemsに対応し、旧方式の3列データもマージして統合する後方互換処理）
        const rawNames = data.names || [
            ...(data["10000en_names"] || []),
            ...(data["1000en_names"] || []),
            ...(data["free_names"] || [])
        ];
        // 重複排除して格納
        suggestData.names = [...new Set(rawNames)];
        suggestData.items = data.items || data["free_items"] || [];

        // LocalStorageに保存
        try {
            localStorage.setItem("pdf_mail_merge_suggests", JSON.stringify(suggestData));
            localStorage.setItem("pdf_mail_merge_suggests_time", new Date().toISOString());
        } catch (e) { /* 無視 */ }

        if (!isBackground) {
            const totalCount = suggestData.names.length + suggestData.items.length;
            showToast(`スプレッドシートからサジェストデータ ${totalCount}件を同期しました`);
        }
    } catch (e) {
        console.error("GAS同期エラー:", e);
        if (!isBackground) showToast("サジェストデータの同期に失敗しました: " + e.message, "error");
    } finally {
        if (btn) {
            btn.innerHTML = '<i class="fa-solid fa-rotate"></i> スプレッドシートから同期';
            btn.style.opacity = "1";
            btn.disabled = false;
        }
    }
}

// 履歴データをスプレッドシートへ自動追記（POST）
async function sendToGAS(record) {
    if (!gasUrl) return; // GAS URLが未設定ならスキップ

    let templateTypeStr = "フリー用";
    if (record.template === "10000en") {
        templateTypeStr = "萬圓用";
    } else if (record.template === "1000en") {
        templateTypeStr = "阡圓用";
    }

    const payload = {
        timestamp: new Date(record.date).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }),
        templateType: templateTypeStr,
        name: record.name,
        amount: record.amount
    };

    try {
        console.log("GASへのPOST送信を開始します...", payload);
        const response = await fetch(gasUrl, {
            method: "POST",
            mode: "no-cors", // CORS制約（リダイレクトや異なるオリジンへのPOST制限）を回避するため no-cors モードで送信
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });
        
        // no-cors の場合、response.ok や status は取得できませんが、送信自体はGASに届きます
        console.log("GASへのデータ送信要求を送信しました");
    } catch (e) {
        console.error("GASへの履歴追記エラー:", e);
    }
}

// ==========================================
// ボトムシート（サジェストUI）制御ロジック
// ==========================================
let currentSheetTarget = 'name'; // 'name' or 'amount'
let currentSheetTab = 'recent'; // 'recent' or 'cloud'

function openBottomSheet(target) {
    currentSheetTarget = target;
    const overlay = document.getElementById('sheetOverlay');
    const sheet = document.getElementById('bottomSheet');
    const searchInput = document.getElementById('sheetSearchInput');
    
    // プレースホルダーの切り替え
    if (target === 'name') {
        searchInput.placeholder = "氏名を直接入力 または 検索...";
    } else {
        searchInput.placeholder = "金額・物品名を直接入力 または 検索...";
    }
    
    searchInput.value = '';
    overlay.classList.add('active');
    sheet.classList.add('active');
    
    // タブを初期化
    switchSheetTab('recent');
}

function closeBottomSheet() {
    const overlay = document.getElementById('sheetOverlay');
    const sheet = document.getElementById('bottomSheet');
    overlay.classList.remove('active');
    sheet.classList.remove('active');
}

function switchSheetTab(tabId) {
    currentSheetTab = tabId;
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`tab-${tabId}`).classList.add('active');
    renderSheetList();
}

function handleSheetSearch() {
    const query = document.getElementById('sheetSearchInput').value.trim();
    const tabsContainer = document.getElementById('sheetTabsContainer');
    const btnConfirm = document.getElementById('btnConfirmNew');
    const newTextSpan = document.getElementById('newSheetInputText');
    
    if (query.length > 0) {
        tabsContainer.style.display = 'none';
        newTextSpan.textContent = query;
        btnConfirm.classList.add('show');
    } else {
        tabsContainer.style.display = 'flex';
        btnConfirm.classList.remove('show');
    }
    
    renderSheetList();
}

function renderSheetList() {
    const query = document.getElementById('sheetSearchInput').value.trim().toLowerCase();
    const content = document.getElementById('sheetListContent');
    content.innerHTML = '';
    
    let sourceData = [];
    let isCloud = false;
    
    if (currentSheetTarget === 'name') {
        if (currentSheetTab === 'recent' && !query) {
            // 最近の履歴から重複排除して氏名を抽出
            sourceData = [...new Set(dbRecords.map(r => r.name))];
        } else {
            // クラウドまたは検索時は全クラウドデータ
            sourceData = suggestData.names || [];
            isCloud = true;
            // 検索時はローカル履歴もマージして検索対象にする
            if (query) {
                const localNames = dbRecords.map(r => r.name);
                sourceData = [...new Set([...sourceData, ...localNames])];
            }
        }
    } else {
        if (currentSheetTab === 'recent' && !query) {
            // 最近の履歴から金額/物品を抽出
            sourceData = [...new Set(dbRecords.map(r => r.amount))];
        } else {
            sourceData = suggestData.items || [];
            isCloud = true;
            if (query) {
                const localItems = dbRecords.map(r => r.amount);
                sourceData = [...new Set([...sourceData, ...localItems])];
            }
        }
    }
    
    let filtered = sourceData;
    
    if (query.length > 0) {
        filtered = sourceData.filter(item => item.toLowerCase().includes(query));
        
        // 検索結果に完全一致がある場合は新規ボタンを隠す
        const exactMatch = filtered.some(item => item.toLowerCase() === query);
        const btnConfirm = document.getElementById('btnConfirmNew');
        if (exactMatch) {
            btnConfirm.classList.remove('show');
        }
    }
    
    if (filtered.length === 0) {
        content.innerHTML = '<div class="empty-message">該当する候補がありません。<br>上の入力欄にそのまま入力して決定ボタンを押してください。</div>';
        return;
    }
    
    // 上限30件程度にする
    filtered.slice(0, 30).forEach(item => {
        const div = document.createElement('div');
        div.className = 'list-item';
        div.innerHTML = `
            <span>${escapeHTML(item)}</span>
            <span class="list-item-sub">${isCloud ? 'クラウド' : '履歴'}</span>
        `;
        div.onclick = () => selectSheetItem(item);
        content.appendChild(div);
    });
}

function selectSheetItem(val) {
    if (currentSheetTarget === 'name') {
        document.getElementById("nameInput").value = val;
    } else {
        document.getElementById("amountInput").value = val;
    }
    closeBottomSheet();
    triggerAutoUpdate();
}

function confirmNewSheetInput() {
    const val = document.getElementById('sheetSearchInput').value.trim();
    if (val) {
        selectSheetItem(val);
    }
}
