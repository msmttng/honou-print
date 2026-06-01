// --- Service Worker 逋ｻ骭ｲ・・WA蟇ｾ蠢懶ｼ・---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(reg => {
      console.log('Service Worker registered:', reg.scope);
    }).catch(err => {
      console.warn('Service Worker registration failed:', err);
    });
  });
}

// --- 繧ｨ繝ｩ繝ｼ蜿朱寔繝ｭ繧ｸ繝・け ---
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
            alert("繝ｭ繧ｰ繧偵け繝ｪ繝・・繝懊・繝峨↓繧ｳ繝斐・縺励∪縺励◆・・);
        }).catch(err => {
            alert("繧ｳ繝斐・縺ｫ螟ｱ謨励＠縺ｾ縺励◆縲ら峩謗･驕ｸ謚槭＠縺ｦ繧ｳ繝斐・縺励※縺上□縺輔＞縲・);
        });
    }
}

// --- PDF.js 蛻晄悄險ｭ螳・---
const pdfjsLib = window['pdfjs-dist/build/pdf'];
if (pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// --- 螳壽焚繝ｻ繧ｰ繝ｭ繝ｼ繝舌Ν螟画焚 ---
const FONT_URL = "hgs_gyoshotai.ttf"; // HGS陦梧嶌菴難ｼ・TC縺九ｉ謚ｽ蜃ｺ縺励◆TTF蠖｢蠑擾ｼ峨ｒ菴ｿ逕ｨ
const DEFAULT_CONFIG_URL = "templates_config.json"; // 繝・Φ繝励Ξ繝ｼ繝亥ｺｧ讓呵ｨｭ螳壹ヵ繧｡繧､繝ｫ

let currentTemplate = "10000en";
let config = null;             // 繝・Φ繝励Ξ繝ｼ繝医＃縺ｨ縺ｮ蛻晄悄蠎ｧ讓吶・繝輔か繝ｳ繝医し繧､繧ｺ險ｭ螳・
let designSettings = {};       // 繝ｦ繝ｼ繧ｶ繝ｼ隱ｿ謨ｴ蠕後・蠎ｧ讓吶・繝輔か繝ｳ繝医し繧､繧ｺ (LocalStorage菫晏ｭ倡畑)
let paperSizeSettings = { width: 105, height: 390 }; // 逕ｨ邏吶し繧､繧ｺ險ｭ螳・(mm, 蜈ｨ繝・Φ繝励Ξ繝ｼ繝亥・騾・
let loadedFontBytes = null;    // 繧ｭ繝｣繝・す繝･縺輔ｌ縺溘ヵ繧ｩ繝ｳ繝医ョ繝ｼ繧ｿ縺ｮArrayBuffer
let loadedTemplateBytes = {};  // 繧ｭ繝｣繝・す繝･縺輔ｌ縺溘ユ繝ｳ繝励Ξ繝ｼ繝・DF縺ｮArrayBuffer
let dbRecords = [];            // 蜷咲ｰｿ繝ｬ繧ｳ繝ｼ繝我ｸ隕ｧ (LocalStorage菫晏ｭ倡畑)
let autoUpdateTimer = null;    // 繝ｪ繧｢繝ｫ繧ｿ繧､繝繝励Ξ繝薙Η繝ｼ逕ｨ繝・ヰ繧ｦ繝ｳ繧ｹ繧ｿ繧､繝槭・
let isAppReady = false;        // 繧｢繝励Μ繧ｱ繝ｼ繧ｷ繝ｧ繝ｳ・・B遲会ｼ峨・蛻晄悄蛹門ｮ御ｺ・ヵ繝ｩ繧ｰ

// --- 繧ｹ繝励Ξ繝・ラ繧ｷ繝ｼ繝磯｣謳ｺ・・AS・・---
let gasUrl = "https://script.google.com/macros/s/AKfycbxVFWGyZTgPPVDo430RzF3QCjuS7qYHGtjifv_KK6clkVUB0zVHYd5d-k9Gw9nGNcNc/exec"; // GAS 繧ｦ繧ｧ繝悶い繝励Μ縺ｮ URL (LocalStorage菫晏ｭ倡畑繝ｻ繝・ヵ繧ｩ繝ｫ繝亥､縺ゅｊ)
let suggestData = {            // 繧ｹ繝励Ξ繝・ラ繧ｷ繝ｼ繝茨ｼ・AS・峨°繧牙叙蠕励＠縺溘し繧ｸ繧ｧ繧ｹ繝医ョ繝ｼ繧ｿ
    "names": [],
    "items": []
};

// GAS 繧｢繧ｳ繝ｼ繝・ぅ繧ｪ繝ｳ縺ｮ髢矩哩繝医げ繝ｫ
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

// GAS URL縺ｮ蜈･蜉帶凾菫晏ｭ・
function saveGasUrl() {
    const input = document.getElementById("gasUrlInput");
    if (input) {
        gasUrl = input.value.trim();
        try {
            localStorage.setItem("pdf_mail_merge_gas_url", gasUrl);
        } catch (e) {
            console.warn("GAS URL菫晏ｭ伜､ｱ謨・", e);
        }
    }
}

// 襍ｷ蜍墓凾縺ｮGAS險ｭ螳壹→繧ｭ繝｣繝・す繝･縺ｮ隱ｭ縺ｿ霎ｼ縺ｿ
function loadGasSettings() {
    try {
        // GAS URL of recovery
        const savedUrl = localStorage.getItem("pdf_mail_merge_gas_url");
        if (savedUrl) {
            gasUrl = savedUrl;
        }
        const input = document.getElementById("gasUrlInput");
        if (input) input.value = gasUrl;

        // 繧ｵ繧ｸ繧ｧ繧ｹ繝医ョ繝ｼ繧ｿ縺ｮ繧ｭ繝｣繝・す繝･蠕ｩ蜈・→譁ｰ譁ｹ蠑上∈縺ｮ閾ｪ蜍輔さ繝ｳ繝舌・繝・
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
            // 驥崎､・賜髯､
            suggestData.names = [...new Set(suggestData.names)];
        }
    } catch (e) {
        console.error("GAS險ｭ螳壹・蠕ｩ蜈・､ｱ謨・", e);
    }

    // GAS URL縺瑚ｨｭ螳壹＆繧後※縺・ｌ縺ｰ縲√ヰ繝・け繧ｰ繝ｩ繧ｦ繝ｳ繝峨〒蜷梧悄繧貞ｮ溯｡・
    if (gasUrl) {
        syncFromGAS(true).catch(() => {});
    }
}

// --- IndexedDB 繧ｹ繝医Ξ繝ｼ繧ｸ邂｡逅・---
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

// --- 襍ｷ蜍墓凾縺ｮ蛻晄悄蛹門・逅・---
window.addEventListener("DOMContentLoaded", async () => {
    // file:// 繝励Ο繝医さ繝ｫ縺ｮ隴ｦ蜻翫・襍ｷ蜍慕畑繝悶Λ繧ｦ繧ｶ・・-allow-file-access-from-files・峨ｒ菴ｿ逕ｨ縺吶ｋ縺薙→縺ｧ蝗樣∩縺吶ｋ縺溘ａ蜑企勁

    showStatus("繧ｷ繧ｹ繝・Β蛻晄悄蛹紋ｸｭ...", true);
    
    // 1. 繝・じ繧､繝ｳ險ｭ螳壹♀繧医・蜷咲ｰｿDB縺ｮ蠕ｩ蜈・
    loadDesignSettings();
    loadDbRecords();
    renderTable();

    // 2. 險ｭ螳壹ヵ繧｡繧､繝ｫ縺ｮ隱ｭ縺ｿ霎ｼ縺ｿ (繝ｭ繝ｼ繧ｫ繝ｫ險ｭ螳壹ｒ繝上・繝峨さ繝ｼ繝峨〒菴ｿ逕ｨ)
    config = getFallbackConfig();

    // 3. 繝舌・繧ｸ繝ｧ繝ｳ繝√ぉ繝・け縺ｫ繧医ｋLocalStorage繧ｭ繝｣繝・す繝･繧ｯ繝ｪ繧｢ (譁ｰ險ｭ螳壼ｼｷ蛻ｶ驕ｩ逕ｨ)
    const currentVersion = config.config_version || 1;
    try {
        const savedVersion = localStorage.getItem("pdf_mail_merge_config_version");
        if (savedVersion !== String(currentVersion)) {
            console.log(`險ｭ螳壹ヰ繝ｼ繧ｸ繝ｧ繝ｳ縺梧峩譁ｰ縺輔ｌ縺ｾ縺励◆ (${savedVersion} -> ${currentVersion})縲ゅく繝｣繝・す繝･繧偵Μ繧ｻ繝・ヨ縺励∪縺吶Ａ);
            localStorage.removeItem("pdf_mail_merge_design_settings");
            localStorage.setItem("pdf_mail_merge_config_version", currentVersion);
            designSettings = {}; // 繧ｭ繝｣繝・す繝･繧偵け繝ｪ繧｢
            // IndexedDB縺ｮ繧ｭ繝｣繝・す繝･繧ょ炎髯､・医ヵ繧ｩ繝ｳ繝医・PDF螟画峩縺ｫ蟇ｾ蠢懶ｼ・
            try {
                const db = await openDB();
                const tx = db.transaction(STORE_NAME, "readwrite");
                tx.objectStore(STORE_NAME).delete("font_yuji");
                tx.objectStore(STORE_NAME).delete("pdf_10000en");
                tx.objectStore(STORE_NAME).delete("pdf_1000en");
                tx.objectStore(STORE_NAME).delete("pdf_free");
                await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; });
                console.log("IndexedDB縺ｮ繧ｭ繝｣繝・す繝･繧貞炎髯､縺励∪縺励◆縲よ眠縺励＞繝輔ぃ繧､繝ｫ繧貞・繝繧ｦ繝ｳ繝ｭ繝ｼ繝峨＠縺ｾ縺吶・);
            } catch (dbErr) {
                console.warn("IndexedDB繧ｭ繝｣繝・す繝･蜑企勁繧ｨ繝ｩ繝ｼ:", dbErr);
            }
            // 蜀榊ｺｦ繝ｭ繝ｼ繝峨＠縺ｦ遨ｺ縺ｮ迥ｶ諷九↓蛻晄悄蛹・
            loadDesignSettings();
        }
    } catch (e) {
        console.warn("LocalStorage繧｢繧ｯ繧ｻ繧ｹ繧ｨ繝ｩ繝ｼ(繝舌・繧ｸ繝ｧ繝ｳ繝√ぉ繝・け):", e);
    }

    // 4. 繝・じ繧､繝ｳ險ｭ螳壹・蛻晄悄蠎ｧ讓吶・繝ｼ繧ｸ
    initDesignSettings();
    updateDpadUI();
    
    // 5. GAS險ｭ螳壹・蠕ｩ蜈・
    loadGasSettings();

    // --- 縺薙％縺九ｉ繝ｭ繝ｼ繧ｫ繝ｫ繝輔ぃ繧､繝ｫ繝√ぉ繝・き繝ｼ ---
    showStatus("繝ｭ繝ｼ繧ｫ繝ｫ繝輔ぃ繧､繝ｫ遒ｺ隱堺ｸｭ...", true);
    const fileStatus = await checkRequiredFiles();
    const allFilesReady = fileStatus.font_yuji && fileStatus.pdf_10000en && fileStatus.pdf_1000en && fileStatus.pdf_free;

    if (allFilesReady) {
        // 蜈ｨ縺ｦ縺ｮ繝輔ぃ繧､繝ｫ縺轡B縺ｫ縺ゅｋ蝣ｴ蜷医√ヵ繧ｩ繝ｳ繝医ｒ繝｡繝｢繝ｪ縺ｫ隱ｭ縺ｿ霎ｼ繧薙〒繧｢繝励Μ襍ｷ蜍・
        await loadAppFromDB();
    } else {
        // 雜ｳ繧翫↑縺・ヵ繧｡繧､繝ｫ縺後≠繧句ｴ蜷医∬・蜍輔ム繧ｦ繝ｳ繝ｭ繝ｼ繝峨ｒ隧ｦ陦・
        showStatus("蛻晏屓繧ｻ繝・ヨ繧｢繝・・荳ｭ...・磯壻ｿ｡迺ｰ蠅・↓繧医ｊ謨ｰ遘偵°縺九ｊ縺ｾ縺呻ｼ・, true);
        const placeholder = document.getElementById("previewPlaceholder");
        if (placeholder) {
            placeholder.innerHTML = '<i class="fa-solid fa-cloud-arrow-down fa-bounce"></i><p>蛻晄悄繝輔ぃ繧､繝ｫ繧偵ム繧ｦ繝ｳ繝ｭ繝ｼ繝峨＠縺ｦ縺・∪縺・..<br>蟆代・♀蠕・■縺上□縺輔＞</p><p style="font-size:11px;opacity:0.7">・亥・蝗槭・縺ｿ8MB遞句ｺｦ縺ｮ騾壻ｿ｡縺檎匱逕溘＠縺ｾ縺呻ｼ・/p>';
        }
        try {
            const fetchFile = async (url, key) => {
                const response = await fetch(encodeURI(url));
                if (!response.ok) throw new Error(`繝輔ぃ繧､繝ｫ縺瑚ｦ九▽縺九ｊ縺ｾ縺帙ｓ: ${url}`);
                const buffer = await response.arrayBuffer();
                await saveFileToDB(key, buffer);
            };

            const promises = [];
            if (!fileStatus.font_yuji) promises.push(fetchFile("hgs_gyoshotai.ttf", "font_yuji"));
            if (!fileStatus.pdf_10000en) promises.push(fetchFile(config.templates["10000en"].template_file, "pdf_10000en"));
            if (!fileStatus.pdf_1000en) promises.push(fetchFile(config.templates["1000en"].template_file, "pdf_1000en"));
            if (!fileStatus.pdf_free) promises.push(fetchFile(config.templates["free"].template_file, "pdf_free"));

            await Promise.all(promises);
            
            // 繝繧ｦ繝ｳ繝ｭ繝ｼ繝画・蜉溷ｾ後√い繝励Μ繧定ｵｷ蜍・
            await loadAppFromDB();
        } catch (e) {
            // 閾ｪ蜍輔ム繧ｦ繝ｳ繝ｭ繝ｼ繝峨↓螟ｱ謨励＠縺溷ｴ蜷医・縺ｿ縲∵焔蜍輔そ繝・ヨ繧｢繝・・逕ｻ髱｢繧定｡ｨ遉ｺ
            logError("閾ｪ蜍輔ム繧ｦ繝ｳ繝ｭ繝ｼ繝牙､ｱ謨・ " + e.message);
            showSetupOverlay(fileStatus);
        }
    }
});

// 繧｢繝励Μ譛ｬ菴薙・襍ｷ蜍輔・繝ｭ繧ｻ繧ｹ
async function loadAppFromDB() {
    try {
        showStatus("繝輔か繝ｳ繝郁ｪｭ縺ｿ霎ｼ縺ｿ荳ｭ...", true);
        loadedFontBytes = await getFileFromDB("font_yuji");
        loadedTemplateBytes["10000en"] = await getFileFromDB("pdf_10000en");
        loadedTemplateBytes["1000en"] = await getFileFromDB("pdf_1000en");
        loadedTemplateBytes["free"] = await getFileFromDB("pdf_free");
        
        showStatus("貅門ｙ螳御ｺ・, false);
        isAppReady = true;
        selectTemplate("10000en"); // 繝励Ξ繝薙Η繝ｼ譖ｴ譁ｰ髢句ｧ・
    } catch (e) {
        logError("繝・・繧ｿ繝吶・繧ｹ縺九ｉ縺ｮ隱ｭ縺ｿ霎ｼ縺ｿ縺ｫ螟ｱ謨励＠縺ｾ縺励◆: " + e);
    }
}

// 繧ｻ繝・ヨ繧｢繝・・繧ｪ繝ｼ繝舌・繝ｬ繧､蛻ｶ蠕｡
function showSetupOverlay(status) {
    const overlay = document.getElementById("setupOverlay");
    overlay.classList.remove("hidden");
    
    const fileInput = document.getElementById("fileInput");
    const dropZone = document.getElementById("dropZone");
    const btnComplete = document.getElementById("btnCompleteSetup");
    
    // UI蛻晄悄蛹・
    updateSetupUI(status);

    // 繝峨Λ繝・げ・・ラ繝ｭ繝・・繧､繝吶Φ繝・
    dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("dragover"); });
    dropZone.addEventListener("dragleave", e => { e.preventDefault(); dropZone.classList.remove("dragover"); });
    dropZone.addEventListener("drop", async e => {
        e.preventDefault();
        dropZone.classList.remove("dragover");
        if (e.dataTransfer.files) {
            await handleSetupFiles(e.dataTransfer.files, status);
        }
    });

    // 繧ｯ繝ｪ繝・け縺ｧ繝輔ぃ繧､繝ｫ驕ｸ謚・
    dropZone.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async e => {
        if (e.target.files) {
            await handleSetupFiles(e.target.files, status);
        }
    });

    // 菫晏ｭ倥＠縺ｦ髢句ｧ九・繧ｿ繝ｳ
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
        } else if (name.includes("邵ｦ") && !name.includes("髦｡")) {
            await saveFileToDB("pdf_10000en", buffer);
            status.pdf_10000en = true;
        } else if (name.includes("髦｡")) {
            await saveFileToDB("pdf_1000en", buffer);
            status.pdf_1000en = true;
        } else if (name.includes("繝輔Μ繝ｼ")) {
            await saveFileToDB("pdf_free", buffer);
            status.pdf_free = true;
        }
    }
    updateSetupUI(status);
}

// --- 繝輔か繝ｼ繝ｫ繝舌ャ繧ｯ險ｭ螳・(config.json縺後↑縺・ｴ蜷医・繝・ヵ繧ｩ繝ｫ繝亥ｮ夂ｾｩ) ---
function getFallbackConfig() {
    return {
        "config_version": 23,
        "default_font": "HGSGyoshotai",
        "templates": {
            "10000en": {
                "template_file": "螂臥ｴ阪ユ繝ｳ繝励Ξ繝ｼ繝・pdf",
                "fields": {
                    "name":   { "x_mm": 24.4, "y_mm": 186.7, "font_size": 86,  "alignment": "center", "vertical": true, "width_mm": 32,  "height_mm": 191, "valign": "bottom" },
                    "amount": { "x_mm": 64.4, "y_mm": 276.4, "font_size": 172, "alignment": "center", "vertical": true, "width_mm": 62,  "height_mm": 314, "valign": "top" }
                }
            },
            "1000en": {
                "template_file": "螂臥ｴ阪ユ繝ｳ繝励Ξ繝ｼ繝・pdf",
                "fields": {
                    "name":   { "x_mm": 24.4, "y_mm": 186.7, "font_size": 86,  "alignment": "center", "vertical": true, "width_mm": 32,  "height_mm": 191, "valign": "bottom" },
                    "amount": { "x_mm": 64.4, "y_mm": 276.4, "font_size": 172, "alignment": "center", "vertical": true, "width_mm": 62,  "height_mm": 314, "valign": "top" }
                }
            },
            "free": {
                "template_file": "螂臥ｴ阪ユ繝ｳ繝励Ξ繝ｼ繝・pdf",
                "fields": {
                    "name":   { "x_mm": 24.4, "y_mm": 186.7, "font_size": 86,  "alignment": "center", "vertical": true, "width_mm": 32,  "height_mm": 191, "valign": "bottom" },
                    "amount": { "x_mm": 64.4, "y_mm": 276.4, "font_size": 172, "alignment": "center", "vertical": true, "width_mm": 62,  "height_mm": 314, "valign": "top" }
                }
            }
        }
    };
}

// --- 繝・じ繧､繝ｳ險ｭ螳壹・蛻晄悄蛹悶→LocalStorage騾｣謳ｺ ---
function initDesignSettings() {
    // config縺ｮ蜀・ｮｹ繧偵・繝ｼ繧ｹ縺ｫ縲´ocalStorage縺ｫ縺ｪ縺・ｨｭ螳壼､縺ｮ縺ｿ蛻晄悄蛟､縺ｧ蝓九ａ繧・
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
        console.error("LocalStorage繝・じ繧､繝ｳ險ｭ螳壹い繧ｯ繧ｻ繧ｹ繧ｨ繝ｩ繝ｼ:", e);
        designSettings = {};
    }
    // 逕ｨ邏吶し繧､繧ｺ險ｭ螳壹・隱ｭ縺ｿ霎ｼ縺ｿ
    try {
        const savedPaper = localStorage.getItem("pdf_mail_merge_paper_size");
        if (savedPaper) {
            paperSizeSettings = JSON.parse(savedPaper);
        }
    } catch (e) {
        console.error("逕ｨ邏吶し繧､繧ｺ險ｭ螳壹い繧ｯ繧ｻ繧ｹ繧ｨ繝ｩ繝ｼ:", e);
    }
}

function saveDesignSettings() {
    try {
        localStorage.setItem("pdf_mail_merge_design_settings", JSON.stringify(designSettings));
        localStorage.setItem("pdf_mail_merge_paper_size", JSON.stringify(paperSizeSettings));
    } catch (e) {
        console.warn("LocalStorage菫晏ｭ倥お繝ｩ繝ｼ:", e);
    }
}

// --- 逕ｨ邏吶し繧､繧ｺ隱ｿ謨ｴ ---
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
    paperSizeSettings = { width: 105, height: 390 };
    saveDesignSettings();
    updatePaperSizeUI();
    triggerAutoUpdate();
    showToast('逕ｨ邏吶し繧､繧ｺ繧偵ョ繝輔か繝ｫ繝茨ｼ・05 x 390mm・峨↓謌ｻ縺励∪縺励◆');
}

function updatePaperSizeUI() {
    const wEl = document.getElementById('paper-val-width');
    const hEl = document.getElementById('paper-val-height');
    if (wEl) wEl.textContent = paperSizeSettings.width.toFixed(1);
    if (hEl) hEl.textContent = paperSizeSettings.height.toFixed(1);
}

// --- 蜷咲ｰｿ繝・・繧ｿ繝吶・繧ｹ・亥ｱ･豁ｴ・峨・LocalStorage騾｣謳ｺ ---
function loadDbRecords() {
    try {
        const saved = localStorage.getItem("pdf_mail_merge_db");
        if (saved) {
            dbRecords = JSON.parse(saved);
        }
    } catch (e) {
        console.error("LocalStorage蜷咲ｰｿDB繧｢繧ｯ繧ｻ繧ｹ繧ｨ繝ｩ繝ｼ:", e);
        dbRecords = [];
    }
}

function saveDbRecords() {
    try {
        localStorage.setItem("pdf_mail_merge_db", JSON.stringify(dbRecords));
    } catch (e) {
        console.warn("LocalStorage菫晏ｭ倥お繝ｩ繝ｼ:", e);
    }
}

// --- 繝・Φ繝励Ξ繝ｼ繝・DF縺ｮ蜿門ｾ・(繧ｭ繝｣繝・す繝･蟇ｾ蠢・ ---
async function getTemplateBytes(templateKey) {
    if (loadedTemplateBytes[templateKey]) {
        return loadedTemplateBytes[templateKey];
    }
    
    const filename = config.templates[templateKey].template_file;
    showStatus("繝・Φ繝励Ξ繝ｼ繝・DF隱ｭ縺ｿ霎ｼ縺ｿ荳ｭ...", true);
    
    // 繝悶Λ繧ｦ繧ｶ縺ｮ繧ｭ繝｣繝・す繝･繧貞屓驕ｿ縺吶ｋ縺溘ａ縲√け繧ｨ繝ｪ繝代Λ繝｡繝ｼ繧ｿ繧剃ｻ倅ｸ・
    const response = await fetch(encodeURI(filename) + "?t=" + new Date().getTime());
    if (!response.ok) {
        throw new Error(`繝・Φ繝励Ξ繝ｼ繝医ヵ繧｡繧､繝ｫ縺瑚ｦ九▽縺九ｊ縺ｾ縺帙ｓ: ${filename}`);
    }
    
    const bytes = await response.arrayBuffer();
    loadedTemplateBytes[templateKey] = bytes; // 繧ｪ繝ｳ繝｡繝｢繝ｪ繧ｭ繝｣繝・す繝･
    showStatus("貅門ｙ螳御ｺ・, false);
    return bytes;
}

// --- 迥ｶ諷玖｡ｨ遉ｺ縺ｮ譖ｴ譁ｰ ---
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
        // 貅門ｙ螳御ｺ・凾縺ｯ縺励・繧峨￥縺励※繧｢繧､繧ｳ繝ｳ縺縺代メ繧ｧ繝・け繝槭・繧ｯ縺ｫ縺励※轤ｹ貊・ｒ豁｢繧√ｋ
    }
}

// --- 繝・Φ繝励Ξ繝ｼ繝亥・繧頑崛縺亥・逅・---
function selectTemplate(templateKey) {
    currentTemplate = templateKey;
    
    // UI繝懊ち繝ｳ縺ｮ繧｢繧ｯ繝・ぅ繝冶｡ｨ遉ｺ螟画峩
    document.querySelectorAll(".template-btn").forEach(btn => btn.classList.remove("active"));
    document.getElementById(`btn-${templateKey}`).classList.add("active");
    
    // 縺吶∋縺ｦ縺ｮ繝・Φ繝励Ξ繝ｼ繝医〒驥鷹｡阪ｒ蜊ｰ蟄励・蠕ｮ隱ｿ謨ｴ蜿ｯ閭ｽ縺ｫ縺吶ｋ縺溘ａ縲∝ｸｸ縺ｫ驥鷹｡阪ヵ繧｣繝ｼ繝ｫ繝峨ｒ陦ｨ遉ｺ
    const amountField = document.getElementById("amountField");
    if (amountField) amountField.style.display = "block";

    // 驕ｸ謚槭＆繧後◆繝・Φ繝励Ξ繝ｼ繝医↓蠢懊§縺ｦ閾ｪ蜍慕噪縺ｫ驥鷹｡阪・蛻晄悄蛟､繝ｻ繝ｩ繝吶Ν繝ｻ繝励Ξ繝ｼ繧ｹ繝帙Ν繝繝ｼ繧定ｨｭ螳・
    const amountLabel = document.getElementById("amountLabel") || document.querySelector("label[for='amountInput']");
    const amountInput = document.getElementById("amountInput");
    const amountSelect = document.getElementById("amountSelect");
    
    if (templateKey === "10000en" || templateKey === "1000en") {
        amountLabel.textContent = "莉ｻ諢上・驥鷹｡阪・謨ｰ蟄嶺ｸ譁・ｭ・(萓・ 荳, 莠・ 莠・";
        amountInput.style.display = "none";
        if(amountSelect) amountSelect.style.display = "block";
    } else {
        amountLabel.textContent = "莉ｻ諢上・驥鷹｡・縺ｾ縺溘・ 迚ｩ蜩∝錐";
        amountInput.placeholder = "萓・ 驥・莠秘丕蝨謎ｹ溘√♀逾樣・ 莠悟合";
        amountInput.style.display = "block";
        if(amountSelect) amountSelect.style.display = "none";
    }
    
    // 蠕ｮ隱ｿ謨ｴUI縺ｮ蛟､繧堤樟蝨ｨ縺ｮ繝・Φ繝励Ξ繝ｼ繝医・繝・・繧ｿ縺ｫ譖ｴ譁ｰ
    updateDpadUI();
    
    // 繝励Ξ繝薙Η繝ｼ蜀肴緒逕ｻ
    updatePreview();
}

// --- 蠕ｮ隱ｿ謨ｴUI謨ｰ蛟､縺ｮ譖ｴ譁ｰ ---


// --- 逕ｻ髱｢荳翫〒縺ｮ謨ｰ蛟､隱ｿ謨ｴ蜃ｦ逅・---
function adjustValue(fieldKey, param, change) {
    const settings = designSettings[currentTemplate];
    if (!settings || !settings[fieldKey]) return;

    settings[fieldKey][param] = parseFloat((settings[fieldKey][param] + change).toFixed(1));
    
    // LocalStorage菫晏ｭ・
    saveDesignSettings();
    
    // 繝励Ξ繝薙Η繝ｼ縺ｮ閾ｪ蜍墓峩譁ｰ・医ョ繝舌え繝ｳ繧ｹ縺ｧ螳溯｡鯉ｼ・
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
        
        const elX = document.getElementById("dpad-input-x");
        const elY = document.getElementById("dpad-input-y");
        if (elX) elX.value = settings[targetKey].x.toFixed(1);
        if (elY) elY.value = settings[targetKey].y.toFixed(1);

        
        const elFontSize = document.getElementById("dpad-val-font_size");
        const elWidth = document.getElementById("dpad-val-width_mm");
        const elHeight = document.getElementById("dpad-val-height_mm");
        const elValign = document.getElementById("dpad-val-valign");
        
        if (elFontSize) elFontSize.value = settings[targetKey].font_size;
        if (elWidth) elWidth.value = settings[targetKey].width_mm;
        if (elHeight) elHeight.value = settings[targetKey].height_mm;
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

// --- 繝輔か繝ｳ繝医し繧､繧ｺ遲峨・逶ｴ謗･蜈･蜉帶ｩ溯・ ---
function makeValueEditable(param) {
    const span = document.getElementById(`dpad-val-${param}`);
    if (!span) return;
    const currentVal = parseInt(span.textContent);
    const input = document.createElement('input');
    input.type = 'number';
    input.value = isNaN(currentVal) ? 0 : currentVal;
    input.style.cssText = 'width: 60px; text-align: center; font-weight: 600; font-family: monospace; border: 2px solid var(--accent); border-radius: 4px; padding: 2px; font-size: 14px;';
    span.replaceWith(input);
    input.focus();
    input.select();
    
    const confirm = () => {
        const newVal = parseInt(input.value);
        // 迴ｾ蝨ｨ驕ｸ謚樔ｸｭ縺ｮ繝輔ぅ繝ｼ繝ｫ繝・name/amount)縺ｮ蛟､繧呈峩譁ｰ
        const targetRadios = document.getElementsByName('dpadTarget');
        let targetKey = 'name';
        for (let i = 0; i < targetRadios.length; i++) {
            if (targetRadios[i].checked) { targetKey = targetRadios[i].value; break; }
        }
        
        if (!isNaN(newVal) && newVal > 0) {
            const settings = designSettings[currentTemplate];
            if (settings && settings[targetKey]) {
                settings[targetKey][param] = newVal;
                saveDesignSettings();
                triggerAutoUpdate();
            }
        }
        
        const newSpan = document.createElement('span');
        newSpan.id = `dpad-val-${param}`;
        newSpan.style.cssText = 'font-weight: 600; font-family: monospace; cursor: pointer;';
        newSpan.onclick = () => makeValueEditable(param);
        newSpan.textContent = designSettings[currentTemplate]?.[targetKey]?.[param] ?? '--';
        input.replaceWith(newSpan);
        updateDpadUI();
    };
    
    input.addEventListener('blur', confirm);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); confirm(); }
        if (e.key === 'Escape') { input.blur(); }
    });
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

// --- 繝・じ繧､繝ｳ隱ｿ謨ｴ縺ｮ蛻晄悄蛟､繝ｪ繧ｻ繝・ヨ ---
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
    showToast("繝・じ繧､繝ｳ隱ｿ謨ｴ繧貞・譛溷､縺ｫ繝ｪ繧ｻ繝・ヨ縺励∪縺励◆");
}

// --- 繝ｪ繧｢繝ｫ繧ｿ繧､繝繝励Ξ繝薙Η繝ｼ逕ｨ繝・ヰ繧ｦ繝ｳ繧ｹ蛻ｶ蠕｡ ---
function triggerAutoUpdate() {
    if (autoUpdateTimer) clearTimeout(autoUpdateTimer);
    autoUpdateTimer = setTimeout(() => {
        updatePreview();
    }, 300); // 300ms 蜈･蜉帙′豁｢縺ｾ縺｣縺溘ｉ繝ｪ繝ｬ繝ｳ繝繝ｪ繝ｳ繧ｰ
}

// --- D-Pad (蜊∝ｭ励く繝ｼ) 蛻ｶ蠕｡ ---
let dpadInterval = null;

function startDpad(direction) {
    if (dpadInterval) return;
    moveDpad(direction); // 蛻晏屓遘ｻ蜍・
    dpadInterval = setInterval(() => {
        moveDpad(direction);
    }, 120); // 髟ｷ謚ｼ縺玲凾縺ｮ騾｣邯夂ｧｻ蜍・
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
    
    const change = 0.5; // 0.5mm蜊倅ｽ阪〒遘ｻ蜍・
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

// --- 蜊倅ｽ榊､画鋤: mm -> pt ---
function mmToPt(mm) {
    return mm * 72 / 25.4;
}

// --- PDF縺ｮ蜍慕噪蜷域・蜃ｦ逅・ｼ医さ繧｢讖溯・・・---
async function generatePDF(isPrinting = false) {
    if (!isAppReady) {
        return null;
    }

    const nameInput = document.getElementById("nameInput").value.trim();
    const amountSelect = document.getElementById("amountSelect");
    const amountInput = currentTemplate === "free" ? document.getElementById("amountInput").value.trim() : (amountSelect ? amountSelect.value : document.getElementById("amountInput").value.trim());
    
    // 豌丞錐縺後↑縺・ｴ蜷医・蜷域・蜃ｦ逅・ｒ繧ｹ繧ｭ繝・・ (繝励Ξ繝薙Η繝ｼ繧ｯ繝ｪ繧｢迥ｶ諷九↓)
    if (!nameInput) {
        return null;
    }

    try {
        // 1. 繝・Φ繝励Ξ繝ｼ繝・DF縺ｮ蜿門ｾ暦ｼ・ndexedDB縺九ｉ莠句燕縺ｫ繝ｭ繝ｼ繝画ｸ医∩・・
        const templateBytes = loadedTemplateBytes[currentTemplate];
        if (!templateBytes) {
            throw new Error(`繝・Φ繝励Ξ繝ｼ繝医ョ繝ｼ繧ｿ縺瑚ｦ九▽縺九ｊ縺ｾ縺帙ｓ: ${currentTemplate}`);
        }
        // 2. pdf-lib縺ｧPDF繧偵Ο繝ｼ繝峨∪縺溘・譁ｰ隕丈ｽ懈・
        let pdfDoc;
        let firstPage;
        const includeBackground = document.getElementById("includeBackground") ? document.getElementById("includeBackground").checked : true;

        // 逕ｨ邏吶し繧､繧ｺ螟画峩縺ｮ險育ｮ・(蜴滓悽縺ｨ縺ｮ蟾ｮ蛻・〒 translateContent + setSize)
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
            // 繝・じ繧､繝ｳ繧偵そ繝ｳ繧ｿ繝ｪ繝ｳ繧ｰ縺励※縺九ｉ繝壹・繧ｸ繧ｵ繧､繧ｺ繧貞､画峩
            firstPage.translateContent(shiftXPt, shiftYPt);
            firstPage.setSize(newWidthPt, newHeightPt);
        } else {
            // 逋ｽ邏吶・PDF繧呈眠隕丈ｽ懈・・域眠縺励＞逕ｨ邏吶し繧､繧ｺ縺ｧ・・
            pdfDoc = await PDFLib.PDFDocument.create();
            firstPage = pdfDoc.addPage([newWidthPt, newHeightPt]);
        }
        
        // 3. 譌･譛ｬ隱槭ヵ繧ｩ繝ｳ繝医・隱ｭ縺ｿ霎ｼ縺ｿ縺ｨ蝓九ａ霎ｼ縺ｿ
        let fontToUse = null;
        if (loadedFontBytes) {
            try {
                pdfDoc.registerFontkit(window.fontkit);
                fontToUse = await pdfDoc.embedFont(new Uint8Array(loadedFontBytes), { subset: true });
            } catch (fontError) {
                console.error("繝輔か繝ｳ繝医・蝓九ａ霎ｼ縺ｿ縺ｫ螟ｱ謨励＠縺ｾ縺励◆縲よｨ呎ｺ悶ヵ繧ｩ繝ｳ繝医↓繝輔か繝ｼ繝ｫ繝舌ャ繧ｯ縺励∪縺・", fontError);
                fontToUse = await pdfDoc.embedStandardFont(PDFLib.StandardFonts.Helvetica);
            }
        } else {
            fontToUse = await pdfDoc.embedStandardFont(PDFLib.StandardFonts.Helvetica);
        }
        
        // 繝・じ繧､繝ｳ隱ｿ謨ｴ蛟､縺ｮ隱ｭ縺ｿ蜃ｺ縺・
        const settings = designSettings[currentTemplate];

        // 譁ｰ繝・Φ繝励Ξ繝ｼ繝・ 縲悟･臥ｴ阪阪・縺ｿ蜊ｰ蛻ｷ貂医∩ 竊・驥鷹｡阪・豌丞錐繧偵い繝励Μ蛛ｴ縺ｧ螳悟・蜷域・
        const fullAmount =
            currentTemplate === '10000en' ? `驥・{amountInput}關ｬ蝨謎ｹ歔 :
            currentTemplate === '1000en'  ? `驥・{amountInput}髦｡蝨謎ｹ歔 :
            amountInput; // free: 螳悟・閾ｪ逕ｱ蜈･蜉・
        const data = {
            name:   nameInput ? nameInput + '\u3000谿ｿ' : '',
            amount: fullAmount
        };

        // 蜷・ヵ繧｣繝ｼ繝ｫ繝峨・謠冗判
        for (const [fieldKey, fieldVal] of Object.entries(settings)) {
            const textValue = data[fieldKey];
            if (!textValue) continue;

            // 逕ｨ邏吶し繧､繧ｺ螟画峩縺ｫ莨ｴ縺・ユ繧ｭ繧ｹ繝亥ｺｧ讓吶・繧ｪ繝輔そ繝・ヨ驕ｩ逕ｨ
            let x_pt = mmToPt(fieldVal.x);
            let y_pt = mmToPt(fieldVal.y);

            // 閭梧勹繧貞性繧√ｋ蝣ｴ蜷医》ranslateContent() 縺ｫ繧医ｊ譌｢縺ｫPDF縺ｮ蜴溽せ縺後す繝輔ヨ縺輔ｌ縺ｦ縺・ｋ縺溘ａ
            // 蠎ｧ讓吶↓繧ｪ繝輔そ繝・ヨ繧定ｶｳ縺吝ｿ・ｦ√・縺ゅｊ縺ｾ縺帙ｓ・郁ｶｳ縺吶→2驥阪す繝輔ヨ縺ｫ縺ｪ繧翫∪縺呻ｼ峨・
            // 閭梧勹繧貞性繧√↑縺・ｼ育區邏吶・譁ｰ隕襲DF・牙ｴ蜷医・縺ｿ謇句虚縺ｧ繧ｪ繝輔そ繝・ヨ繧貞刈邂励＠縺ｾ縺吶・
            if (!includeBackground) {
                x_pt += shiftXPt;
                y_pt += shiftYPt;
            }
            const baseFontSize = fieldVal.font_size;
            const width_pt = mmToPt(fieldVal.width_mm || 30);
            const height_pt = mmToPt(fieldVal.height_mm || 150);
            
            const fieldConfig = config.templates[currentTemplate].fields[fieldKey];
            if (!fieldConfig) {
                console.warn(`繝輔ぅ繝ｼ繝ｫ繝芽ｨｭ螳壹′隕九▽縺九ｊ縺ｾ縺帙ｓ: ${fieldKey}`);
                continue;
            }
            const alignment = fieldConfig.alignment || "left";
            const isVertical = fieldConfig.vertical || false;

            let currentFontSize = baseFontSize;
            const showBoundingBox = document.getElementById("showBoundingBox") && document.getElementById("showBoundingBox").checked;

            if (isVertical) {
                // 邵ｦ譖ｸ縺阪・謠冗判蜃ｦ逅・
                const chars = Array.from(textValue);
                // 譫縺ｮ鬮倥＆縺ｫ蜿弱∪繧九ｈ縺・↓繝輔か繝ｳ繝医し繧､繧ｺ繧堤ｸｮ蟆・
                const currentHeight_pt = chars.length * (currentFontSize * 1.02);
                if (currentHeight_pt > height_pt) {
                    currentFontSize = height_pt / (chars.length * 1.02);
                }
                // 譫縺ｮ蟷・ｼ・譁・ｭ励・讓ｪ蟷・ｼ峨↓繧ょ庶縺ｾ繧九ｈ縺・↓邵ｮ蟆・
                if (currentFontSize > width_pt) {
                    currentFontSize = width_pt;
                }

                // 繝懊ャ繧ｯ繧ｹ縺ｮ荳顔ｫｯ繧定ｨ育ｮ暦ｼ亥・縲・・繝輔か繝ｳ繝医し繧､繧ｺ繧貞渕貅悶↓蝗ｺ螳夲ｼ・
                const boxTop = y_pt + baseFontSize;

                // 譫邱壹・謠冗判
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

                // 繝・く繧ｹ繝医・荳顔ｫｯ縺・boxTop 縺ｫ蜷医≧繧医≧縺ｫ譛蛻昴・譁・ｭ励・ baseline 繧定ｨｭ螳・(top)
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
                    if (char === "繝ｼ" || char === "笏" || char === "窶・ || char === "-") {
                        charToDraw = "荳ｨ";
                    } else if (char === "・・) {
                        charToDraw = "・ｵ";
                    } else if (char === "・・) {
                        charToDraw = "・ｶ";
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
                // 騾壼ｸｸ縺ｮ讓ｪ譖ｸ縺肴緒逕ｻ蜃ｦ逅・
                // 譫縺ｮ蟷・↓蜿弱∪繧九ｈ縺・↓繝輔か繝ｳ繝医し繧､繧ｺ繧堤ｸｮ蟆・
                const currentWidth_pt = fontToUse.widthOfTextAtSize(textValue, currentFontSize);
                if (currentWidth_pt > width_pt) {
                    currentFontSize = currentFontSize * (width_pt / currentWidth_pt);
                }
                // 譫縺ｮ鬮倥＆・・譁・ｭ励・鬮倥＆・峨↓繧ょ庶縺ｾ繧九ｈ縺・↓邵ｮ蟆・
                if (currentFontSize > height_pt) {
                    currentFontSize = height_pt;
                }

                if (showBoundingBox && !isPrinting) {
                    let boxX = x_pt;
                    if (alignment === "center") boxX = x_pt - (width_pt / 2);
                    else if (alignment === "right") boxX = x_pt - width_pt;
                    
                    // 繝吶・繧ｹ繝ｩ繧､繝ｳ縺ｮ蟆代＠荳九ｒ譫縺ｮ荳狗ｫｯ縺ｨ縺吶ｋ
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
                // 邵ｮ蟆丞ｾ後・繝輔か繝ｳ繝医し繧､繧ｺ縺ｧ蜀崎ｨ育ｮ・
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

        // 4. PDF繧剃ｿ晏ｭ倥＠縺ｦBlob繧堤函謌・
        const pdfBytes = await pdfDoc.save();
        return new Blob([pdfBytes], { type: "application/pdf" });

    } catch (e) {
        console.error("PDF蜷域・繧ｨ繝ｩ繝ｼ:", e);
        logError("PDF蜷域・繧ｨ繝ｩ繝ｼ縺ｮ繧ｭ繝｣繝・メ: " + (e.stack || e.message));
        showToast("PDF蜷域・荳ｭ縺ｫ繧ｨ繝ｩ繝ｼ縺檎匱逕溘＠縺ｾ縺励◆: " + e.message, "error");
        showStatus("PDF逕滓・繧ｨ繝ｩ繝ｼ", false);
        return null;
    }
}

// --- 繝ｪ繧｢繝ｫ繧ｿ繧､繝繝励Ξ繝薙Η繝ｼ譖ｴ譁ｰ・医メ繝ｩ縺､縺埼亟豁｢迚茨ｼ・---
async function updatePreview() {
    const pdfCanvas = document.getElementById("pdfCanvas");
    const previewPlaceholder = document.getElementById("previewPlaceholder");
    
    showStatus("PDF逕滓・荳ｭ...", true);
    const pdfBlob = await generatePDF(false);
    
    if (pdfBlob && pdfjsLib) {
        try {
            const arrayBuffer = await pdfBlob.arrayBuffer();
            const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
            const pdf = await loadingTask.promise;
            const page = await pdf.getPage(1);
            
            const container = pdfCanvas.parentElement;
            
            const containerWidth = container.clientWidth - 40; 
            const containerHeight = container.clientHeight - 40;
            
            const unscaledViewport = page.getViewport({ scale: 1.0 });
            const scale = Math.min(containerWidth / unscaledViewport.width, containerHeight / unscaledViewport.height);
            
            const viewport = page.getViewport({ scale: scale });
            
            const outputScale = window.devicePixelRatio || 1;
            
            // 繧ｪ繝輔せ繧ｯ繝ｪ繝ｼ繝ｳcanvas縺ｧ蜈医↓繝ｬ繝ｳ繝繝ｪ繝ｳ繧ｰ・医メ繝ｩ縺､縺埼亟豁｢・・
            const offscreen = document.createElement('canvas');
            offscreen.width = Math.floor(viewport.width * outputScale);
            offscreen.height = Math.floor(viewport.height * outputScale);
            
            const offCtx = offscreen.getContext('2d');
            const transform = outputScale !== 1 
              ? [outputScale, 0, 0, outputScale, 0, 0] 
              : null;

            const renderContext = {
              canvasContext: offCtx,
              transform: transform,
              viewport: viewport
            };
            
            await page.render(renderContext).promise;
            
            // 繝ｬ繝ｳ繝繝ｪ繝ｳ繧ｰ螳御ｺ・ｾ後↓繝｡繧､繝ｳcanvas縺ｸ荳諡ｬ繧ｳ繝斐・
            pdfCanvas.width = offscreen.width;
            pdfCanvas.height = offscreen.height;
            pdfCanvas.style.width = Math.floor(viewport.width) + "px";
            pdfCanvas.style.height = Math.floor(viewport.height) + "px";
            const mainCtx = pdfCanvas.getContext('2d');
            mainCtx.drawImage(offscreen, 0, 0);
            
            pdfCanvas.style.display = "block";
            previewPlaceholder.style.display = "none";
            showStatus("繝励Ξ繝薙Η繝ｼ譖ｴ譁ｰ螳御ｺ・, false);
        } catch (error) {
            logError("PDF.js Render Error: " + error);
            showStatus("繝励Ξ繝薙Η繝ｼ陦ｨ遉ｺ繧ｨ繝ｩ繝ｼ", false);
        }
    } else {
        // pdfBlob縺系ull・域ｰ丞錐譛ｪ蜈･蜉帙↑縺ｩ・峨・蝣ｴ蜷医・縺ｿcanvas繧偵け繝ｪ繧｢
        if (!pdfBlob) {
            pdfCanvas.style.display = "none";
            previewPlaceholder.style.display = "flex";
        }
        showStatus("貅門ｙ螳御ｺ・, false);
    }
}

// --- 蜊ｰ蛻ｷ / PDF菫晏ｭ倥い繧ｯ繧ｷ繝ｧ繝ｳ ---
async function printPDF() {
    const nameInput = document.getElementById("nameInput").value.trim();
    if (!nameInput) {
        showToast("豌丞錐繧貞・蜉帙＠縺ｦ縺九ｉ蜊ｰ蛻ｷ縺励※縺上□縺輔＞", "error");
        return;
    }

    showStatus("蜊ｰ蛻ｷ逕ｨ繝・・繧ｿ繧呈ｺ門ｙ荳ｭ...", true);
    const pdfBlob = await generatePDF(true);
    
    if (pdfBlob) {
        const pdfUrl = URL.createObjectURL(pdfBlob);
        
        // 蛻･繧ｿ繝悶〒髢九＞縺ｦ蜊ｰ蛻ｷ繧貞ｮ溯｡後＆縺帙ｋ
        const newWindow = window.open(pdfUrl, "_blank");
        if (newWindow) {
            newWindow.onload = () => {
                newWindow.print();
            };
            showToast("蜊ｰ蛻ｷ繝励Ξ繝薙Η繝ｼ繧貞挨繧ｿ繝悶〒髢九″縺ｾ縺励◆");
        } else {
            // 繝昴ャ繝励い繝・・縺後ヶ繝ｭ繝・け縺輔ｌ縺溷ｴ蜷医・逶ｴ謗･繝繧ｦ繝ｳ繝ｭ繝ｼ繝・
            const link = document.createElement("a");
            link.href = pdfUrl;
            link.download = `螂臥ｴ阪ン繝ｩ_${nameInput}.pdf`;
            link.click();
            showToast("繝昴ャ繝励い繝・・縺後ヶ繝ｭ繝・け縺輔ｌ縺溘◆繧√￣DF繧偵ム繧ｦ繝ｳ繝ｭ繝ｼ繝峨＠縺ｾ縺励◆");
        }
        showStatus("蜊ｰ蛻ｷ繝・・繧ｿ蜃ｺ蜉帛ｮ御ｺ・, false);
        
        // 蜊ｰ蛻ｷ螻･豁ｴ縺ｸ縺ｮ逋ｻ骭ｲ
        saveRecord(false); // 驥崎､・ｒ驕ｿ縺代ｋ縺溘ａ髱吶°縺ｫ閾ｪ蜍慕匳骭ｲ
    }
}

// --- 繝・・繧ｿ繝吶・繧ｹ・亥ｱ･豁ｴ逋ｻ骭ｲ繝ｻ陦ｨ遉ｺ・牙・逅・---
function saveRecord(showNotice = true) {
    const nameInput = document.getElementById("nameInput").value.trim();
    const amountSelect = document.getElementById("amountSelect");
    const amountInput = currentTemplate === "free" ? document.getElementById("amountInput").value.trim() : (amountSelect ? amountSelect.value : document.getElementById("amountInput").value.trim());
    
    if (!nameInput) {
        if (showNotice) showToast("豌丞錐繧貞・蜉帙＠縺ｦ縺上□縺輔＞", "error");
        return;
    }

    // 驥崎､・メ繧ｧ繝・け (蜷御ｸ縺ｮ豌丞錐縺九▽驥鷹｡阪°縺､繝・Φ繝励Ξ繝ｼ繝医′逶ｴ霑代↓縺ゅｌ縺ｰ繧ｹ繧ｭ繝・・)
    const isDuplicate = dbRecords.some(r => 
        r.name === nameInput && 
        r.amount === amountInput && 
        r.template === currentTemplate &&
        (new Date().getTime() - new Date(r.date).getTime() < 30000) // 30遘剃ｻ･蜀・・蜷御ｸ繝・・繧ｿ
    );
    
    if (isDuplicate) return;

    let dbAmount = amountInput;
    if (currentTemplate === "10000en") {
        dbAmount = `驥・{amountInput || "荳"}關ｬ蝨謎ｹ歔;
    } else if (currentTemplate === "1000en") {
        dbAmount = `驥・{amountInput || "荳"}髦｡蝨謎ｹ歔;
    }

    const newRecord = {
        id: "rec_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
        date: new Date().toISOString(),
        template: currentTemplate,
        name: nameInput,
        amount: dbAmount
    };

    dbRecords.unshift(newRecord); // 蜈磯ｭ縺ｫ霑ｽ蜉
    saveDbRecords();
    renderTable();
    
    // 繧ｹ繝励Ξ繝・ラ繧ｷ繝ｼ繝磯｣謳ｺ・・AS・峨∈髱槫酔譛溘〒螻･豁ｴ繧帝∽ｿ｡
    sendToGAS(newRecord);
    
    if (showNotice) {
        showToast("蜷咲ｰｿ縺ｫ豁｣蟶ｸ縺ｫ逋ｻ骭ｲ縺励∪縺励◆・・);
    }
}

function deleteRecord(id) {
    if (confirm("縺薙・繝ｬ繧ｳ繝ｼ繝峨ｒ蜷咲ｰｿ縺九ｉ蜑企勁縺励∪縺吶°・・)) {
        dbRecords = dbRecords.filter(r => r.id !== id);
        saveDbRecords();
        renderTable();
        showToast("蜷咲ｰｿ縺九ｉ蜑企勁縺励∪縺励◆");
    }
}

// --- 蜷咲ｰｿ繧｢繧､繝・Β縺ｮ繝輔か繝ｼ繝蜻ｼ縺ｳ蜃ｺ縺・---
function loadRecordToForm(id) {
    const record = dbRecords.find(r => r.id === id);
    if (!record) return;

    // 1. 繝・Φ繝励Ξ繝ｼ繝医・螟画峩
    selectTemplate(record.template);
    
    // 2. 繝輔か繝ｼ繝蜈･蜉帛､縺ｮ險ｭ螳・
    document.getElementById("nameInput").value = record.name;
    
    if (record.template === "10000en" || record.template === "1000en") {
        // 螻･豁ｴDB縺ｮ "驥台ｺ碑成蝨謎ｹ・ 縺九ｉ "莠・ 繧呈歓蜃ｺ縺励※UI縺ｫ蜈･蜉・
        let val = record.amount;
        if (val.startsWith("驥・)) {
            val = val.substring(1);
        }
        if (val.endsWith("關ｬ蝨謎ｹ・)) {
            val = val.substring(0, val.length - 3);
        } else if (val.endsWith("髦｡蝨謎ｹ・)) {
            val = val.substring(0, val.length - 3);
        } else if (val.endsWith("髦｡蝨・ｹ・)) {
            val = val.substring(0, val.length - 3);
        }
        const amountSelect = document.getElementById("amountSelect");
        if (amountSelect) amountSelect.value = val;
        document.getElementById("amountInput").value = val;
    } else {
        document.getElementById("amountInput").value = record.amount;
    }

    // 3. 繝励Ξ繝薙Η繝ｼ縺ｮ蜀肴緒逕ｻ
    updatePreview();
    showToast("蜷咲ｰｿ繝・・繧ｿ繧貞・蜉帙ヵ繧ｩ繝ｼ繝縺ｫ隱ｭ縺ｿ霎ｼ縺ｿ縺ｾ縺励◆");
}

// --- 蜷咲ｰｿ繝・・繝悶Ν縺ｮ繝ｬ繝ｳ繝繝ｪ繝ｳ繧ｰ ---
function renderTable() {
    const tbody = document.getElementById("historyTableBody");
    const searchInput = document.getElementById("searchInput").value.trim().toLowerCase();
    
    tbody.innerHTML = "";
    
    // 讀懃ｴ｢繝輔ぅ繝ｫ繧ｿ繝ｪ繝ｳ繧ｰ
    const filteredRecords = dbRecords.filter(r => 
        r.name.toLowerCase().includes(searchInput) || 
        r.amount.toLowerCase().includes(searchInput)
    );

    if (filteredRecords.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="no-data">逋ｻ骭ｲ縺輔ｌ縺ｦ縺・ｋ蜷咲ｰｿ繝・・繧ｿ縺ｯ縺ゅｊ縺ｾ縺帙ｓ縲・/td></tr>`;
        return;
    }

    filteredRecords.forEach(r => {
        const tr = document.createElement("tr");
        
        // 譌･莉倥ヵ繧ｩ繝ｼ繝槭ャ繝・
        const d = new Date(r.date);
        const dateStr = `${d.getFullYear()}/${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getDate().toString().padStart(2,'0')} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
        
        // 繝・Φ繝励Ξ繝ｼ繝医ヰ繝・ず
        let badgeClass = "badge-10000";
        let badgeText = "關ｬ蝨鍋畑";
        if (r.template === "1000en") {
            badgeClass = "badge-100";
            badgeText = "髦｡蝨鍋畑";
        } else if (r.template === "free") {
            badgeClass = "badge-free";
            badgeText = "繝輔Μ繝ｼ";
        }

        tr.innerHTML = `
            <td data-label=""><input type="checkbox" class="record-checkbox" value="${r.id}" onchange="updateBatchCount()" style="transform: scale(1.3);"></td>
            <td data-label="譌･譎・>${dateStr}</td>
            <td data-label="蜿ｰ邏咏ｨｮ鬘・><span class="badge ${badgeClass}">${badgeText}</span></td>
            <td data-label="豌丞錐" style="font-weight: 500;">${escapeHTML(r.name)}</td>
            <td data-label="驥鷹｡・迚ｩ蜩・>${escapeHTML(r.amount)}</td>
            <td data-label="">
                <div class="action-btns">
                    <button class="btn-table btn-table-edit" onclick="loadRecordToForm('${r.id}')">
                        <i class="fa-solid fa-arrows-spin"></i>蜻ｼ縺ｳ蜃ｺ縺・
                    </button>
                    <button class="btn-table btn-table-del" onclick="deleteRecord('${r.id}')">
                        <i class="fa-solid fa-trash-can"></i>蜑企勁
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// --- CSV繧ｨ繧ｯ繧ｹ繝昴・繝域ｩ溯・ ---
function exportCSV() {
    if (dbRecords.length === 0) {
        showToast("繧ｨ繧ｯ繧ｹ繝昴・繝医☆繧九ョ繝ｼ繧ｿ縺後≠繧翫∪縺帙ｓ", "error");
        return;
    }

    let csvContent = "\ufeff"; // Excel縺ｧ縺ｮ譁・ｭ怜喧縺代ｒ髦ｲ縺舌◆繧√・BOM莉倥″UTF-8
    csvContent += "譌･譎・繝・Φ繝励Ξ繝ｼ繝育ｨｮ鬘・螂臥ｴ崎・ｰ丞錐,驥鷹｡・迚ｩ蜩∝錐\n";

    dbRecords.forEach(r => {
        const d = new Date(r.date);
        const dateStr = `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${d.getMinutes()}`;
        const templateStr = r.template === "10000en" ? "關ｬ蝨鍋畑" : (r.template === "1000en" ? "髦｡蝨鍋畑" : "繝輔Μ繝ｼ逕ｨ");
        
        // 繧ｫ繝ｳ繝槭ｄ繝繝悶Ν繧ｯ繧ｩ繝ｼ繝・・繧ｷ繝ｧ繝ｳ縺ｮ繧ｨ繧ｹ繧ｱ繝ｼ繝・
        const escapedName = `"${r.name.replace(/"/g, '""')}"`;
        const escapedAmount = `"${r.amount.replace(/"/g, '""')}"`;

        csvContent += `${dateStr},${templateStr},${escapedName},${escapedAmount}\n`;
    });

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `螂臥ｴ榊錐邁ｿ螻･豁ｴ_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("蜷咲ｰｿ繝・・繧ｿ繧辰SV縺ｨ縺励※蜃ｺ蜉帙＠縺ｾ縺励◆・・);
}

// --- 繧｢繧ｳ繝ｼ繝・ぅ繧ｪ繝ｳ縺ｮ髢矩哩 ---
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

// #8 繧ｹ繝槭・縺ｧ縺ｯ蠕ｮ隱ｿ謨ｴ繧｢繧ｳ繝ｼ繝・ぅ繧ｪ繝ｳ繧偵ョ繝輔か繝ｫ繝医〒髢九￥
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

// #9 繧ｹ繝槭・逕ｨPDF菫晏ｭ假ｼ育峩謗･繝繧ｦ繝ｳ繝ｭ繝ｼ繝会ｼ・
async function mobilePrintPDF() {
    const nameInput = document.getElementById("nameInput").value.trim();
    if (!nameInput) {
        showToast("豌丞錐繧貞・蜉帙＠縺ｦ縺九ｉ菫晏ｭ倥＠縺ｦ縺上□縺輔＞", "error");
        return;
    }

    showStatus("PDF逕滓・荳ｭ...", true);
    const pdfBlob = await generatePDF(true);
    
    if (pdfBlob) {
        const pdfUrl = URL.createObjectURL(pdfBlob);
        const link = document.createElement("a");
        link.href = pdfUrl;
        link.download = `螂臥ｴ阪ン繝ｩ_${nameInput}.pdf`;
        link.click();
        URL.revokeObjectURL(pdfUrl);
        showToast("PDF繧剃ｿ晏ｭ倥＠縺ｾ縺励◆");
        showStatus("PDF菫晏ｭ伜ｮ御ｺ・, false);
        saveRecord(false);
    }
}

// iPhone AirPrint逕ｨ縺ｮ蜊ｰ蛻ｷ讖溯・
async function mobilePrintAirPrint() {
    const nameInput = document.getElementById("nameInput").value.trim();
    if (!nameInput) {
        showToast("豌丞錐繧貞・蜉帙＠縺ｦ縺九ｉ蜊ｰ蛻ｷ縺励※縺上□縺輔＞", "error");
        return;
    }

    showStatus("蜊ｰ蛻ｷ繝・・繧ｿ貅門ｙ荳ｭ...", true);
    
    try {
        const pdfBlob = await generatePDF(true);
        
        if (!pdfBlob) {
            showToast("PDF縺ｮ逕滓・縺ｫ螟ｱ謨励＠縺ｾ縺励◆", "error");
            showStatus("貅門ｙ螳御ｺ・, false);
            return;
        }

        const fileName = `螂臥ｴ阪ン繝ｩ_${nameInput}.pdf`;

        // 譁ｹ豕・: iOS Web Share API 縺ｧPDF繧貞・譛峨す繝ｼ繝医↓騾√ｋ
        // 蜈ｱ譛峨す繝ｼ繝医°繧峨後・繝ｪ繝ｳ繝医坂・ AirPrint
        if (navigator.share) {
            try {
                const pdfFile = new File([pdfBlob], fileName, { type: "application/pdf" });
                const shareData = { files: [pdfFile] };
                
                if (navigator.canShare && navigator.canShare(shareData)) {
                    await navigator.share(shareData);
                    showStatus("蜊ｰ蛻ｷ貅門ｙ螳御ｺ・, false);
                    saveRecord(false);
                    return;
                }
            } catch (e) {
                if (e.name === "AbortError") {
                    showStatus("貅門ｙ螳御ｺ・, false);
                    return;
                }
                console.warn("Share API:", e);
            }
        }

        // 譁ｹ豕・: 蛻･繧ｿ繝悶〒PDF繧帝幕縺擾ｼ亥・譛峨・繧ｿ繝ｳ竊偵・繝ｪ繝ｳ繝茨ｼ・
        const pdfUrl = URL.createObjectURL(pdfBlob);
        const link = document.createElement("a");
        link.href = pdfUrl;
        link.target = "_blank";
        link.rel = "noopener";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        showToast("PDF繧帝幕縺阪∪縺励◆縲ょ・譛峨・繧ｿ繝ｳ竊偵後・繝ｪ繝ｳ繝医阪〒蜊ｰ蛻ｷ縺ｧ縺阪∪縺吶・);
        showStatus("蜊ｰ蛻ｷ貅門ｙ螳御ｺ・, false);
        saveRecord(false);
        
    } catch (e) {
        logError("蜊ｰ蛻ｷ繧ｨ繝ｩ繝ｼ: " + e.message);
        showToast("蜊ｰ蛻ｷ縺ｫ螟ｱ謨励＠縺ｾ縺励◆: " + e.message, "error");
        showStatus("貅門ｙ螳御ｺ・, false);
    }
}

// #7 髟ｷ謚ｼ縺励Μ繝斐・繝域ｩ溯・・・/-繝懊ち繝ｳ・・
(function setupLongPressRepeat() {
    document.addEventListener("DOMContentLoaded", () => {
        document.querySelectorAll(".calib-btn").forEach(btn => {
            let intervalId = null;
            let timeoutId = null;

            const startRepeat = (e) => {
                e.preventDefault();
                // 蛻晏屓縺ｯ騾壼ｸｸ縺ｮ繧ｯ繝ｪ繝・け縺ｧ蜃ｦ逅・ｸ医∩
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

// --- 繝輔か繝ｼ繝縺ｮ繧ｯ繝ｪ繧｢ ---
function clearForm() {
    document.getElementById("nameInput").value = "";
    document.getElementById("amountInput").value = "";
    const amountSelect = document.getElementById("amountSelect");
    if (amountSelect) amountSelect.value = "荳";
    updatePreview();
    showToast("繝輔か繝ｼ繝繧偵け繝ｪ繧｢縺励∪縺励◆");
}

// --- HTML繧ｨ繧ｹ繧ｱ繝ｼ繝・---
function escapeHTML(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// --- 繝医・繧ｹ繝磯夂衍縺ｮ陦ｨ遉ｺ ---
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

// --- 繧ｹ繝励Ξ繝・ラ繧ｷ繝ｼ繝磯｣謳ｺ・・AS・陰PI ---

// GAS縺九ｉ繧ｵ繧ｸ繧ｧ繧ｹ繝医ョ繝ｼ繧ｿ繧貞叙蠕暦ｼ・ET・・
async function syncFromGAS(isBackground = false) {
    if (!gasUrl) {
        if (!isBackground) showToast("GAS縺ｮ繧ｦ繧ｧ繝悶い繝励ΜURL繧定ｨｭ螳壹＠縺ｦ縺上□縺輔＞", "error");
        return;
    }

    const btn = document.getElementById("btnSyncGAS");
    if (btn) {
        btn.innerHTML = '<i class="fa-solid fa-rotate"></i> 蜷梧悄荳ｭ...';
        btn.style.opacity = "0.7";
        btn.disabled = true;
    }

    try {
        // 繧ｭ繝｣繝・す繝･繧ｯ繝ｪ繧｢縺ｮ縺溘ａ縺ｮ繧ｿ繧､繝繧ｹ繧ｿ繝ｳ繝励ｒ霑ｽ蜉
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

        // 繧ｵ繧ｸ繧ｧ繧ｹ繝医ョ繝ｼ繧ｿ繧呈峩譁ｰ・域眠譁ｹ蠑上・names/items縺ｫ蟇ｾ蠢懊＠縲∵立譁ｹ蠑上・3蛻励ョ繝ｼ繧ｿ繧ゅ・繝ｼ繧ｸ縺励※邨ｱ蜷医☆繧句ｾ梧婿莠呈鋤蜃ｦ逅・ｼ・
        const rawNames = data.names || [
            ...(data["10000en_names"] || []),
            ...(data["1000en_names"] || []),
            ...(data["free_names"] || [])
        ];
        // 驥崎､・賜髯､縺励※譬ｼ邏・
        suggestData.names = [...new Set(rawNames)];
        suggestData.items = data.items || data["free_items"] || [];

        // LocalStorage縺ｫ菫晏ｭ・
        try {
            localStorage.setItem("pdf_mail_merge_suggests", JSON.stringify(suggestData));
            localStorage.setItem("pdf_mail_merge_suggests_time", new Date().toISOString());
        } catch (e) { /* 辟｡隕・*/ }

        if (!isBackground) {
            const totalCount = suggestData.names.length + suggestData.items.length;
            showToast(`繧ｹ繝励Ξ繝・ラ繧ｷ繝ｼ繝医°繧峨し繧ｸ繧ｧ繧ｹ繝医ョ繝ｼ繧ｿ ${totalCount}莉ｶ繧貞酔譛溘＠縺ｾ縺励◆`);
        }
    } catch (e) {
        console.error("GAS蜷梧悄繧ｨ繝ｩ繝ｼ:", e);
        if (!isBackground) showToast("繧ｵ繧ｸ繧ｧ繧ｹ繝医ョ繝ｼ繧ｿ縺ｮ蜷梧悄縺ｫ螟ｱ謨励＠縺ｾ縺励◆: " + e.message, "error");
    } finally {
        if (btn) {
            btn.innerHTML = '<i class="fa-solid fa-rotate"></i> 繧ｹ繝励Ξ繝・ラ繧ｷ繝ｼ繝医°繧牙酔譛・;
            btn.style.opacity = "1";
            btn.disabled = false;
        }
    }
}

// 螻･豁ｴ繝・・繧ｿ繧偵せ繝励Ξ繝・ラ繧ｷ繝ｼ繝医∈閾ｪ蜍戊ｿｽ險假ｼ・OST・・ 繧ｪ繝輔Λ繧､繝ｳ繧ｭ繝･繝ｼ蟇ｾ蠢・
async function sendToGAS(record) {
    if (!gasUrl) return; // GAS URL縺梧悴險ｭ螳壹↑繧峨せ繧ｭ繝・・

    let templateTypeStr = "繝輔Μ繝ｼ逕ｨ";
    if (record.template === "10000en") {
        templateTypeStr = "關ｬ蝨鍋畑";
    } else if (record.template === "1000en") {
        templateTypeStr = "髦｡蝨鍋畑";
    }

    const payload = {
        timestamp: new Date(record.date).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }),
        templateType: templateTypeStr,
        name: record.name,
        amount: record.amount
    };

    // 繧ｪ繝輔Λ繧､繝ｳ縺ｮ蝣ｴ蜷医・繧ｭ繝･繝ｼ縺ｫ霑ｽ蜉縺励※邨ゆｺ・
    if (!navigator.onLine) {
        addToOfflineQueue(payload);
        console.log("繧ｪ繝輔Λ繧､繝ｳ縺ｮ縺溘ａ繧ｭ繝･繝ｼ縺ｫ霑ｽ蜉縺励∪縺励◆");
        return;
    }

    try {
        console.log("GAS縺ｸ縺ｮPOST騾∽ｿ｡繧帝幕蟋九＠縺ｾ縺・..", payload);
        await fetch(gasUrl, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        console.log("GAS縺ｸ縺ｮ繝・・繧ｿ騾∽ｿ｡隕∵ｱゅｒ騾∽ｿ｡縺励∪縺励◆");
    } catch (e) {
        // 繝阪ャ繝医Ρ繝ｼ繧ｯ繧ｨ繝ｩ繝ｼ譎ゅ・繧ｭ繝･繝ｼ縺ｫ霑ｽ蜉
        console.warn("GAS騾∽ｿ｡螟ｱ謨励√が繝輔Λ繧､繝ｳ繧ｭ繝･繝ｼ縺ｫ霑ｽ蜉:", e.message);
        addToOfflineQueue(payload);
    }
}

// --- 繧ｪ繝輔Λ繧､繝ｳ繧ｭ繝･繝ｼ邂｡逅・---
const OFFLINE_QUEUE_KEY = "pdf_mail_merge_offline_queue";

// 繧ｭ繝･繝ｼ縺ｫ繝壹う繝ｭ繝ｼ繝峨ｒ霑ｽ蜉
function addToOfflineQueue(payload) {
    try {
        const queue = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || "[]");
        queue.push({ payload, queuedAt: new Date().toISOString() });
        localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
        updateOfflineQueueBadge();
    } catch (e) {
        console.error("繧ｪ繝輔Λ繧､繝ｳ繧ｭ繝･繝ｼ菫晏ｭ倥お繝ｩ繝ｼ:", e);
    }
}

// 繧ｭ繝･繝ｼ縺ｮ莉ｶ謨ｰ繧貞叙蠕・
function getOfflineQueueCount() {
    try {
        const queue = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || "[]");
        return queue.length;
    } catch (e) {
        return 0;
    }
}

// 譛ｪ騾∽ｿ｡繝舌ャ繧ｸ縺ｮ譖ｴ譁ｰ
function updateOfflineQueueBadge() {
    const count = getOfflineQueueCount();
    let badge = document.getElementById("offlineQueueBadge");
    
    if (count === 0) {
        if (badge) badge.style.display = "none";
        return;
    }
    
    if (!badge) {
        // 繝舌ャ繧ｸ隕∫ｴ縺後↑縺代ｌ縺ｰ蜍慕噪縺ｫ菴懈・・医せ繝・・繧ｿ繧ｹ繝舌・讓ｪ縺ｫ驟咲ｽｮ・・
        badge = document.createElement("div");
        badge.id = "offlineQueueBadge";
        badge.style.cssText = "display: inline-flex; align-items: center; gap: 6px; font-size: 12px; background: #fef3c7; color: #d97706; padding: 4px 10px; border-radius: 20px; border: 1px solid #fde68a; cursor: pointer; font-weight: 600;";
        badge.title = "繧ｯ繝ｪ繝・け縺励※譛ｪ騾∽ｿ｡繝・・繧ｿ繧貞・騾∽ｿ｡";
        badge.onclick = () => flushOfflineQueue();
        const header = document.querySelector("header");
        if (header) header.appendChild(badge);
    }
    
    badge.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> 譛ｪ騾∽ｿ｡ ${count}莉ｶ`;
    badge.style.display = "inline-flex";
}

// 繧ｭ繝･繝ｼ縺ｮ荳諡ｬ騾∽ｿ｡・医が繝ｳ繝ｩ繧､繝ｳ蠕ｩ蟶ｰ譎ゅ↓閾ｪ蜍募ｮ溯｡鯉ｼ・
async function flushOfflineQueue() {
    if (!gasUrl || !navigator.onLine) return;
    
    let queue;
    try {
        queue = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || "[]");
    } catch (e) {
        return;
    }
    
    if (queue.length === 0) return;
    
    console.log(`繧ｪ繝輔Λ繧､繝ｳ繧ｭ繝･繝ｼ: ${queue.length}莉ｶ縺ｮ譛ｪ騾∽ｿ｡繝・・繧ｿ繧帝∽ｿ｡髢句ｧ・..`);
    showToast(`譛ｪ騾∽ｿ｡繝・・繧ｿ ${queue.length}莉ｶ繧偵せ繝励Ξ繝・ラ繧ｷ繝ｼ繝医↓騾∽ｿ｡荳ｭ...`);
    
    const failedItems = [];
    
    for (const item of queue) {
        try {
            await fetch(gasUrl, {
                method: "POST",
                mode: "no-cors",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(item.payload)
            });
            console.log("繧ｭ繝･繝ｼ繧｢繧､繝・Β騾∽ｿ｡謌仙粥:", item.payload.name);
        } catch (e) {
            console.warn("繧ｭ繝･繝ｼ繧｢繧､繝・Β騾∽ｿ｡螟ｱ謨・", e.message);
            failedItems.push(item);
        }
    }
    
    // 螟ｱ謨怜・縺縺代く繝･繝ｼ縺ｫ谿九☆
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(failedItems));
    updateOfflineQueueBadge();
    
    const successCount = queue.length - failedItems.length;
    if (successCount > 0) {
        showToast(`譛ｪ騾∽ｿ｡繝・・繧ｿ ${successCount}莉ｶ繧偵せ繝励Ξ繝・ラ繧ｷ繝ｼ繝医↓騾∽ｿ｡縺励∪縺励◆・～);
    }
    if (failedItems.length > 0) {
        showToast(`${failedItems.length}莉ｶ縺ｮ騾∽ｿ｡縺ｫ螟ｱ謨励＠縺ｾ縺励◆縲ょｾ後〒蜀崎ｩｦ陦後＠縺ｾ縺吶Ａ, "error");
    }
}

// 繧ｪ繝ｳ繝ｩ繧､繝ｳ蠕ｩ蟶ｰ譎ゅ↓繧ｭ繝･繝ｼ繧定・蜍暮∽ｿ｡
window.addEventListener("online", () => {
    console.log("繝阪ャ繝医Ρ繝ｼ繧ｯ謗･邯壹′蝗槫ｾｩ縺励∪縺励◆");
    setTimeout(() => flushOfflineQueue(), 2000); // 謗･邯壼ｮ牙ｮ壹・縺溘ａ2遘貞ｾ・▽
});

// 繧ｪ繝輔Λ繧､繝ｳ讀懃衍譎ゅ↓繝舌ャ繧ｸ陦ｨ遉ｺ繧呈峩譁ｰ
window.addEventListener("offline", () => {
    console.log("繝阪ャ繝医Ρ繝ｼ繧ｯ謗･邯壹′蛻・妙縺輔ｌ縺ｾ縺励◆");
});

// 繧｢繝励Μ襍ｷ蜍墓凾縺ｫ繧ｭ繝･繝ｼ繧偵メ繧ｧ繝・け
window.addEventListener("DOMContentLoaded", () => {
    updateOfflineQueueBadge();
    // 繧ｪ繝ｳ繝ｩ繧､繝ｳ縺ｪ繧画悴騾∽ｿ｡繧ｭ繝･繝ｼ繧定・蜍暮∽ｿ｡
    if (navigator.onLine && getOfflineQueueCount() > 0) {
        setTimeout(() => flushOfflineQueue(), 5000);
    }
});

// ==========================================
// 繝懊ヨ繝繧ｷ繝ｼ繝茨ｼ医し繧ｸ繧ｧ繧ｹ繝・I・牙宛蠕｡繝ｭ繧ｸ繝・け
// ==========================================
let currentSheetTarget = 'name'; // 'name' or 'amount'
let currentSheetTab = 'recent'; // 'recent' or 'cloud'

function openBottomSheet(target) {
    currentSheetTarget = target;
    const overlay = document.getElementById('sheetOverlay');
    const sheet = document.getElementById('bottomSheet');
    const searchInput = document.getElementById('sheetSearchInput');
    
    // 繝励Ξ繝ｼ繧ｹ繝帙Ν繝繝ｼ縺ｮ蛻・ｊ譖ｿ縺・
    if (target === 'name') {
        searchInput.placeholder = "豌丞錐繧堤峩謗･蜈･蜉・縺ｾ縺溘・ 讀懃ｴ｢...";
    } else {
        searchInput.placeholder = "驥鷹｡阪・迚ｩ蜩∝錐繧堤峩謗･蜈･蜉・縺ｾ縺溘・ 讀懃ｴ｢...";
    }
    
    searchInput.value = '';
    overlay.classList.add('active');
    sheet.classList.add('active');
    
    // 繧ｿ繝悶ｒ蛻晄悄蛹・
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
            // 譛霑代・螻･豁ｴ縺九ｉ驥崎､・賜髯､縺励※豌丞錐繧呈歓蜃ｺ
            sourceData = [...new Set(dbRecords.map(r => r.name))];
        } else {
            // 繧ｯ繝ｩ繧ｦ繝峨∪縺溘・讀懃ｴ｢譎ゅ・蜈ｨ繧ｯ繝ｩ繧ｦ繝峨ョ繝ｼ繧ｿ
            sourceData = suggestData.names || [];
            isCloud = true;
            // 讀懃ｴ｢譎ゅ・繝ｭ繝ｼ繧ｫ繝ｫ螻･豁ｴ繧ゅ・繝ｼ繧ｸ縺励※讀懃ｴ｢蟇ｾ雎｡縺ｫ縺吶ｋ
            if (query) {
                const localNames = dbRecords.map(r => r.name);
                sourceData = [...new Set([...sourceData, ...localNames])];
            }
        }
    } else {
        if (currentSheetTab === 'recent' && !query) {
            // 譛霑代・螻･豁ｴ縺九ｉ驥鷹｡・迚ｩ蜩√ｒ謚ｽ蜃ｺ
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
        
        // 讀懃ｴ｢邨先棡縺ｫ螳悟・荳閾ｴ縺後≠繧句ｴ蜷医・譁ｰ隕上・繧ｿ繝ｳ繧帝國縺・
        const exactMatch = filtered.some(item => item.toLowerCase() === query);
        const btnConfirm = document.getElementById('btnConfirmNew');
        if (exactMatch) {
            btnConfirm.classList.remove('show');
        }
    }
    
    if (filtered.length === 0) {
        content.innerHTML = '<div class="empty-message">隧ｲ蠖薙☆繧句呵｣懊′縺ゅｊ縺ｾ縺帙ｓ縲・br>荳翫・蜈･蜉帶ｬ・↓縺昴・縺ｾ縺ｾ蜈･蜉帙＠縺ｦ豎ｺ螳壹・繧ｿ繝ｳ繧呈款縺励※縺上□縺輔＞縲・/div>';
        return;
    }
    
    // 荳企剞30莉ｶ遞句ｺｦ縺ｫ縺吶ｋ
    filtered.slice(0, 30).forEach(item => {
        const div = document.createElement('div');
        div.className = 'list-item';
        div.innerHTML = `
            <span>${escapeHTML(item)}</span>
            <span class="list-item-sub">${isCloud ? '繧ｯ繝ｩ繧ｦ繝・ : '螻･豁ｴ'}</span>
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

// ==========================================
// 荳諡ｬ蜊ｰ蛻ｷ讖溯・
// ==========================================

// 荳諡ｬ驕ｸ謚・隗｣髯､
function toggleSelectAll(checked) {
    document.querySelectorAll('.record-checkbox').forEach(cb => cb.checked = checked);
    updateBatchCount();
}

// 驕ｸ謚樔ｻｶ謨ｰ縺ｮ譖ｴ譁ｰ
function updateBatchCount() {
    const count = document.querySelectorAll('.record-checkbox:checked').length;
    const btn = document.getElementById('btnBatchPrint');
    const countSpan = document.getElementById('batchCount');
    if (countSpan) countSpan.textContent = count;
    if (btn) btn.style.display = count > 0 ? 'inline-flex' : 'none';
}

// 荳諡ｬ蜊ｰ蛻ｷ
async function batchPrint() {
    const checkedBoxes = document.querySelectorAll('.record-checkbox:checked');
    const selectedIds = Array.from(checkedBoxes).map(cb => cb.value);
    
    if (selectedIds.length === 0) {
        showToast('蜊ｰ蛻ｷ縺吶ｋ繝ｬ繧ｳ繝ｼ繝峨ｒ驕ｸ謚槭＠縺ｦ縺上□縺輔＞', 'error');
        return;
    }
    
    showStatus(`荳諡ｬ蜊ｰ蛻ｷ: ${selectedIds.length}莉ｶ縺ｮPDF繧堤函謌蝉ｸｭ...`, true);
    
    // 迴ｾ蝨ｨ縺ｮ繝輔か繝ｼ繝迥ｶ諷九ｒ菫晏ｭ・
    const origTemplate = currentTemplate;
    const origName = document.getElementById('nameInput').value;
    const origAmount = document.getElementById('amountInput').value;
    const origSelect = document.getElementById('amountSelect') ? document.getElementById('amountSelect').value : '荳';
    
    try {
        const mergedPdf = await PDFLib.PDFDocument.create();
        
        for (let i = 0; i < selectedIds.length; i++) {
            const record = dbRecords.find(r => r.id === selectedIds[i]);
            if (!record) continue;
            
            showStatus(`荳諡ｬ蜊ｰ蛻ｷ: ${i + 1}/${selectedIds.length} 莉ｶ逶ｮ繧貞・逅・ｸｭ...`, true);
            
            // 繝ｬ繧ｳ繝ｼ繝峨・繝・Φ繝励Ξ繝ｼ繝医↓蛻・ｊ譖ｿ縺茨ｼ・I縺ｯ譖ｴ譁ｰ縺帙★縺ｫ蜀・Κ蛟､縺ｮ縺ｿ螟画峩・・
            currentTemplate = record.template;
            
            // 繝輔か繝ｼ繝蛟､繧剃ｸ譎ら噪縺ｫ險ｭ螳・
            document.getElementById('nameInput').value = record.name;
            
            // 驥鷹｡阪ｒ繝代・繧ｹ
            if (record.template === '10000en' || record.template === '1000en') {
                let val = record.amount;
                if (val.startsWith('驥・)) val = val.substring(1);
                if (val.endsWith('關ｬ蝨謎ｹ・)) val = val.substring(0, val.length - 3);
                else if (val.endsWith('髦｡蝨謎ｹ・)) val = val.substring(0, val.length - 3);
                const amountSelect = document.getElementById('amountSelect');
                if (amountSelect) amountSelect.value = val;
                document.getElementById('amountInput').value = val;
            } else {
                document.getElementById('amountInput').value = record.amount;
            }
            
            // PDF逕滓・
            const pdfBlob = await generatePDF(true);
            if (pdfBlob) {
                const pdfBytes = await pdfBlob.arrayBuffer();
                const srcDoc = await PDFLib.PDFDocument.load(pdfBytes);
                const copiedPages = await mergedPdf.copyPages(srcDoc, srcDoc.getPageIndices());
                copiedPages.forEach(page => mergedPdf.addPage(page));
            }
        }
        
        // 繝輔か繝ｼ繝縺ｮ迥ｶ諷九ｒ蜈・↓謌ｻ縺・
        currentTemplate = origTemplate;
        document.getElementById('nameInput').value = origName;
        document.getElementById('amountInput').value = origAmount;
        const amountSelectRestore = document.getElementById('amountSelect');
        if (amountSelectRestore) amountSelectRestore.value = origSelect;
        
        if (mergedPdf.getPageCount() === 0) {
            showToast('PDF縺ｮ逕滓・縺ｫ螟ｱ謨励＠縺ｾ縺励◆', 'error');
            showStatus('貅門ｙ螳御ｺ・, false);
            return;
        }
        
        const mergedBytes = await mergedPdf.save();
        const blob = new Blob([mergedBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        
        // 蜊ｰ蛻ｷ or 繝繧ｦ繝ｳ繝ｭ繝ｼ繝・
        const newWindow = window.open(url, '_blank');
        if (newWindow) {
            newWindow.onload = () => newWindow.print();
            showToast(`${selectedIds.length}莉ｶ縺ｮPDF繧剃ｸ諡ｬ蜊ｰ蛻ｷ縺励∪縺兪);
        } else {
            const link = document.createElement('a');
            link.href = url;
            link.download = `螂臥ｴ阪ン繝ｩ荳諡ｬ_${selectedIds.length}莉ｶ_${new Date().toISOString().slice(0,10)}.pdf`;
            link.click();
            showToast(`${selectedIds.length}莉ｶ縺ｮPDF繧偵ム繧ｦ繝ｳ繝ｭ繝ｼ繝峨＠縺ｾ縺励◆`);
        }
        
        showStatus('荳諡ｬ蜊ｰ蛻ｷ螳御ｺ・, false);
        
        // 繝・Φ繝励Ξ繝ｼ繝・I繧貞・縺ｫ謌ｻ縺・
        selectTemplate(currentTemplate);
        
    } catch (e) {
        console.error('荳諡ｬ蜊ｰ蛻ｷ繧ｨ繝ｩ繝ｼ:', e);
        showToast('荳諡ｬ蜊ｰ蛻ｷ縺ｫ螟ｱ謨励＠縺ｾ縺励◆: ' + e.message, 'error');
        showStatus('貅門ｙ螳御ｺ・, false);
        
        // 繧ｨ繝ｩ繝ｼ譎ゅｂ繝輔か繝ｼ繝縺ｮ迥ｶ諷九ｒ蜈・↓謌ｻ縺・
        currentTemplate = origTemplate;
        document.getElementById('nameInput').value = origName;
        document.getElementById('amountInput').value = origAmount;
        const amountSelectErr = document.getElementById('amountSelect');
        if (amountSelectErr) amountSelectErr.value = origSelect;
    }
}


function updateDirectValue(param, value) {
    const targetRadios = document.getElementsByName("dpadTarget");
    let targetKey = "name";
    for (let i = 0; i < targetRadios.length; i++) {
        if (targetRadios[i].checked) { targetKey = targetRadios[i].value; break; }
    }
    const settings = designSettings[currentTemplate];
    if (settings && settings[targetKey]) {
        let parsed = parseFloat(value);
        if (!isNaN(parsed)) {
            settings[targetKey][param] = parsed;
            saveDesignSettings();
            triggerAutoUpdate();
        }
    }
}
