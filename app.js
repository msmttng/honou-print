// ==========================================
// アプリ内エラーログ収集モジュール（最優先読み込み）
// ==========================================
window.__appLogList = [];

function addAppLog(type, message, stack = "") {
    const now = new Date();
    const timeStr = now.toTimeString().split(" ")[0] + "." + String(now.getMilliseconds()).padStart(3, "0");
    const entry = {
        time: timeStr,
        type: type, // 'error', 'warn', 'uncaught'
        message: String(message || ""),
        stack: String(stack || "")
    };
    window.__appLogList.unshift(entry); // 新しい順
    if (window.__appLogList.length > 200) {
        window.__appLogList.pop();
    }
    updateLogBadgeUI();
}

function updateLogBadgeUI() {
    const badge = document.getElementById("logBadge");
    if (badge) {
        const errCount = window.__appLogList.filter(l => l.type === "error" || l.type === "uncaught").length;
        badge.textContent = errCount;
        if (errCount > 0) {
            badge.style.background = "#ef4444";
            badge.style.color = "#ffffff";
        } else {
            badge.style.background = "#94a3b8";
            badge.style.color = "#ffffff";
        }
    }
}

// グローバルエラーキャッチ
window.addEventListener("error", function (e) {
    const stack = e.error && e.error.stack ? e.error.stack : "";
    addAppLog("uncaught", e.message || "Uncaught Error", stack);
});

window.addEventListener("unhandledrejection", function (e) {
    const reason = e.reason;
    const msg = reason && reason.message ? reason.message : String(reason);
    const stack = reason && reason.stack ? reason.stack : "";
    addAppLog("uncaught", "Unhandled Promise Rejection: " + msg, stack);
});

// console.error / console.warn のラップ
(function () {
    const origError = console.error;
    const origWarn = console.warn;

    console.error = function (...args) {
        origError.apply(console, args);
        const msg = args.map(a => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
        const errObj = args.find(a => a instanceof Error);
        const stack = errObj && errObj.stack ? errObj.stack : new Error().stack || "";
        addAppLog("error", msg, stack);
    };

    console.warn = function (...args) {
        origWarn.apply(console, args);
        const msg = args.map(a => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
        addAppLog("warn", msg, "");
    };
})();

// モーダル操作関数
function openLogModal() {
    renderLogList();
    const modal = document.getElementById("logModal");
    if (modal) modal.style.display = "flex";
}

function closeLogModal() {
    const modal = document.getElementById("logModal");
    if (modal) modal.style.display = "none";
}

function renderLogList() {
    const container = document.getElementById("logListContainer");
    if (!container) return;
    
    if (!window.__appLogList || window.__appLogList.length === 0) {
        container.innerHTML = `<div style="text-align: center; color: #94a3b8; padding: 20px;">ログはありません</div>`;
        return;
    }

    let html = "";
    window.__appLogList.forEach((log) => {
        const isErr = log.type === "error" || log.type === "uncaught";
        const color = isErr ? "#ef4444" : "#f59e0b";
        const bg = isErr ? "#fef2f2" : "#fffbe6";
        html += `
            <div style="background: ${bg}; border-left: 4px solid ${color}; padding: 8px; border-radius: 4px; font-family: monospace; font-size: 11px; margin-bottom: 8px; word-break: break-all;">
                <div style="font-weight: bold; color: ${color}; display: flex; justify-content: space-between;">
                    <span>[${log.type.toUpperCase()}] ${log.time}</span>
                </div>
                <div style="margin-top: 4px; color: #1e293b; white-space: pre-wrap;">${escapeHTML(log.message)}</div>
                ${log.stack ? `<div style="margin-top: 4px; color: #64748b; font-size: 10px; white-space: pre-wrap; background: rgba(0,0,0,0.03); padding: 4px; border-radius: 2px;">${escapeHTML(log.stack)}</div>` : ''}
            </div>
        `;
    });
    container.innerHTML = html;
}

function copyAppLogs() {
    if (!window.__appLogList || window.__appLogList.length === 0) {
        showToast("コピーするログがありません");
        return;
    }
    const text = window.__appLogList.map(l => `[${l.time}] [${l.type.toUpperCase()}]\n${l.message}\n${l.stack ? l.stack + '\n' : ''}`).join("\n-------------------\n");
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            showToast("ログをクリップボードにコピーしました");
        }).catch(() => {
            fallbackCopy(text);
        });
    } else {
        fallbackCopy(text);
    }
}

function fallbackCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    showToast("ログをコピーしました");
}

function clearAppLogs() {
    window.__appLogList = [];
    renderLogList();
    updateLogBadgeUI();
    showToast("ログをクリアしました");
}

// --- Service Worker 登録（PWA対応） ---
let gasCodeCache = null;
let swUpdatePrompted = false;
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(reg => {
      console.log('Service Worker registered:', reg.scope);
      setupServiceWorkerUpdateFlow(reg);
    }).catch(err => {
      console.warn('Service Worker registration failed:', err);
    });

    // 「GASコードをコピー」ボタンでの同期clipboard呼び出しに間に合わせるため、
    // ここで非同期プリフェッチしてキャッシュしておく（クリックハンドラをawaitで待たせない）
    fetch("./gas_script.js?v=" + APP_VERSION)
      .then(r => r.ok ? r.text() : null)
      .then(t => { gasCodeCache = t; })
      .catch(() => {});
  });

  // 新SWがactivateしてcontrollerが切り替わったらリロード（ガード必須。無いとリロードループになる）
  // hadController はリスナー登録前（＝このタイミング）で評価すること。
  // 未登録端末の初回インストールでは誰もSKIP_WAITINGを押していなくても
  // install→activate→clients.claim()でcontrollerchangeが発火するため、
  // 「元々controllerが居たか」を見ないと初回セットアップ中に強制リロードされてしまう。
  let reloading = false;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });
}

// SWの更新検知・通知フロー（前回訪問時からの待機中 / 新規発見 / 定期チェック）
function setupServiceWorkerUpdateFlow(reg) {
    if (reg.waiting) promptSwUpdate(reg);

    reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) promptSwUpdate(reg);
        });
    });

    setInterval(() => reg.update(), 30 * 60 * 1000);
}

// 更新通知トーストを表示（多重表示防止のガード付き。印刷作業中に見逃さないよう自動消滅させない）
function promptSwUpdate(reg) {
    if (swUpdatePrompted) return;
    swUpdatePrompted = true;
    showToastWithAction("新しいバージョンがあります", "再読み込み", () => {
        if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    }, 0);
}

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
    pdfjsLib.GlobalWorkerOptions.workerSrc = './lib/pdf.worker.min.js';
}

// --- 定数・グローバル変数 ---
const FONT_URL = "hgs_gyoshotai.ttf"; // HGS行書体（TTCから抽出したTTF形式）を使用
const APP_VERSION = "84"; // index.html の <script src="app.js?v=XX"> と同期させること
// 注: templates_config.json が実行時設定の正本。取得失敗時のみ app.js の getFallbackConfig() にフォールバックする。

let currentTemplate = "10000en";
let templatePageSizes = {};    // テンプレートPDF原本のページサイズキャッシュ {tmpl: {w, h}} (pt)
let previewRenderGen = 0;      // プレビューのレースコンディション防止用 世代カウンタ
let editingRecordId = null;    // 現在編集中のレコードID
let config = null;             // テンプレートごとの初期座標・フォントサイズ設定
let designSettings = {};       // ユーザー調整後の座標・フォントサイズ (LocalStorage保存用)
let paperSizeSettings = { width: 105, height: 390 }; // 用紙サイズ設定 (mm, 全テンプレート共通)
let loadedFontBytes = null;    // キャッシュされたフォントデータのArrayBuffer
let loadedTemplateBytes = {};  // キャッシュされたテンプレートPDFのArrayBuffer
let dbRecords = [];            // 名簿レコード一覧 (LocalStorage保存用)
let autoUpdateTimer = null;    // リアルタイムプレビュー用デバウンスタイマー
let isAppReady = false;        // アプリケーション（DB等）の初期化完了フラグ

// --- v52 UI/UX 全面改善 用 グローバル状態 ---
let currentSortField = "date";     // ソート列 ('date', 'bag', 'name', 'amount')
let currentSortOrder = "desc";     // ソート順 ('desc' | 'asc', デフォルトは日時の新しい順)
let dbSearchQuery = "";            // リアルタイム検索クエリ
let currentFilterChip = "all";     // 絞り込みチップ ('all', '3000', '5000', '10000', 'other_money', 'item', 'empty')
let recordsDisplayLimit = 50;      // 初期表示件数 (50件ずつさらに表示)
let lastClearedFormData = null;    // クリア前のフォームデータ退避
let isPdfGenerating = false;       // PDF生成中ガード
let pendingPdfUpdate = false;      // PDF生成後追い要求
let duplicatePendingAction = null; // 重複確認モーダルのコールバック

// --- 住所・郵便番号自動補完辞書 (町名の長い順 ZIP_DICT) ---
const ZIP_DICT = [
  ["羽田旭町", "144-0042", "東京都大田区"],
  ["羽田空港", "144-0041", "東京都大田区"],
  ["蒲田本町", "144-0053", "東京都大田区"],
  ["大森本町", "143-0011", "東京都大田区"],
  ["大森東", "143-0012", "東京都大田区"],
  ["大森中", "143-0014", "東京都大田区"],
  ["大森西", "143-0015", "東京都大田区"],
  ["大森南", "143-0013", "東京都大田区"],
  ["大森北", "143-0016", "東京都大田区"],
  ["東糀谷", "144-0033", "東京都大田区"],
  ["西糀谷", "144-0034", "東京都大田区"],
  ["新蒲田", "144-0054", "東京都大田区"],
  ["東蒲田", "144-0031", "東京都大田区"],
  ["西蒲田", "144-0051", "東京都大田区"],
  ["南蒲田", "144-0035", "東京都大田区"],
  ["東矢口", "146-0094", "東京都大田区"],
  ["本羽田", "144-0044", "東京都大田区"],
  ["羽田", "144-0043", "東京都大田区"],
  ["萩中", "144-0047", "東京都大田区"],
  ["蒲田", "144-0052", "東京都大田区"],
  ["矢口", "146-0093", "東京都大田区"],
  ["池上", "146-0082", "東京都大田区"],
  ["久が原", "146-0085", "東京都大田区"],
  ["雪谷大塚町", "145-0067", "東京都大田区"],
  ["田園調布", "145-0071", "東京都大田区"],
  ["南千束", "145-0062", "東京都大田区"],
  ["北千束", "145-0063", "東京都大田区"],
  ["石川町", "145-0061", "東京都大田区"],
  ["中央", "143-0024", "東京都大田区"],
  ["山王", "143-0023", "東京都大田区"],
  ["鋼管通", "210-0852", "神奈川県川崎市川崎区"],
  ["富士見", "210-0011", "神奈川県川崎市川崎区"],
  ["中瀬", "210-0818", "神奈川県川崎市川崎区"],
  ["追分町", "210-0835", "神奈川県川崎市川崎区"],
  ["伊勢町", "210-0805", "神奈川県川崎市川崎区"],
  ["殿町", "210-0821", "神奈川県川崎市川崎区"],
  ["大師本町", "210-0816", "神奈川県川崎市川崎区"],
  ["川崎区", "210-0851", "神奈川県川崎市川崎区"]
];

let lastNormalizedAddress = "";
let addressDebounceTimer = null;

function normalizeAddress(v) {
    if (!v) return "";
    let s = String(v).normalize("NFKC").trim();
    s = s.replace(/[－ー―\u2010-\u2015\u2212\uFF0D]/g, "-");

    // 仕様2: /^〒?\d{3}-?\d{4}/ で始まる場合
    const zipMatch = s.match(/^〒?\s*(\d{3})-?(\d{4})(.*)/);
    if (zipMatch) {
        const z1 = zipMatch[1];
        const z2 = zipMatch[2];
        const fullZip = `${z1}-${z2}`;
        let rest = zipMatch[3].trim().replace(/^[-_\s]+/, "");

        const matchItem = ZIP_DICT.find(item => item[1] === fullZip);
        if (matchItem) {
            const [town, zip, prefCity] = matchItem;
            if (!rest) {
                return `〒${fullZip} ${prefCity}${town}`;
            } else {
                if (rest.startsWith(prefCity + town)) {
                    return `〒${fullZip} ${rest}`;
                } else if (rest.startsWith(town)) {
                    return `〒${fullZip} ${prefCity}${rest}`;
                } else {
                    if (!rest.includes(prefCity)) {
                        if (!rest.includes(town)) {
                            return `〒${fullZip} ${prefCity}${town}${rest}`;
                        } else {
                            return `〒${fullZip} ${prefCity}${rest}`;
                        }
                    }
                    return `〒${fullZip} ${rest}`;
                }
            }
        }
        return `〒${fullZip} ${rest}`.trim();
    }

    // 仕様3: それ以外の場合、ZIP_DICTを町名の長い順に走査
    for (const item of ZIP_DICT) {
        const [town, zip, prefCity] = item;
        const pos = s.indexOf(town);
        if (pos !== -1) {
            const before = s.substring(0, pos);
            const isMatchCondition = (
                before === "" ||
                before === prefCity ||
                before === "東京都" ||
                before === "東京都大田区" ||
                before === "神奈川県" ||
                before === "神奈川県川崎市" ||
                before === "神奈川県川崎市川崎区"
            );

            if (isMatchCondition) {
                const restAddress = s.substring(pos);
                return `〒${zip} ${prefCity}${restAddress}`;
            }
        }
    }

    // 仕様4: 一致しなければ変化させない
    return s;
}

function handleAddressInput() {
    if (addressDebounceTimer) clearTimeout(addressDebounceTimer);
    addressDebounceTimer = setTimeout(() => {
        applyAddressNormalization();
    }, 500);
}

function applyAddressNormalization() {
    const el = document.getElementById("addressInput");
    if (!el) return;
    const currentVal = el.value;
    if (!currentVal.trim()) return;

    const normalized = normalizeAddress(currentVal);
    if (normalized && normalized !== currentVal && normalized !== lastNormalizedAddress) {
        lastNormalizedAddress = normalized;
        el.value = normalized;
        showZipNotice();
        triggerAutoUpdate();
    }
}

function showZipNotice() {
    const notice = document.getElementById("zipNotice");
    if (notice) {
        notice.style.display = "block";
        setTimeout(() => {
            notice.style.display = "none";
        }, 2000);
    }
}

// --- 組文字 (㈱ ㈲ ㍿ ℡ 等) 展開変換関数 ---
function expandCompatChars(s) {
    if (!s) return s;
    const MAP = {
        "㈱":"(株)", "㈲":"(有)", "㈳":"(社)", "㈶":"(財)", "㈴":"(名)",
        "㈾":"(資)", "㈿":"(協)", "㍿":"株式会社",
        "℡":"TEL", "㊑":"(有)", "㊒":"(株)"
    };
    return String(s).replace(/[㈱㈲㈳㈶㈴㈾㈿㍿℡㊑㊒]/g, ch => MAP[ch] || ch);
}

// フォント未収録文字の検出・警告ログ
function checkGlyphAvailability(font, text) {
    if (!font || !text) return;
    for (const ch of Array.from(text)) {
        try {
            if (font.getGlyphWidth) {
                const w = font.getGlyphWidth(ch);
                if (w === 0 && ch !== " " && ch !== "　") {
                    console.warn(`Font glyph missing for char: '${ch}' (U+${ch.charCodeAt(0).toString(16).toUpperCase()})`);
                }
            }
        } catch (e) {
            console.warn(`Font glyph check failed for char: '${ch}' (U+${ch.charCodeAt(0).toString(16).toUpperCase()})`, e);
        }
    }
}

// かな正規化 (ひらがな⇄カタカナ部分一致)
function kanaNormalize(str) {
    if (!str) return "";
    let s = String(str).normalize("NFKC").toLowerCase();
    s = s.replace(/[\u3041-\u3096]/g, function(m) {
        return String.fromCharCode(m.charCodeAt(0) + 0x60);
    });
    return s;
}

// アクションボタン付きカスタムトースト
// duration=0（常駐表示）のトーストは、後から別のトーストに上書きされて消えても
// 「二度と表示されない」状態にならないよう、上書きしたトーストが消えた時点で復元する。
let pendingPersistentToastRestore = null;
function showToastWithAction(message, actionLabel, actionCallback, duration = 5000) {
    const existing = document.getElementById("customToast");
    if (existing) {
        // これから作る新しいトーストが、既存の常駐トーストとは別物の場合のみ復元予約する
        // （同一の常駐トースト自身を作り直すケース＝復元処理そのものでは予約しない）
        if (existing._persistentRestore && duration > 0) {
            pendingPersistentToastRestore = existing._persistentRestore;
        }
        existing.remove();
    }

    const toast = document.createElement("div");
    toast.id = "customToast";
    toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(15, 23, 42, 0.92);
        backdrop-filter: blur(8px);
        color: #ffffff;
        padding: 12px 22px;
        border-radius: 30px;
        font-size: 14px;
        font-weight: 600;
        z-index: 20000;
        box-shadow: 0 10px 25px rgba(0,0,0,0.25);
        display: flex;
        align-items: center;
        gap: 12px;
        transition: opacity 0.3s, transform 0.3s;
    `;

    const msgSpan = document.createElement("span");
    msgSpan.textContent = message;
    toast.appendChild(msgSpan);

    // このトースト自身が常駐（duration=0）の場合、自分を復元する関数を持たせておく
    // （他のトーストに上書きされた際、そのトーストの表示が終わったら再表示できるようにする）
    if (duration === 0) {
        toast._persistentRestore = () => showToastWithAction(message, actionLabel, actionCallback, duration);
    }

    // このトーストの表示が終わった後、上書きしてしまった常駐トーストがあれば復元する
    const restorePendingPersistentToast = () => {
        if (pendingPersistentToastRestore) {
            const restore = pendingPersistentToastRestore;
            pendingPersistentToastRestore = null;
            restore();
        }
    };

    if (actionLabel && actionCallback) {
        const btn = document.createElement("button");
        btn.className = "toast-action-btn";
        btn.textContent = actionLabel;
        btn.onclick = () => {
            toast.remove();
            if (duration > 0) restorePendingPersistentToast();
            actionCallback();
        };
        toast.appendChild(btn);
    }

    document.body.appendChild(toast);

    if (duration > 0) {
        setTimeout(() => {
            if (toast.parentNode) {
                toast.style.opacity = "0";
                toast.style.transform = "translateX(-50%) translateY(10px)";
                setTimeout(() => { toast.remove(); restorePendingPersistentToast(); }, 300);
            }
        }, duration);
    }
}

// 「金額集計に含めない」スタイル更新
function updateEmptyCheckStyle() {
    const chk = document.getElementById("emptyCheck");
    const wrap = document.getElementById("emptyCheckWrap");
    if (chk && wrap) {
        if (chk.checked) {
            wrap.classList.add("highlight");
        } else {
            wrap.classList.remove("highlight");
        }
    }
}

// 非破壊的フォームクリア
function clearFormNonDestructive() {
    lastClearedFormData = {
        name: document.getElementById("nameInput") ? document.getElementById("nameInput").value : "",
        bagNo: document.getElementById("bagNoInput") ? document.getElementById("bagNoInput").value : "",
        address: document.getElementById("addressInput") ? document.getElementById("addressInput").value : "",
        kana: document.getElementById("kanaInput") ? document.getElementById("kanaInput").value : "",
        amount: document.getElementById("amountInput") ? document.getElementById("amountInput").value : "",
        honorific: document.getElementById("honorificSelect") ? document.getElementById("honorificSelect").value : "殿",
        emptyCheck: document.getElementById("emptyCheck") ? document.getElementById("emptyCheck").checked : false,
        template: currentTemplate
    };

    clearForm();

    showToastWithAction("入力をクリアしました", "元に戻す", function() {
        if (lastClearedFormData) {
            if (document.getElementById("nameInput")) document.getElementById("nameInput").value = lastClearedFormData.name;
            if (document.getElementById("bagNoInput")) document.getElementById("bagNoInput").value = lastClearedFormData.bagNo;
            if (document.getElementById("addressInput")) document.getElementById("addressInput").value = lastClearedFormData.address;
            if (document.getElementById("kanaInput")) document.getElementById("kanaInput").value = lastClearedFormData.kana;
            if (document.getElementById("amountInput")) document.getElementById("amountInput").value = lastClearedFormData.amount;
            if (document.getElementById("honorificSelect")) document.getElementById("honorificSelect").value = lastClearedFormData.honorific;
            if (document.getElementById("emptyCheck")) {
                document.getElementById("emptyCheck").checked = lastClearedFormData.emptyCheck;
                updateEmptyCheckStyle();
            }
            if (lastClearedFormData.template) selectTemplate(lastClearedFormData.template);
            triggerAutoUpdate();
        }
    });
}

// 奉納袋番号インクリメント & 最大値自動割り振り (E項目)
function getNextBagNo() {
    let maxNo = 0;
    for (const r of dbRecords) {
        const b = parseInt(r.bagNo || r.bag_no || 0, 10);
        if (!isNaN(b) && b > maxNo) {
            maxNo = b;
        }
    }
    return maxNo + 1;
}

function autoSetNextBagNo() {
    const bagInput = document.getElementById("bagNoInput");
    if (bagInput && (!bagInput.value || bagInput.value === "自動")) {
        const nextVal = getNextBagNo();
        if (nextVal > 1) {
            bagInput.value = nextVal;
        }
    }
}

function incrementBagNo() {
    const bagInput = document.getElementById("bagNoInput");
    if (bagInput && bagInput.value) {
        const currentVal = parseInt(bagInput.value, 10);
        if (!isNaN(currentVal)) {
            bagInput.value = currentVal + 1;
        }
    }
}

// レコードID指定削除 (トースト［取り消す］用)
async function deleteRecordById(id) {
    if (!id) return;
    try {
        await idbDeleteRecord(id);
        dbRecords = dbRecords.filter(r => r.id !== id);
        
        if (gasUrl) {
            sendToGAS({ action: "delete", id: id }).catch(e => console.warn("GAS削除同期失敗:", e));
        }

        renderTable();
        updateDashboardStats();
        showToast("名簿登録を取り消しました");
    } catch (e) {
        console.error("レコード削除失敗:", e);
    }
}

// 同日重複登録チェック ＆ モーダル (F項目)
function checkDuplicateToday(name) {
    if (!name) return false;
    const cleanName = name.trim();
    if (!cleanName) return false;

    const todayStr = new Date().toLocaleDateString('ja-JP');
    return dbRecords.some(r => {
        if (!r.name) return false;
        const rName = r.name.trim();
        if (rName !== cleanName) return false;
        const rDate = r.timestamp || r.date || "";
        return rDate.includes(todayStr) || (new Date(rDate).toLocaleDateString('ja-JP') === todayStr);
    });
}

function showDuplicateModal(name, onConfirm) {
    duplicatePendingAction = onConfirm;
    const modal = document.getElementById("duplicateModal");
    const overlay = document.getElementById("duplicateModalOverlay");
    const nameEl = document.getElementById("duplicateModalName");
    if (nameEl) nameEl.textContent = name;
    if (modal && overlay) {
        modal.classList.add("active");
        overlay.classList.add("active");
    }
}

function closeDuplicateModal(isConfirmed) {
    const modal = document.getElementById("duplicateModal");
    const overlay = document.getElementById("duplicateModalOverlay");
    if (modal && overlay) {
        modal.classList.remove("active");
        overlay.classList.remove("active");
    }
    if (duplicatePendingAction) {
        const cb = duplicatePendingAction;
        duplicatePendingAction = null;
        cb(isConfirmed);
    }
}

function confirmDuplicatePrint(isConfirmed) {
    closeDuplicateModal(isConfirmed);
}

// 検索・フィルタ・ソート イベントハンドラ (B項目)
function handleDbSearchInput() {
    const input = document.getElementById("dbSearchInput");
    if (input) {
        dbSearchQuery = input.value.trim();
        recordsDisplayLimit = 50;
        renderTable();
    }
}

function setFilterChip(type) {
    currentFilterChip = type;
    const chips = document.querySelectorAll("#filterChipsContainer .chip");
    chips.forEach(c => {
        if (c.getAttribute("data-chip") === type) {
            c.classList.add("active");
        } else {
            c.classList.remove("active");
        }
    });
    recordsDisplayLimit = 50;
    renderTable();
}

function toggleSort(field) {
    if (currentSortField === field) {
        currentSortOrder = currentSortOrder === "asc" ? "desc" : "asc";
    } else {
        currentSortField = field;
        currentSortOrder = (field === "date" || field === "bag" || field === "amount") ? "desc" : "asc";
    }
    updateSortIcons();
    renderTable();
}

function updateSortIcons() {
    const fields = ["date", "bag", "name", "amount"];
    fields.forEach(f => {
        const iconEl = document.getElementById("sort-icon-" + f);
        if (iconEl) {
            if (currentSortField === f) {
                iconEl.textContent = currentSortOrder === "asc" ? " ▲" : " ▼";
                iconEl.style.color = "#b91c1c";
            } else {
                iconEl.textContent = "";
            }
        }
    });
}

function loadMoreRecords() {
    recordsDisplayLimit += 50;
    renderTable();
}

// --- スプレッドシート連携（GAS） ---
let gasUrl = "https://script.google.com/macros/s/AKfycbxVFWGyZTgPPVDo430RzF3QCjuS7qYHGtjifv_KK6clkVUB0zVHYd5d-k9Gw9nGNcNc/exec"; // GAS ウェブアプリの URL (LocalStorage保存用・デフォルト値あり)
let gasSharedToken = ""; // GAS共有トークン（IndexedDB保存・秘密情報のためlocalStorageは使わない）
let gasAuthBlocked = false; // 認証エラー発生中は同期を止める（トークン修正まで無駄なリクエストを送らない）
let gasSettingsLoaded = false; // loadGasSettings完了フラグ（未ロード中の送信を保留する）
let gasTokenSaveTimer = null; // トークン保存のデバウンス用タイマー
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

// GAS共有トークンの入力時保存（秘密情報のためIndexedDBに保存する。localStorageはDevToolsで一覧されやすいため避ける）
// 1文字ごとの未完成なトークンでpushPendingRecords()を走らせないよう、保存のみをデバウンスして行う。
// 実際の送信再開はcommitGasToken()（onchange＝確定時）でのみ行う。
function saveGasToken() {
    const input = document.getElementById("gasTokenInput");
    if (!input) return;
    const v = input.value.trim();
    if (gasTokenSaveTimer) clearTimeout(gasTokenSaveTimer);
    gasTokenSaveTimer = setTimeout(async () => {
        await idbKvSet("gas_shared_token", v);
        gasSharedToken = v;
    }, 500);
}

// GAS共有トークンの確定時処理（onchange＝blur時や候補選択時）
// ここで初めて認証ブロックを解除し、未送信分の送信を再開する。
async function commitGasToken() {
    const input = document.getElementById("gasTokenInput");
    if (!input) return;
    if (gasTokenSaveTimer) {
        clearTimeout(gasTokenSaveTimer);
        gasTokenSaveTimer = null;
    }
    const v = input.value.trim();
    await idbKvSet("gas_shared_token", v);
    gasSharedToken = v;
    gasAuthBlocked = false; // トークンを直したら未送信分がすぐ流れるようにリセット
    pushPendingRecords();
}

// 起動時のGAS設定とキャッシュの読み込み
async function loadGasSettings() {
    try {
        // GAS URL of recovery
        const savedUrl = localStorage.getItem("pdf_mail_merge_gas_url");
        if (savedUrl) {
            gasUrl = savedUrl;
        }
        const input = document.getElementById("gasUrlInput");
        if (input) input.value = gasUrl;

        // GAS共有トークンの復元（IndexedDBのkvストア）
        gasSharedToken = (await idbKvGet("gas_shared_token")) || "";
        const tokenInput = document.getElementById("gasTokenInput");
        if (tokenInput) tokenInput.value = gasSharedToken;

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

    gasSettingsLoaded = true;

    // GAS URLが設定されていれば、バックグラウンドで同期を実行
    if (gasUrl) {
        syncFromGAS(true).catch(() => {});
    }
}

// 共有トークン入力欄の表示/非表示切り替え
function toggleGasTokenVisibility() {
    const input = document.getElementById("gasTokenInput");
    const btn = document.getElementById("btnToggleGasToken");
    if (!input) return;
    const icon = btn ? btn.querySelector("i") : null;
    if (input.type === "password") {
        input.type = "text";
        if (icon) icon.className = "fa-solid fa-eye-slash";
    } else {
        input.type = "password";
        if (icon) icon.className = "fa-solid fa-eye";
    }
}

// 共有トークンのランダム生成（英大小文字+数字32文字。記号なし＝GAS側への転記トラブル回避）
function generateGasToken() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const arr = new Uint32Array(32);
    crypto.getRandomValues(arr);
    let token = "";
    for (let i = 0; i < arr.length; i++) {
        token += chars[arr[i] % chars.length];
    }
    const input = document.getElementById("gasTokenInput");
    if (input) input.value = token;
    commitGasToken();
    showToast("GASのスクリプトプロパティ SHARED_TOKEN にも同じ値を設定してください");
}

// --- IndexedDB ストレージ管理 ---
const DB_NAME = "PdfMailMergeDB";
const DB_VERSION = 2;
const STORE_FILES = "files";
const STORE_RECORDS = "records";  // 名簿レコード（Outbox兼用）
const STORE_KV = "kv";            // サジェストキャッシュ・墓標・メタ情報

async function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_FILES)) {
                db.createObjectStore(STORE_FILES);
            }
            if (!db.objectStoreNames.contains(STORE_RECORDS)) {
                const s = db.createObjectStore(STORE_RECORDS, { keyPath: "id" });
                s.createIndex("sync", "sync");
                s.createIndex("date", "date");
            }
            if (!db.objectStoreNames.contains(STORE_KV)) {
                db.createObjectStore(STORE_KV);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function idbPutRecord(record) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_RECORDS, "readwrite");
        tx.objectStore(STORE_RECORDS).put(record);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
}

async function idbDeleteRecord(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_RECORDS, "readwrite");
        tx.objectStore(STORE_RECORDS).delete(id);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
}

async function idbGetAllRecords() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const req = db.transaction(STORE_RECORDS, "readonly").objectStore(STORE_RECORDS).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

async function idbGetPendingRecords() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const req = db.transaction(STORE_RECORDS, "readonly").objectStore(STORE_RECORDS).index("sync").getAll("pending");
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

// 削除待ち（墓標）レコードの取得: オフライン削除をオンライン復帰時にクラウドへ伝搬するため
async function idbGetPendingDeletes() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const req = db.transaction(STORE_RECORDS, "readonly").objectStore(STORE_RECORDS).index("sync").getAll("pending_delete");
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

// 全レコードの削除（フル復元時の完全リフレッシュ用）
async function idbClearAllRecords() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_RECORDS, "readwrite");
        tx.objectStore(STORE_RECORDS).clear();
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
}

async function idbKvGet(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const req = db.transaction(STORE_KV, "readonly").objectStore(STORE_KV).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function idbKvSet(key, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_KV, "readwrite");
        tx.objectStore(STORE_KV).put(value, key);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
}

async function saveFileToDB(key, arrayBuffer) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_FILES, "readwrite");
        const store = tx.objectStore(STORE_FILES);
        store.put(arrayBuffer, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function getFileFromDB(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_FILES, "readonly");
        const store = tx.objectStore(STORE_FILES);
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

async function requestPersistentStorage() {
    if (navigator.storage && navigator.storage.persist) {
        const granted = await navigator.storage.persist();
        console.log("永続ストレージ:", granted ? "許可" : "未許可");
        const stEl = document.getElementById("storageStatus");
        if (stEl) stEl.textContent = "永続ストレージ: " + (granted ? "許可済み" : "未許可（ホーム画面に追加を推奨）");
    }
}

async function migrateFromLocalStorage() {
    if (await idbKvGet("migrated_v2")) return;
    try {
        // 名簿: 既存レコードは「同期済み扱い」で取り込む（過去分の再送を防ぐ）
        const oldDb = JSON.parse(localStorage.getItem("pdf_mail_merge_db") || "[]");
        for (const r of oldDb) {
            r.sync = r.sync || "synced";
            await idbPutRecord(r);
        }
        // 旧オフラインキュー: 中身は未送信なので pending レコード化
        const oldQueue = JSON.parse(localStorage.getItem("pdf_mail_merge_offline_queue") || "[]");
        for (const q of oldQueue) {
            const p = q.payload || {};
            await idbPutRecord({
                id: "rec_mig_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
                date: q.queuedAt || new Date().toISOString(),
                template: p.templateType === "萬圓用" ? "10000en"
                        : p.templateType === "阡圓用" ? "1000en" : "free",
                name: p.name || "",
                amount: p.amount || "",
                sync: "pending"
            });
        }
        // サジェストのクラウドキャッシュ
        const oldSuggests = localStorage.getItem("pdf_mail_merge_suggests");
        if (oldSuggests) await idbKvSet("cloud_suggests", JSON.parse(oldSuggests));

        await idbKvSet("migrated_v2", true);
        localStorage.removeItem("pdf_mail_merge_db");
        localStorage.removeItem("pdf_mail_merge_offline_queue");
    } catch (e) {
        console.error("移行エラー:", e);
    }
}

window.addEventListener("DOMContentLoaded", async () => {
    // file:// プロトコルの警告は起動用ブラウザ（--allow-file-access-from-files）を使用することで回避するため削除

    showStatus("システム初期化中...", true);

    // 同期ステータス表示の初期化（相対時刻表示が固まらないよう定期更新もする）
    renderSyncStatus();
    setInterval(renderSyncStatus, 60000);

    // 0. 永続ストレージの要求とマイグレーション
    await requestPersistentStorage();
    await migrateFromLocalStorage();
    
    // 1. デザイン設定および名簿DBの復元
    // （loadDbRecordsは非同期。awaitしないと空の名簿でrenderTableされてしまう）
    loadDesignSettings();

    // 集計期間の選択状態を復元（renderTable内のupdateDashboardStatsより先に反映させる）
    const savedStatsPeriod = localStorage.getItem("pdf_mail_merge_stats_period");
    if (savedStatsPeriod) statsPeriod = savedStatsPeriod;
    const customWrap = document.getElementById("statsCustomRange");
    if (customWrap) customWrap.style.display = (statsPeriod === "custom") ? "flex" : "none";
    document.querySelectorAll(".stats-period-btn").forEach(btn => {
        btn.classList.toggle("active", btn.id === "statsPeriod" + statsPeriod.charAt(0).toUpperCase() + statsPeriod.slice(1));
    });

    await loadDbRecords();
    renderTable();
    setDefaultBagNo(true);

    // 拡張設定（用紙サイズ・連番・領収書）の初期化
    const savedPreset = localStorage.getItem("pdf_mail_merge_paper_preset") || "tanzaku";
    const presetSelect = document.getElementById("paperPresetSelect");
    if (presetSelect) presetSelect.value = savedPreset;
    onPaperPresetChange(savedPreset);

    const savedAutoBag = localStorage.getItem("pdf_mail_merge_auto_bag_toggle");
    const bagToggle = document.getElementById("autoBagNoToggle");
    if (bagToggle) bagToggle.checked = savedAutoBag !== "false";
    toggleAutoBagNo();

    const savedIssuer = localStorage.getItem("pdf_mail_merge_receipt_issuer") || "";
    const issuerInput = document.getElementById("receiptIssuerInput");
    if (issuerInput) issuerInput.value = savedIssuer;

    const savedIssuerAddress = localStorage.getItem("pdf_mail_merge_receipt_issuer_address") || "";
    const issuerAddressInput = document.getElementById("receiptIssuerAddressInput");
    if (issuerAddressInput) issuerAddressInput.value = savedIssuerAddress;

    loadReceiptPaperSettings();

    // 2. 設定ファイルの読み込み (templates_config.json が正本。失敗時はフォールバック)
    config = await loadTemplatesConfig();

    // 3. バージョンチェックによるLocalStorageキャッシュクリア (新設定強制適用)
    const currentVersion = config.config_version || 1;
    try {
        const savedVersion = localStorage.getItem("pdf_mail_merge_config_version");
        if (savedVersion !== String(currentVersion)) {
            console.log(`設定バージョンが更新されました (${savedVersion} -> ${currentVersion})。キャッシュをリセットします。`);
            localStorage.removeItem("pdf_mail_merge_design_settings");
            localStorage.setItem("pdf_mail_merge_config_version", currentVersion);
            designSettings = {}; // キャッシュをクリア
            // IndexedDBのキャッシュも削除（フォント・PDF変更に対応）
            try {
                const db = await openDB();
                const tx = db.transaction(STORE_FILES, "readwrite");
                tx.objectStore(STORE_FILES).delete("font_yuji");
                tx.objectStore(STORE_FILES).delete("pdf_10000en");
                tx.objectStore(STORE_FILES).delete("pdf_1000en");
                tx.objectStore(STORE_FILES).delete("pdf_free");
                await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; });
                console.log("IndexedDBのキャッシュを削除しました。新しいファイルを再ダウンロードします。");
            } catch (dbErr) {
                console.warn("IndexedDBキャッシュ削除エラー:", dbErr);
            }
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
    // トークンがIndexedDBから入るまでの間にvisibilitychangeでpushPendingRecords()が走ると
    // gasSharedToken===""のまま送信されてunauthorizedになりgasAuthBlockedが立ってしまうため、
    // 完了を待ってから後続処理を進める。
    await loadGasSettings();

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
            placeholder.innerHTML = '<i class="fa-solid fa-cloud-arrow-down fa-bounce"></i><p>初期ファイルをダウンロードしています...<br>少々お待ちください</p><p style="font-size:11px;opacity:0.7">（初回のみ5MB程度の通信が発生します）</p>';
        }
        try {
            // 初回DLは合計5MB前後あり、通信が不安定だと1回の失敗で
            // 手動セットアップ画面に落ちてしまう。指数バックオフで3回まで再試行する。
            const fetchFile = async (url, key, attempt = 0) => {
                const MAX_ATTEMPTS = 3;
                // fetch はネットワークが不安定なとき「失敗」せず無応答のまま止まることがある。
                // タイムアウトを付けないと「初回セットアップ中...」から永久に進まなくなるため、
                // AbortController で必ず打ち切って再試行に回す。
                const TIMEOUT_MS = 45000;
                const ac = typeof AbortController !== "undefined" ? new AbortController() : null;
                let timer = null;
                try {
                    if (ac) timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
                    const response = await fetch(encodeURI(url), ac ? { cache: "no-store", signal: ac.signal } : { cache: "no-store" });
                    if (!response.ok) throw new Error(`ファイルが見つかりません: ${url} (${response.status})`);
                    const buffer = await response.arrayBuffer();
                    if (timer) { clearTimeout(timer); timer = null; }
                    if (!buffer || buffer.byteLength === 0) throw new Error(`空のファイルを受信しました: ${url}`);
                    await saveFileToDB(key, buffer);
                } catch (e) {
                    if (timer) clearTimeout(timer);
                    if (e && e.name === "AbortError") e = new Error(`応答がありません（${TIMEOUT_MS / 1000}秒でタイムアウト）: ${url}`);
                    if (attempt + 1 >= MAX_ATTEMPTS) throw e;
                    const waitMs = 800 * Math.pow(2, attempt); // 800ms, 1600ms
                    addAppLog("warn", `初回DL再試行 ${attempt + 1}/${MAX_ATTEMPTS - 1}: ${url} (${e.message})`);
                    showStatus(`初回セットアップ中...（再試行 ${attempt + 1} 回目）`, true);
                    await new Promise(r => setTimeout(r, waitMs));
                    return fetchFile(url, key, attempt + 1);
                }
            };

            const promises = [];
            if (!fileStatus.font_yuji) promises.push(fetchFile("hgs_gyoshotai.ttf", "font_yuji"));
            if (!fileStatus.pdf_10000en) promises.push(fetchFile(config.templates["10000en"].template_file, "pdf_10000en"));
            if (!fileStatus.pdf_1000en) promises.push(fetchFile(config.templates["1000en"].template_file, "pdf_1000en"));
            if (!fileStatus.pdf_free) promises.push(fetchFile(config.templates["free"].template_file, "pdf_free"));

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

// --- 縦書き用トークン分割 (1文字セル縦積み ＋ 縦中横トークン) ---
function tokenizeVertical(s) {
    if (!s) return [];

    // 1. ㍿ を「株式会社」4文字に展開
    let text = String(s).replace(/㍿/g, "株式会社");

    const tokens = [];
    // 括弧囲み漢字1文字 (例: （株）, (株), （有）, (有), （代）) または 1文字組文字 (㈱, ㈲, ㈳ 等)
    const regex = /([（\(][\u4E00-\u9FFF\u3400-\u4DBF][）\)])|([㈱㈲㈳㈶㈴㈾㈿㊑㊒])/g;
    const map = {
        "㈱": "株", "㈲": "有", "㈳": "社", "㈶": "財",
        "㈴": "名", "㈾": "資", "㈿": "協", "㊑": "有", "㊒": "株"
    };

    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            const preStr = text.substring(lastIndex, match.index);
            for (const c of preStr) {
                tokens.push({ type: "char", ch: c });
            }
        }

        let innerChar = "";
        if (match[1]) {
            innerChar = match[1].charAt(1);
        } else if (match[2]) {
            innerChar = map[match[2]] || "株";
        }

        tokens.push({
            type: "tcu",
            unitText: `（${innerChar}）`
        });

        lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
        const postStr = text.substring(lastIndex);
        for (const c of postStr) {
            tokens.push({ type: "char", ch: c });
        }
    }

    return tokens;
}

async function handleSetupFiles(files, status) {
    for (const file of files) {
        const name = file.name.toLowerCase();
        const buffer = await file.arrayBuffer();
        
        if (name.endsWith(".ttf") || name.endsWith(".ttc")) {
            await saveFileToDB("font_yuji", buffer);
            status.font_yuji = true;
        } else if (name.includes("0602") || name.includes("奉納ビラ")) {
            // 新規の単一PDF (奉納ビラ0602.pdf等) を3つの枠すべてに適用
            await saveFileToDB("pdf_10000en", buffer.slice(0));
            await saveFileToDB("pdf_1000en", buffer.slice(0));
            await saveFileToDB("pdf_free", buffer.slice(0));
            status.pdf_10000en = true;
            status.pdf_1000en = true;
            status.pdf_free = true;
        }
    }
    updateSetupUI(status);
}

// --- 設定ファイルの読み込み (templates_config.json が正本。取得失敗時のみフォールバック) ---
async function loadTemplatesConfig() {
    try {
        const res = await fetch("./templates_config.json?v=" + APP_VERSION);
        if (!res.ok) throw new Error("HTTP " + res.status);
        const json = await res.json();
        if (!json || typeof json !== "object" || !json.templates || !json.config_version) {
            throw new Error("templates_config.json の形式が不正です");
        }
        return json;
    } catch (e) {
        console.warn("templates_config.json の読み込みに失敗したため、フォールバック設定を使用します:", e);
        return getFallbackConfig();
    }
}

// --- フォールバック設定 (config.jsonがない場合のデフォルト定義) ---
function getFallbackConfig() {
    return {
        "config_version": 20,
        "default_font": "HGSGyoshotai",
        "templates": {
            "10000en": {
                "template_file": "奉納ビラ0602.pdf",
                "fields": {
                    "name":   { "x_mm": 24.4, "y_mm": 186.7, "font_size": 86,  "alignment": "center", "vertical": true, "width_mm": 32,  "height_mm": 191, "valign": "bottom" },
                    "amount": { "x_mm": 52.5, "y_mm": 276.4, "font_size": 172, "alignment": "center", "vertical": true, "width_mm": 62,  "height_mm": 314, "valign": "top" }
                }
            },
            "1000en": {
                "template_file": "奉納ビラ0602.pdf",
                "fields": {
                    "name":   { "x_mm": 24.4, "y_mm": 186.7, "font_size": 86,  "alignment": "center", "vertical": true, "width_mm": 32,  "height_mm": 191, "valign": "bottom" },
                    "amount": { "x_mm": 52.5, "y_mm": 276.4, "font_size": 172, "alignment": "center", "vertical": true, "width_mm": 62,  "height_mm": 314, "valign": "top" }
                }
            },
            "free": {
                "template_file": "奉納ビラ0602.pdf",
                "fields": {
                    "name":   { "x_mm": 24.4, "y_mm": 186.7, "font_size": 86,  "alignment": "center", "vertical": true, "width_mm": 32,  "height_mm": 191, "valign": "bottom" },
                    "amount": { "x_mm": 52.5, "y_mm": 276.4, "font_size": 172, "alignment": "center", "vertical": true, "width_mm": 62,  "height_mm": 314, "valign": "top" }
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
            
            // 新設項目
            if (designSettings[tKey][fKey].char_spacing === undefined) designSettings[tKey][fKey].char_spacing = 0.0;
            if (designSettings[tKey][fKey].bold === undefined) designSettings[tKey][fKey].bold = false;
            
            // 敬称（nameフィールドのみ設定）
            if (fKey === "name") {
                if (designSettings[tKey][fKey].honorific === undefined) designSettings[tKey][fKey].honorific = "殿";
                if (designSettings[tKey][fKey].honorific_spacing === undefined) designSettings[tKey][fKey].honorific_spacing = 0.0;
            }
        }
    }
    saveDesignSettings();
    updatePaperSizeUI();
}

function getCurrentFontKey() {
    const fontSelect = document.getElementById("fontSelect");
    return fontSelect && fontSelect.value ? fontSelect.value : "HGSGyoshotai";
}

// --- （株）縦中横ユニットの書体別サイズ (%) 永続化モジュール ---
let tcuScalePerFont = {};

function loadTcuScaleSettings() {
    try {
        const saved = localStorage.getItem("pdf_mail_merge_tcu_scale");
        if (saved) {
            tcuScalePerFont = JSON.parse(saved);
        }
    } catch (e) {
        console.warn("TCUスケール復元エラー:", e);
    }
}

function saveTcuScaleSettings() {
    try {
        localStorage.setItem("pdf_mail_merge_tcu_scale", JSON.stringify(tcuScalePerFont));
    } catch (e) {
        console.warn("TCUスケール保存エラー:", e);
    }
}

function getTcuScaleForCurrentFont() {
    const fontKey = getCurrentFontKey();
    const val = Number(tcuScalePerFont[fontKey]);
    return Number.isFinite(val) && val >= 30 && val <= 300 ? val : 165;
}

function updateTcuScaleUI() {
    const val = getTcuScaleForCurrentFont();
    const span = document.getElementById("tcu-val-scale");
    if (span && span.tagName !== 'INPUT') {
        span.textContent = val + "%";
    }
}

function setTcuScaleForCurrentFont(val) {
    const fontKey = getCurrentFontKey();
    let num = Math.round(Number(val));
    if (!Number.isFinite(num)) num = 165;
    if (num < 30) num = 30;
    if (num > 300) num = 300;
    
    tcuScalePerFont[fontKey] = num;
    saveTcuScaleSettings();
    updateTcuScaleUI();
    addAppLog("info", `tcuScale ${fontKey} = ${num}%`);
    triggerAutoUpdate();
}

function adjustTcuScale(delta) {
    const current = getTcuScaleForCurrentFont();
    setTcuScaleForCurrentFont(current + delta);
}

function makeTcuValueEditable() {
    const span = document.getElementById("tcu-val-scale");
    if (!span || span.tagName === 'INPUT') return;
    const currentVal = getTcuScaleForCurrentFont();

    const input = document.createElement('input');
    input.id = 'tcu-val-scale';
    input.type = 'number';
    input.step = '1';
    input.min = '30';
    input.max = '300';
    input.style.width = '42px';
    input.style.fontSize = '12px';
    input.style.textAlign = 'center';
    input.style.fontFamily = 'monospace';
    input.style.border = '1px solid #4f46e5';
    input.style.borderRadius = '4px';
    input.style.padding = '1px 2px';
    input.value = currentVal;

    const commitValue = () => {
        let parsed = parseInt(input.value, 10);
        if (!Number.isFinite(parsed)) parsed = 165;
        setTcuScaleForCurrentFont(parsed);
    };

    input.onblur = commitValue;
    input.onkeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            input.blur();
        }
    };

    if (span.parentNode) {
        span.parentNode.replaceChild(input, span);
        input.focus();
        input.select();
    }
}

function onFontChange(fontValue) {
    const fontSelect = document.getElementById("fontSelect");
    if (fontSelect && fontValue && fontSelect.value !== fontValue) {
        fontSelect.value = fontValue;
    }
    updateTcuScaleUI();
    triggerAutoUpdate();
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
    loadTcuScaleSettings();
    updateTcuScaleUI();
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
    paperSizeSettings = { width: 105, height: 390 };
    saveDesignSettings();
    updatePaperSizeUI();
    triggerAutoUpdate();
    showToast('用紙サイズをデフォルト（105 x 390mm）に戻しました');
}

function updatePaperSizeUI() {
    const wEl = document.getElementById('paper-val-width');
    const hEl = document.getElementById('paper-val-height');
    if (wEl) wEl.textContent = paperSizeSettings.width.toFixed(1);
    if (hEl) hEl.textContent = paperSizeSettings.height.toFixed(1);
}

// --- 名簿データベース（履歴）のIndexedDB連携 ---
async function loadDbRecords() {
    try {
        const all = await idbGetAllRecords();
        // 削除待ち（墓標）は一覧に表示しない。また過去の破損データ（氏名欄に金額や合計金額が入っているデータ）は自動削除・排除
        dbRecords = all.filter(r => {
            if (r.sync === "pending_delete") return false;
            const nm = String(r.name ?? "").trim();
            if (nm.startsWith("¥") || nm.startsWith("\\") || nm.startsWith("合計") || nm.startsWith("物品まとめ")) {
                if (r.id) idbDeleteRecord(r.id); // 自動クレンジング
                return false;
            }
            return true;
        });
        // デフォルトで日時昇順（古い順）に揃える
        dbRecords.sort((a, b) => {
            const da = parseFlexibleDate(a.date);
            const db_ = parseFlexibleDate(b.date);
            return (da ? da.getTime() : 0) - (db_ ? db_.getTime() : 0);
        });
    } catch (e) {
        console.error("IndexedDB名簿DBアクセスエラー:", e);
        dbRecords = [];
    }
}

// --- テンプレートPDFの取得 (キャッシュ対応) ---
async function getTemplateBytes(templateKey) {
    if (loadedTemplateBytes[templateKey]) {
        return loadedTemplateBytes[templateKey];
    }
    
    const filename = config.templates[templateKey].template_file;
    showStatus("テンプレートPDF読み込み中...", true);

    // キャッシュのバージョン管理は Service Worker (CACHE_NAME) に一本化。
    // （旧実装の ?t= キャッシュバスターはSWキャッシュにユニークキーを溜め続ける原因だった）
    const response = await fetch(encodeURI(filename));
    if (!response.ok) {
        throw new Error(`テンプレートファイルが見つかりません: ${filename}`);
    }
    
    const bytes = await response.arrayBuffer();
    loadedTemplateBytes[templateKey] = bytes; // オンメモリキャッシュ
    // 起動処理の途中で呼ばれることがあるため、アプリがまだ準備できていない段階で
    // 「準備完了」と表示しない（初回セットアップ中に一瞬だけ完了表示が出て、
    // 利用者が印刷を押せると誤解する問題があった）。
    if (isAppReady) showStatus("準備完了", false);
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
    const amountAutocompleteWrapper = document.getElementById("amountAutocompleteWrapper");
    
    if (templateKey === "10000en" || templateKey === "1000en") {
        amountLabel.textContent = "任意の金額の数字一文字 (例: 壱, 弐, 伍)";
        if(amountAutocompleteWrapper) amountAutocompleteWrapper.style.display = "none";
        else amountInput.style.display = "none";
        if(amountSelect) amountSelect.style.display = "block";
    } else {
        amountLabel.textContent = "任意の金額 または 物品名";
        amountInput.placeholder = "例: 金 五阡圓也、お神酒 二升";
        if(amountAutocompleteWrapper) amountAutocompleteWrapper.style.display = "block";
        else amountInput.style.display = "block";
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
    try {
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
            const x = Number(settings[targetKey].x) || 0;
            const y = Number(settings[targetKey].y) || 0;
            
            const badge = document.getElementById("dpadCoordinates");
            if (badge) {
                badge.textContent = `X: ${x.toFixed(1)} / Y: ${y.toFixed(1)}`;
            }
            
            const elX = document.getElementById("dpad-input-x");
            const elY = document.getElementById("dpad-input-y");
            if (elX) elX.value = x.toFixed(1);
            if (elY) elY.value = y.toFixed(1);
            
            const elFontSize = document.getElementById("dpad-val-font_size");
            const elWidth = document.getElementById("dpad-val-width_mm");
            const elHeight = document.getElementById("dpad-val-height_mm");
            const elValign = document.getElementById("dpad-val-valign");
            const elCharSpacing = document.getElementById("dpad-val-char_spacing");
            const elBold = document.getElementById("boldCheck");
            
            if (elFontSize) {
                if (elFontSize.tagName === 'INPUT') elFontSize.value = settings[targetKey].font_size;
                else elFontSize.textContent = settings[targetKey].font_size;
            }
            if (elWidth) {
                if (elWidth.tagName === 'INPUT') elWidth.value = settings[targetKey].width_mm;
                else elWidth.textContent = settings[targetKey].width_mm;
            }
            if (elHeight) {
                if (elHeight.tagName === 'INPUT') elHeight.value = settings[targetKey].height_mm;
                else elHeight.textContent = settings[targetKey].height_mm;
            }
            if (elValign) elValign.value = settings[targetKey].valign || "top";
            
            if (elCharSpacing) {
                if (elCharSpacing.tagName === 'INPUT') elCharSpacing.value = settings[targetKey].char_spacing || 0;
                else elCharSpacing.textContent = (settings[targetKey].char_spacing || 0.0).toFixed(1);
            }
            if (elBold) {
                elBold.checked = settings[targetKey].bold || false;
            }
            
            // 敬称UIの同期（nameの時だけ値がセットされている）
            const nameSettings = settings["name"];
            if (nameSettings) {
                const elHonorificSelect = document.getElementById("honorificSelect");
                const elHonorificCustomInput = document.getElementById("honorificCustomInput");
                const elHonorificSpacingVal = document.getElementById("honorific-spacing-val");
                
                const currentHonorific = nameSettings.honorific || "殿";
                if (elHonorificSelect) {
                    if (["殿", "様", "なし"].includes(currentHonorific)) {
                        elHonorificSelect.value = currentHonorific;
                        if (elHonorificCustomInput) elHonorificCustomInput.style.display = "none";
                    } else {
                        elHonorificSelect.value = "custom";
                        if (elHonorificCustomInput) {
                            elHonorificCustomInput.style.display = "block";
                            elHonorificCustomInput.value = currentHonorific;
                        }
                    }
                }
                if (elHonorificSpacingVal) {
                    elHonorificSpacingVal.textContent = (nameSettings.honorific_spacing || 0.0).toFixed(1);
                }
            }
        }
        updatePaperSizeUI();
    } catch (e) {
        console.error("updateDpadUI error:", e);
    }
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

// 新規追加: 太字（重ね描き）の設定変更
function changeTargetBold(checked) {
    const targetRadios = document.getElementsByName("dpadTarget");
    let targetKey = "name";
    for (let i = 0; i < targetRadios.length; i++) {
        if (targetRadios[i].checked) { targetKey = targetRadios[i].value; break; }
    }
    const settings = designSettings[currentTemplate];
    if (settings && settings[targetKey]) {
        settings[targetKey].bold = checked;
        saveDesignSettings();
        triggerAutoUpdate();
    }
}

// 新規追加: 敬称セレクトボックスの変更
function changeHonorific(value) {
    const settings = designSettings[currentTemplate];
    if (settings && settings["name"]) {
        const input = document.getElementById("honorificCustomInput");
        if (value === "custom") {
            if (input) {
                input.style.display = "block";
                settings["name"].honorific = input.value || "殿";
            }
        } else {
            if (input) input.style.display = "none";
            settings["name"].honorific = value;
        }
        saveDesignSettings();
        triggerAutoUpdate();
    }
}

// 新規追加: 敬称のカスタムテキスト入力変更
function changeCustomHonorific(value) {
    const settings = designSettings[currentTemplate];
    if (settings && settings["name"]) {
        settings["name"].honorific = value;
        saveDesignSettings();
        triggerAutoUpdate();
    }
}

// 新規追加: 敬称とのスペース間隔調整
function adjustHonorificSpacing(change) {
    const settings = designSettings[currentTemplate];
    if (settings && settings["name"]) {
        let current = settings["name"].honorific_spacing || 0.0;
        current = parseFloat((current + change).toFixed(1));
        if (current < -10) current = -10;
        if (current > 50) current = 50;
        settings["name"].honorific_spacing = current;
        
        const span = document.getElementById("honorific-spacing-val");
        if (span) span.textContent = current.toFixed(1);
        
        saveDesignSettings();
        triggerAutoUpdate();
    }
}

// --- フォントサイズ等の直接入力機能 ---
function makeValueEditable(param) {
    const span = document.getElementById(`dpad-val-${param}`);
    if (!span || span.tagName === 'INPUT') return;
    const currentVal = parseFloat(span.textContent);
    const input = document.createElement('input');
    input.id = `dpad-val-${param}`;
    input.type = 'number';
    input.step = param === 'char_spacing' ? '0.1' : '1';
    input.value = isNaN(currentVal) ? 0 : currentVal;
    input.style.cssText = 'width: 60px; text-align: center; font-weight: 600; font-family: monospace; border: 2px solid var(--accent); border-radius: 4px; padding: 2px; font-size: 14px; outline: none;';
    span.replaceWith(input);
    input.focus();
    input.select();
    
    const confirmAndRevert = () => {
        const newSpan = document.createElement('span');
        newSpan.id = `dpad-val-${param}`;
        newSpan.style.cssText = 'font-weight: 600; font-family: monospace; cursor: pointer;';
        newSpan.onclick = () => makeValueEditable(param);
        
        const targetRadios = document.getElementsByName('dpadTarget');
        let targetKey = 'name';
        for (let i = 0; i < targetRadios.length; i++) {
            if (targetRadios[i].checked) { targetKey = targetRadios[i].value; break; }
        }
        
        const val = designSettings[currentTemplate]?.[targetKey]?.[param] ?? '--';
        newSpan.textContent = typeof val === 'number' ? val.toFixed(param === 'char_spacing' ? 1 : 0) : val;
        input.replaceWith(newSpan);
        updateDpadUI();
    };

    input.addEventListener('change', () => {
        const newVal = parseFloat(input.value);
        if (!isNaN(newVal)) {
            const targetRadios = document.getElementsByName('dpadTarget');
            let targetKey = 'name';
            for (let i = 0; i < targetRadios.length; i++) {
                if (targetRadios[i].checked) { targetKey = targetRadios[i].value; break; }
            }
            const settings = designSettings[currentTemplate];
            if (settings && settings[targetKey]) {
                settings[targetKey][param] = newVal;
                saveDesignSettings();
                triggerAutoUpdate();
            }
        }
    });

    input.addEventListener('blur', confirmAndRevert);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
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
            valign: fieldVal.valign || "top",
            char_spacing: 0.0,
            bold: false
        };
        if (fieldKey === "name") {
            designSettings[currentTemplate][fieldKey].honorific = "殿";
            designSettings[currentTemplate][fieldKey].honorific_spacing = 0.0;
        }
    }
    saveDesignSettings();
    updateDpadUI();
    updatePreview();
    showToast("デザイン調整を初期値にリセットしました");
}

// --- リアルタイムプレビュー用デバウンス制御 (400ms ＋ スピナーガード C項目) ---
function triggerAutoUpdate() {
    updateAmountEcho();
    if (autoUpdateTimer) clearTimeout(autoUpdateTimer);
    autoUpdateTimer = setTimeout(() => {
        runPdfPreviewWithOverlay();
    }, 400); // 400ms 入力が止まったら非同期プレビュー合成
}

async function runPdfPreviewWithOverlay() {
    if (isPdfGenerating) {
        pendingPdfUpdate = true;
        return;
    }

    const overlay = document.getElementById("previewOverlay");
    if (overlay) overlay.style.display = "flex";

    isPdfGenerating = true;
    try {
        await updatePreview();
    } catch (e) {
        console.error("PDFプレビュー生成エラー:", e);
    } finally {
        isPdfGenerating = false;
        if (overlay) overlay.style.display = "none";
        
        if (pendingPdfUpdate) {
            pendingPdfUpdate = false;
            triggerAutoUpdate();
        }
    }
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

// ==========================================
// レコード変換・共通ヘルパー
// （レコードの形に関する知識をここに集約する）
// ==========================================

// 「[空]」タグの検出と除去（表示・印刷経路では必ず剥がす）
// GAS側は全角「［空］」も有効なタグとして扱うため、半角・全角どちらの括弧にも対応する。
const EMPTY_TAG_RE = /\s*[\[［]\s*空\s*[\]］]\s*/g;
function hasEmptyTag(str) {
    return typeof str === "string" && /[\[［]\s*空\s*[\]］]/.test(str);
}
function stripEmptyTag(str) {
    if (typeof str !== "string") return str;
    return str.replace(EMPTY_TAG_RE, "").trim();
}

// 保存済みamount（例: "金五萬圓也"）からフォーム入力値（例: "五"）を復元
function parseAmountForForm(record) {
    let val = stripEmptyTag(record.amount || "");
    if (record.template === "10000en" || record.template === "1000en") {
        if (val.startsWith("金")) val = val.substring(1);
        if (val.endsWith("萬圓也") || val.endsWith("阡圓也") || val.endsWith("阡圆也")) {
            val = val.substring(0, val.length - 3);
        }
        // 旧データ（一/二/三/五）を大字（壱/弐/参/伍）に正規化してセレクトと一致させる
        const daijiMap = {'一':'壱','二':'弐','三':'参','五':'伍'};
        if (daijiMap[val]) val = daijiMap[val];
    }
    return val;
}

// ISO 8601 / "2026/6/10 12:00:00" 形式（GAS由来）の両方を安全にDate化
function parseFlexibleDate(value) {
    if (value instanceof Date) return isNaN(value) ? null : value;
    if (typeof value !== "string" || !value) return null;
    // まず標準パース (ISO等)
    let d = new Date(value);
    if (!isNaN(d)) return d;
    // "YYYY/M/D H:MM(:SS)" 形式を手動パース (Safari対策)
    const m = value.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
    if (m) {
        d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
        if (!isNaN(d)) return d;
    }
    return null;
}

// レコードの日付解決を1箇所に集約するヘルパー。
// date が本来の登録日時、timestamp は表示・互換用のため date を優先する。
// 解決できなければ null を返す（呼び出し側で0埋めやフォールバックを個別実装しないこと）。
function recordDate(r) {
    if (!r) return null;
    return parseFlexibleDate(r.date || r.timestamp);
}

// 一覧表示用の日時フォーマット（パース不能なら原文を返す）
function formatDateForDisplay(value) {
    const d = parseFlexibleDate(value);
    if (!d) return String(value || "");
    return `${d.getFullYear()}/${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getDate().toString().padStart(2,'0')} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
}

// スプレッドシート行から決定的なIDを合成（復元を何度実行しても同じIDになる）
function stableIdFromRow(timestamp, name, amount, bagNo = "", address = "", idx = 0) {
    const src = `${timestamp}|${name}|${amount}|${bagNo}|${address}|${idx}`;
    let hash = 5381;
    for (let i = 0; i < src.length; i++) {
        hash = ((hash << 5) + hash + src.charCodeAt(i)) >>> 0; // djb2
    }
    return "rec_res_" + hash.toString(36);
}

// GET用: URLに auth= を付与する。トークン未設定なら無加工（GAS側の「未設定=素通し」と噛み合わせる）
function withAuthParam(url) {
    if (!gasSharedToken) return url;
    return url + (url.includes("?") ? "&" : "?") + "auth=" + encodeURIComponent(gasSharedToken);
}
// POST用: payloadに auth を足す。トークン未設定なら足さない
function withAuthPayload(obj) {
    if (!gasSharedToken) return obj;
    return Object.assign({}, obj, { auth: gasSharedToken });
}

// GASへのPOST送信（CORSで応答を検証する。失敗時は例外）
// ※ Content-Typeヘッダを付けない = 単純リクエストとなりプリフライト不要
async function postToGas(payload) {
    const res = await fetch(gasUrl, {
        method: "POST",
        body: JSON.stringify(withAuthPayload(payload))
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.result !== "success") {
        const err = new Error(data.message || "GAS側でエラーが返されました");
        err.code = data.code || "";
        throw err;
    }
    return data;
}

// --- PDFの動的合成処理（コア機能） ---
// override = { template, name, amount } を渡すと、DOMを読まずにそのデータで合成する
// （一括印刷でフォームDOMを書き換えずに済むようにするため）
async function generatePDF(isPrinting = false, override = null) {
    if (!isAppReady) {
        return null;
    }

    const tmpl = override ? override.template : currentTemplate;
    const nameInput = expandCompatChars(override ? (override.name || "").trim() : document.getElementById("nameInput").value.trim());
    const amountSelect = document.getElementById("amountSelect");
    const amountInput = expandCompatChars(override
        ? (override.amount || "").trim()
        : (tmpl === "free" ? document.getElementById("amountInput").value.trim() : (amountSelect ? amountSelect.value : document.getElementById("amountInput").value.trim())));

    // 氏名がない場合は合成処理をスキップ (プレビュークリア状態に)
    if (!nameInput) {
        return null;
    }

    try {
        // 1. テンプレートPDFの取得（IndexedDBから事前にロード済み）
        const templateBytes = loadedTemplateBytes[tmpl];
        if (!templateBytes) {
            throw new Error(`テンプレートデータが見つかりません: ${tmpl}`);
        }
        // 2. pdf-libでPDFをロードまたは新規作成
        let pdfDoc;
        let firstPage;
        const includeBackground = document.getElementById("includeBackground") ? document.getElementById("includeBackground").checked : true;

        const newWidthPt = mmToPt(paperSizeSettings.width);
        const newHeightPt = mmToPt(paperSizeSettings.height);

        if (includeBackground) {
            pdfDoc = await PDFLib.PDFDocument.load(templateBytes);
            firstPage = pdfDoc.getPages()[0];
            // 原本サイズをキャッシュ（白紙モードや次回以降の再ロードを不要にする）
            if (!templatePageSizes[tmpl]) {
                templatePageSizes[tmpl] = { w: firstPage.getSize().width, h: firstPage.getSize().height };
            }
        } else if (!templatePageSizes[tmpl]) {
            // 白紙モードで原本サイズが未キャッシュの場合のみ一度だけロードする
            const origDoc = await PDFLib.PDFDocument.load(templateBytes);
            const origPage = origDoc.getPages()[0];
            templatePageSizes[tmpl] = { w: origPage.getSize().width, h: origPage.getSize().height };
        }

        // 用紙サイズ変更の計算 (原本との差分で translateContent + setSize)
        const origWidthPt = templatePageSizes[tmpl].w;
        const origHeightPt = templatePageSizes[tmpl].h;
        const shiftXPt = (newWidthPt - origWidthPt) / 2;
        const shiftYPt = (newHeightPt - origHeightPt) / 2;

        if (includeBackground) {
            // デザインをセンタリングしてからページサイズを変更
            firstPage.translateContent(shiftXPt, shiftYPt);
            firstPage.setSize(newWidthPt, newHeightPt);
        } else {
            // 白紙のPDFを新規作成（新しい用紙サイズで）
            pdfDoc = await PDFLib.PDFDocument.create();
            firstPage = pdfDoc.addPage([newWidthPt, newHeightPt]);
        }
        
        // 3. 日本語フォントの読み込みと埋め込み
        // subset: true で使用グリフのみを埋め込む（4.5MBのフォント全体を毎回埋め込むと
        // 一括印刷でマージPDFのサイズが件数に完全比例して肥大化し、iPad Safariが落ちるため）。
        // 実測: 10件マージ時 subset:false=28.17MB → subset:true=3.12MB（レンダリング結果は同一と確認済み）
        let fontToUse = null;
        if (loadedFontBytes) {
            try {
                pdfDoc.registerFontkit(window.fontkit);
                fontToUse = await pdfDoc.embedFont(new Uint8Array(loadedFontBytes), { subset: true });
            } catch (fontError) {
                console.error("フォントの埋め込みに失敗しました。標準フォントにフォールバックします:", fontError);
                fontToUse = await pdfDoc.embedStandardFont(PDFLib.StandardFonts.Helvetica);
            }
        } else {
            fontToUse = await pdfDoc.embedStandardFont(PDFLib.StandardFonts.Helvetica);
        }
        
        // デザイン調整値の読み出し
        const settings = designSettings[tmpl];

        // 新テンプレート: 「奉納」のみ印刷済み → 金額・氏名をアプリ側で完全合成
        const fullAmount =
            tmpl === '10000en' ? `金${amountInput}萬圓也` :
            tmpl === '1000en'  ? `金${amountInput}阡圓也` :
            amountInput; // free: 完全自由入力
        
        // 敬称の設定取得
        const nameSettings = settings["name"] || {};
        const honorific = nameSettings.honorific || "殿";
        
        const data = {
            name:   expandCompatChars(nameInput || ''),
            amount: expandCompatChars(fullAmount)
        };

        // 各フィールドの描画
        for (const [fieldKey, fieldVal] of Object.entries(settings)) {
            const rawTextValue = data[fieldKey];
            if (!rawTextValue) continue;
            const textValue = expandCompatChars(rawTextValue);
            checkGlyphAvailability(fontToUse, textValue);

            // 用紙サイズ変更に伴うテキスト座標 of オフセット適用
            let x_pt = mmToPt(fieldVal.x);
            let y_pt = mmToPt(fieldVal.y);

            // 背景を含める場合、translateContent() により既にPDFの原点がシフトされているため
            // 座標にオフセットを足す必要はありません（足すと2重シフトになります）。
            // 背景を含めない（白紙の新規PDF）場合のみ手動でオフセットを加算します。
            if (!includeBackground) {
                x_pt += shiftXPt;
                y_pt += shiftYPt;
            }
            const baseFontSize = fieldVal.font_size;
            const width_pt = mmToPt(fieldVal.width_mm || 30);
            const height_pt = mmToPt(fieldVal.height_mm || 150);
            
            const fieldConfig = config.templates[tmpl].fields[fieldKey];
            if (!fieldConfig) {
                console.warn(`フィールド設定が見つかりません: ${fieldKey}`);
                continue;
            }
            const alignment = fieldConfig.alignment || "left";
            const isVertical = fieldConfig.vertical || false;

            let currentFontSize = baseFontSize;
            const showBoundingBox = document.getElementById("showBoundingBox") && document.getElementById("showBoundingBox").checked;

            if (isVertical) {
                // 縦書きの描画処理（1文字ずつ縦積み ＋ （株）等の縦中横は1マス中央描画）
                const nameTokens = tokenizeVertical(textValue);
                let honorificTokens = [];
                let honorificSpacingPt = 0;

                if (fieldKey === "name" && nameInput && honorific !== "なし") {
                    const honorificText = honorific === "custom" ? (nameSettings.honorific || "") : honorific;
                    honorificTokens = tokenizeVertical(honorificText);
                    honorificSpacingPt = mmToPt(nameSettings.honorific_spacing || 0.0);
                }

                const totalTokensCount = nameTokens.length + honorificTokens.length;
                const charSpacingPt = mmToPt(fieldVal.char_spacing || 0.0);

                // 枠の高さに収まるようにフォントサイズを縮小
                let currentHeight_pt = totalTokensCount * (currentFontSize * 1.02) + (totalTokensCount - 1) * charSpacingPt + honorificSpacingPt;
                if (currentHeight_pt > height_pt) {
                    currentFontSize = (height_pt - (totalTokensCount - 1) * charSpacingPt - honorificSpacingPt) / (totalTokensCount * 1.02);
                    const minAllowedSize = Math.max(14, baseFontSize * 0.6);
                    if (currentFontSize < minAllowedSize) currentFontSize = minAllowedSize;
                }
                if (currentFontSize > width_pt) {
                    currentFontSize = width_pt;
                }

                const boxTop = y_pt + baseFontSize;

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

                const finalHeight_pt = totalTokensCount * (currentFontSize * 1.02) + (totalTokensCount - 1) * charSpacingPt + honorificSpacingPt;
                const spacing = currentFontSize * 1.02 + charSpacingPt;

                let currentY = boxTop - currentFontSize;
                const valign = fieldVal.valign || "top";
                if (valign === "center") {
                    currentY = boxTop - (height_pt / 2) + (finalHeight_pt / 2) - currentFontSize;
                } else if (valign === "bottom") {
                    currentY = boxTop - height_pt + finalHeight_pt - currentFontSize;
                }

                const allDrawTokens = [];
                nameTokens.forEach(t => allDrawTokens.push({ token: t, isHonorific: false }));
                honorificTokens.forEach((t, idx) => {
                    allDrawTokens.push({ token: t, isHonorific: true, isFirstHonorific: idx === 0 });
                });

                // 縦中横の最適フォント倍率 (基準 0.42 × ユーザー指定設定%)
                const userTcuPercent = getTcuScaleForCurrentFont();
                const TCU_SCALE_FACTOR = 0.42 * (userTcuPercent / 100.0);

                for (const item of allDrawTokens) {
                    if (item.isHonorific && item.isFirstHonorific) {
                        currentY -= honorificSpacingPt;
                    }

                    const token = item.token;

                    if (token.type === "tcu") {
                        // ★ 縦中横トークン (「（株）」等の3文字を1マスに横書きで収める)
                        const tcuFontSize = currentFontSize * TCU_SCALE_FACTOR;
                        const unitText = token.unitText;
                        const tcuWidth = fontToUse.widthOfTextAtSize(unitText, tcuFontSize);
                        
                        // 1マスの中央位置
                        const drawX = x_pt - (tcuWidth / 2);
                        const drawY = currentY + (currentFontSize * 0.28);

                        const drawOptions = {
                            x: drawX,
                            y: drawY,
                            size: tcuFontSize,
                            font: fontToUse,
                            color: PDFLib.rgb(0.1, 0.1, 0.1)
                        };

                        firstPage.drawText(unitText, drawOptions);
                        if (fieldVal.bold) {
                            firstPage.drawText(unitText, { ...drawOptions, x: drawX + 0.3 });
                            firstPage.drawText(unitText, { ...drawOptions, y: drawY + 0.3 });
                            firstPage.drawText(unitText, { ...drawOptions, x: drawX + 0.3, y: drawY + 0.3 });
                        }
                    } else {
                        // 通常文字の縦積み描画
                        const charToDraw = token.ch;
                        const charWidth = fontToUse.widthOfTextAtSize(charToDraw, currentFontSize);
                        let drawX = x_pt;
                        if (alignment === "center") {
                            drawX = x_pt - (charWidth / 2);
                        } else if (alignment === "right") {
                            drawX = x_pt - charWidth;
                        }

                        const baseDrawOptions = {
                            x: drawX,
                            y: currentY,
                            size: currentFontSize,
                            font: fontToUse,
                            color: PDFLib.rgb(0.1, 0.1, 0.1)
                        };

                        firstPage.drawText(charToDraw, baseDrawOptions);
                        if (fieldVal.bold) {
                            firstPage.drawText(charToDraw, { ...baseDrawOptions, x: drawX + 0.3 });
                            firstPage.drawText(charToDraw, { ...baseDrawOptions, y: currentY + 0.3 });
                            firstPage.drawText(charToDraw, { ...baseDrawOptions, x: drawX + 0.3, y: currentY + 0.3 });
                        }
                    }

                    // 1マス分の縦送り
                    currentY -= spacing;
                }
            } else {
                // 通常の横書き描画処理（字間と重ね描きを反映）
                const charSpacingPt = mmToPt(fieldVal.char_spacing || 0.0);
                
                // 枠の幅に収まるようにフォントサイズを縮小
                // 字間(固定値)は縮小しても変わらないため、文字幅部分のみで比例縮小する
                const textOnlyWidth_pt = fontToUse.widthOfTextAtSize(textValue, currentFontSize);
                const totalSpacing_pt = (textValue.length - 1) * charSpacingPt;
                if (textOnlyWidth_pt + totalSpacing_pt > width_pt) {
                    currentFontSize = currentFontSize * (width_pt - totalSpacing_pt) / textOnlyWidth_pt;
                    if (currentFontSize < 10) currentFontSize = 10;
                }
                // 枠の高さにも収まるように縮小
                if (currentFontSize > height_pt) {
                    currentFontSize = height_pt;
                }

                if (showBoundingBox && !isPrinting) {
                    let boxX = x_pt;
                    if (alignment === "center") boxX = x_pt - (width_pt / 2);
                    else if (alignment === "right") boxX = x_pt - width_pt;
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
                const newTextWidth = fontToUse.widthOfTextAtSize(textValue, currentFontSize) + (textValue.length - 1) * charSpacingPt;
                
                let drawY = y_pt;
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

                // 一文字ずつ描画（字間適用のため）
                let currentX = drawX;
                for (let idx = 0; idx < textValue.length; idx++) {
                    const char = textValue[idx];
                    const charWidth = fontToUse.widthOfTextAtSize(char, currentFontSize);
                    
                    const drawOptions = {
                        x: currentX,
                        y: drawY,
                        size: currentFontSize,
                        font: fontToUse,
                        color: PDFLib.rgb(0.1, 0.1, 0.1)
                    };
                    
                    firstPage.drawText(char, drawOptions);
                    if (fieldVal.bold) {
                        firstPage.drawText(char, { ...drawOptions, x: currentX + 0.3 });
                        firstPage.drawText(char, { ...drawOptions, y: drawY + 0.3 });
                        firstPage.drawText(char, { ...drawOptions, x: currentX + 0.3, y: drawY + 0.3 });
                    }
                    
                    currentX += charWidth + charSpacingPt;
                }
            }
        }

        // 4. PDFを保存してBlobを生成
        const pdfBytes = await pdfDoc.save();
        return new Blob([pdfBytes], { type: "application/pdf" });

    } catch (e) {
        console.error("PDF合成エラー:", e);
        showToast("エラーが発生しました（詳細は「ログ」ボタンを参照）", "error");
        showStatus("PDF生成エラー", false);
        return null;
    }
}

// --- プレビュー表示サイズ制御 (全体フィット 75vh ↔ 100% 拡大) ---
let previewZoomMode = "fit";

function setPreviewZoom(mode) {
    previewZoomMode = mode;
    // fit / 100 / field:name / field:amount の4ボタンのアクティブ表示を切り替える
    const map = { "fit": "btnPreviewFit", "100": "btnPreviewZoom100", "field:name": "btnPreviewZoomName", "field:amount": "btnPreviewZoomAmount" };
    Object.keys(map).forEach(key => {
        const btn = document.getElementById(map[key]);
        if (!btn) return;
        if (key === mode) {
            btn.style.background = "#4f46e5";
            btn.style.color = "white";
        } else {
            btn.style.background = "transparent";
            btn.style.color = "#475569";
        }
    });

    // #previewViewport は通常 justify-content: center だが、
    // fieldモードでは scrollLeft/scrollTop によるスクロール位置指定がずれてしまうため flex-start にする
    const viewport = document.getElementById("previewViewport");
    if (viewport) {
        viewport.style.justifyContent = mode.startsWith("field:") ? "flex-start" : "center";
    }

    applyPreviewDisplaySize();
}

// 指定フィールド（name / amount）のキャンバス上矩形（pt, 左上原点）を返す。未設定時はnull。
function computeFieldRectPt(fieldKey) {
    const s = designSettings[currentTemplate] && designSettings[currentTemplate][fieldKey];
    if (!s) return null;
    const w = mmToPt(s.width_mm || 30), h = mmToPt(s.height_mm || 150);

    // generatePDF内と同じシフト条件・計算式（背景を含めない場合のみオフセットを加算する）
    // ここで条件分岐やshiftの式をgeneratePDFと違えると、背景OFF＋原本サイズ≠設定サイズの
    // 組み合わせでズーム位置が実際の印字位置とずれる。
    let x_pt = mmToPt(s.x);
    let y_pt = mmToPt(s.y);
    const includeBackground = document.getElementById("includeBackground") ? document.getElementById("includeBackground").checked : true;
    if (!includeBackground && templatePageSizes[currentTemplate]) {
        const origWidthPt = templatePageSizes[currentTemplate].w;
        const origHeightPt = templatePageSizes[currentTemplate].h;
        const newWidthPt = mmToPt(paperSizeSettings.width);
        const newHeightPt = mmToPt(paperSizeSettings.height);
        const shiftXPt = (newWidthPt - origWidthPt) / 2;
        const shiftYPt = (newHeightPt - origHeightPt) / 2;
        x_pt += shiftXPt;
        y_pt += shiftYPt;
    }

    // generatePDF内の縦書き描画式 boxTop = y_pt + baseFontSize と完全に同一にすること
    const boxTop = y_pt + s.font_size;
    const pageH = mmToPt(paperSizeSettings.height);
    return { left: x_pt - w / 2, top: pageH - boxTop, width: w, height: h };
}

function applyPreviewDisplaySize() {
    const pdfCanvas = document.getElementById("pdfCanvas");
    const viewport = document.getElementById("previewViewport");
    if (!pdfCanvas || !viewport || !pdfCanvas._unscaledViewport) return;

    const unscaledW = pdfCanvas._unscaledViewport.width;
    const unscaledH = pdfCanvas._unscaledViewport.height;

    if (previewZoomMode === "fit") {
        // max-height: 75vh のプレビュー枠内に縦長（105x390mm）全体がすっぽり収まる表示スケールを計算
        const containerW = Math.max(100, viewport.clientWidth - 24);
        const containerH = Math.max(100, viewport.clientHeight - 24);

        const scaleW = containerW / unscaledW;
        const scaleH = containerH / unscaledH;

        // 全体がスクロールなしで収まるよう等比縮小
        let displayScale = Math.min(scaleW, scaleH);
        if (!Number.isFinite(displayScale) || displayScale <= 0) displayScale = 0.5;

        pdfCanvas.style.width = Math.floor(unscaledW * displayScale) + "px";
        pdfCanvas.style.height = Math.floor(unscaledH * displayScale) + "px";
        viewport.style.overflow = "hidden";
    } else if (previewZoomMode === "100") {
        // 100% 拡大表示（細部確認用、スクロール枠表示）
        const containerW = Math.max(100, viewport.clientWidth - 24);
        const displayScale = Math.max(0.6, containerW / unscaledW);

        pdfCanvas.style.width = Math.floor(unscaledW * displayScale) + "px";
        pdfCanvas.style.height = Math.floor(unscaledH * displayScale) + "px";
        viewport.style.overflow = "auto";
    } else if (previewZoomMode.startsWith("field:")) {
        // 氏名欄／金額欄のみを拡大表示（校正確認用）
        const fieldKey = previewZoomMode.split(":")[1];
        const rect = computeFieldRectPt(fieldKey);

        if (!rect) {
            // フィールド未設定時は fit 相当にフォールバック
            const containerW = Math.max(100, viewport.clientWidth - 24);
            const containerH = Math.max(100, viewport.clientHeight - 24);
            const scaleW = containerW / unscaledW;
            const scaleH = containerH / unscaledH;
            let displayScale = Math.min(scaleW, scaleH);
            if (!Number.isFinite(displayScale) || displayScale <= 0) displayScale = 0.5;

            pdfCanvas.style.width = Math.floor(unscaledW * displayScale) + "px";
            pdfCanvas.style.height = Math.floor(unscaledH * displayScale) + "px";
            viewport.style.overflow = "hidden";
            return;
        }

        const containerW = Math.max(100, viewport.clientWidth - 24);
        const containerH = Math.max(100, viewport.clientHeight - 24);
        const pxPerPt = unscaledW / mmToPt(paperSizeSettings.width);

        const pad = 12; // pt
        const padded = {
            left: rect.left - pad,
            top: rect.top - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2
        };

        let displayScale = Math.min(containerW / (padded.width * pxPerPt), containerH / (padded.height * pxPerPt));
        if (!Number.isFinite(displayScale) || displayScale <= 0) displayScale = 1;
        displayScale = Math.min(displayScale, 4.0);

        // pdfCanvasには transition: width/height 0.2s ease が設定されているため、
        // アニメーション途中でスクロール量を計算すると scrollHeight がまだ小さく scrollTop が正しく反映されない。
        // fieldモードではサイズ変更を即時反映させ、スクロール適用後に元のtransitionへ戻す。
        const prevTransition = pdfCanvas.style.transition;
        pdfCanvas.style.transition = "none";
        pdfCanvas.style.width = Math.floor(unscaledW * displayScale) + "px";
        pdfCanvas.style.height = Math.floor(unscaledH * displayScale) + "px";
        viewport.style.overflow = "auto";

        requestAnimationFrame(() => {
            viewport.scrollLeft = padded.left * pxPerPt * displayScale;
            viewport.scrollTop = padded.top * pxPerPt * displayScale;
            pdfCanvas.style.transition = prevTransition;
        });
    }
}

window.addEventListener("resize", applyPreviewDisplaySize);

// --- リアルタイムプレビュー更新（チラつき防止 ＆ 高画質内部解像度維持） ---
async function updatePreview() {
    updateAmountEcho();
    const pdfCanvas = document.getElementById("pdfCanvas");
    const previewPlaceholder = document.getElementById("previewPlaceholder");

    const gen = ++previewRenderGen;

    showStatus("PDF生成中...", true);
    const pdfBlob = await generatePDF(false);
    if (gen !== previewRenderGen) return;

    if (pdfBlob && pdfjsLib) {
        try {
            const arrayBuffer = await pdfBlob.arrayBuffer();
            const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
            const pdf = await loadingTask.promise;
            const page = await pdf.getPage(1);

            const unscaledViewport = page.getViewport({ scale: 1.0 });
            pdfCanvas._unscaledViewport = unscaledViewport;

            // 内部レンダリング解像度は高画質固定 (スケール 2.0 × devicePixelRatio)
            const renderScale = 2.0;
            const viewport = page.getViewport({ scale: renderScale });
            const outputScale = window.devicePixelRatio || 1;

            const offscreen = document.createElement("canvas");
            offscreen.width = Math.floor(viewport.width * outputScale);
            offscreen.height = Math.floor(viewport.height * outputScale);

            const offCtx = offscreen.getContext("2d");
            const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;

            const renderContext = {
                canvasContext: offCtx,
                transform: transform,
                viewport: viewport
            };

            await page.render(renderContext).promise;
            if (gen !== previewRenderGen) return;

            pdfCanvas.width = offscreen.width;
            pdfCanvas.height = offscreen.height;
            const mainCtx = pdfCanvas.getContext("2d");
            mainCtx.drawImage(offscreen, 0, 0);

            // 表示スタイルサイズを設定
            applyPreviewDisplaySize();

            pdfCanvas.style.display = "block";
            previewPlaceholder.style.display = "none";
            showStatus("プレビュー更新完了", false);
        } catch (error) {
            logError("PDF.js Render Error: " + error);
            showStatus("プレビュー表示エラー", false);
        }
    } else {
        if (!pdfBlob) {
            pdfCanvas.style.display = "none";
            previewPlaceholder.style.display = "flex";
        }
        // 起動処理の途中（初回セットアップ中など）に呼ばれることがあるため、
        // まだ準備できていない段階で「準備完了」と表示しない。
        if (isAppReady) showStatus("準備完了", false);
    }
}

// --- 金額の入力ミス防止（併記＋確認ダイアログ） ---
function getComposedAmount() {
    const amountSelect = document.getElementById("amountSelect");
    const amountInputEl = document.getElementById("amountInput");
    const raw = currentTemplate === "free"
        ? (amountInputEl ? amountInputEl.value.trim() : "")
        : (amountSelect ? amountSelect.value : (amountInputEl ? amountInputEl.value.trim() : ""));
    let full;
    if (currentTemplate === "10000en") full = `金${raw || "壱"}萬圓也`;
    else if (currentTemplate === "1000en") full = `金${raw || "壱"}阡圓也`;
    else full = raw;
    return { raw: raw, full: full, yen: parseKanjiNumber(full) };
}
function updateAmountEcho() {
    const el = document.getElementById("amountEcho");
    if (!el) return;
    const info = getComposedAmount();
    if (currentTemplate === "free") {
        if (info.yen > 0) {
            el.innerHTML = `内容: <b>${escapeHTML(info.full)}</b> ＝ <b>${info.yen.toLocaleString()}円</b>`;
            el.style.color = "#0369a1";
        } else {
            el.textContent = info.full ? `内容: ${info.full}` : "";
            el.style.color = "#64748b";
        }
    } else {
        el.innerHTML = `内容: <b>${escapeHTML(info.full)}</b> ＝ <b>${info.yen.toLocaleString()}円</b>`;
        el.style.color = "#0369a1";
    }
}
function confirmAmountBeforePrint() {
    const name = (document.getElementById("nameInput").value || "").trim();
    const info = getComposedAmount();
    if ((currentTemplate === "10000en" || currentTemplate === "1000en") && info.yen <= 0) {
        return confirm(`⚠ 金額が正しく認識できませんでした（${info.full}）。\nこのまま続けますか？`);
    }
    const yenStr = info.yen > 0 ? `（${info.yen.toLocaleString()}円）` : "";
    const msg = `この内容で印刷・登録します。よろしいですか？\n\n奉納者: ${name || "（未入力）"} 様\n金額/物品: ${info.full} ${yenStr}`;
    return confirm(msg);
}

// --- 印刷 / PDF保存アクション ---
// --- 印刷 / PDF保存アクション (v52 自動登録・重複警告・袋番号インクリメント連携) ---
async function printPDF() {
    const nameInput = document.getElementById("nameInput") ? document.getElementById("nameInput").value.trim() : "";
    if (!nameInput) {
        showToast("氏名を入力してから印刷してください", "error");
        return;
    }

    // 本日の重複登録チェック (F項目)
    if (checkDuplicateToday(nameInput)) {
        showDuplicateModal(nameInput, function(proceed) {
            if (proceed) {
                executePrintAndAutoSave();
            }
        });
        return;
    }

    await executePrintAndAutoSave();
}

async function executePrintAndAutoSave() {
    const nameInput = document.getElementById("nameInput") ? document.getElementById("nameInput").value.trim() : "";
    
    showStatus("印刷用データを準備中...", true);
    let pdfBlob = null;
    try {
        pdfBlob = await generatePDF(true);
    } catch (e) {
        console.error("PDF生成エラー:", e);
    }
    
    if (pdfBlob) {
        const pdfUrl = URL.createObjectURL(pdfBlob);
        const newWindow = window.open(pdfUrl, "_blank");
        if (newWindow) {
            let printCalled = false;
            const triggerPrint = () => {
                if (printCalled) return;
                printCalled = true;
                try { newWindow.print(); } catch (e) {}
            };
            newWindow.onload = triggerPrint;
            setTimeout(triggerPrint, 2000);
            showToast("印刷プレビューを別タブで開きました");
        } else {
            const link = document.createElement("a");
            link.href = pdfUrl;
            link.download = `奉納ビラ_${nameInput || "無題"}.pdf`;
            link.click();
            showToast("PDFファイルをダウンロードしました");
        }

        // 名簿へ自動登録 ＆ トースト ＆ 袋番号インクリメント (A/E項目)
        if (nameInput) {
            const savedRecord = await saveRecordSilent();
            if (savedRecord) {
                showToastWithAction("「" + nameInput + "」さんを名簿に登録しました", "取り消す", function() {
                    deleteRecordById(savedRecord.id);
                });
                incrementBagNo();
            }
        }
    } else {
        showToast("PDFの生成に失敗しました", "error");
    }
    showStatus("準備完了", false);
}

// --- 奉納袋番号（自動採番＋手修正） ---
function nextBagNumber() {
    let max = 0;
    for (const r of dbRecords) {
        const n = parseInt(r.bagNo, 10);
        if (!isNaN(n) && n > max) max = n;
    }
    return max + 1;
}
// フォームの番号欄に次の番号をセット（force=true で既存値も上書き）
function setDefaultBagNo(force) {
    const el = document.getElementById("bagNoInput");
    if (!el) return;
    if (force || !el.value.trim()) el.value = nextBagNumber();
}

// --- データベース（履歴登録・表示）処理 ---
function saveRecord(showNotice = true) {
    const nameInput = document.getElementById("nameInput").value.trim();
    const amountSelect = document.getElementById("amountSelect");
    let amountInput = currentTemplate === "free" ? document.getElementById("amountInput").value.trim() : (amountSelect ? amountSelect.value : document.getElementById("amountInput").value.trim());
    const bagNoInput = (document.getElementById("bagNoInput") ? document.getElementById("bagNoInput").value : "").trim();
    const addressInput = (document.getElementById("addressInput") ? document.getElementById("addressInput").value : "").trim();
    const kanaInput = (document.getElementById("kanaInput") ? document.getElementById("kanaInput").value : "").trim();

    const emptyCheck = document.getElementById("emptyCheck");
    const isEmpty = !!(emptyCheck && emptyCheck.checked && amountInput !== "");

    if (!nameInput) {
        if (showNotice) showToast("氏名を入力してください", "error");
        return;
    }

    let dbAmount = amountInput;
    if (currentTemplate === "10000en") {
        dbAmount = `金${amountInput || "壱"}萬圓也`;
    } else if (currentTemplate === "1000en") {
        dbAmount = `金${amountInput || "壱"}阡圓也`;
    }
    // 「空」タグは金額文字列の末尾に付与（文中への混入を防ぐ）
    if (isEmpty) {
        dbAmount = stripEmptyTag(dbAmount) + " [空]";
    }

    // 重複チェック (同一の氏名かつ金額かつテンプレートが30秒以内にあればスキップ)
    // ※ 保存形式(dbAmount)同士で比較する
    const isDuplicate = dbRecords.some(r => {
        const rd = parseFlexibleDate(r.date);
        return r.name === nameInput &&
            r.amount === dbAmount &&
            r.template === currentTemplate &&
            rd && (Date.now() - rd.getTime() < 30000);
    });
    if (isDuplicate && !editingRecordId) return;

    if (editingRecordId) {
        const idx = dbRecords.findIndex(r => r.id === editingRecordId);
        if (idx !== -1) {
            dbRecords[idx].name = nameInput;
            dbRecords[idx].amount = dbAmount;
            dbRecords[idx].template = currentTemplate;
            dbRecords[idx].bagNo = bagNoInput;
            dbRecords[idx].address = addressInput;
            dbRecords[idx].kana = kanaInput;
            dbRecords[idx].sync = "pending";
            dbRecords[idx].date = new Date().toISOString();
            
            idbPutRecord(dbRecords[idx]).then(() => {
                renderTable();
                pushPendingRecords();
            });
        }
        
        editingRecordId = null;
        const btn = document.getElementById("btnRegister");
        if (btn) btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> 登録';
        const cancelBtn = document.getElementById("btnCancelEdit");
        if (cancelBtn) cancelBtn.style.display = "none";
        
        if (showNotice) showToast("名簿のデータを更新しました！");
    } else {
        const newRecord = {
            id: "rec_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
            date: new Date().toISOString(),
            template: currentTemplate,
            name: nameInput,
            amount: dbAmount,
            bagNo: bagNoInput,
            address: addressInput,
            kana: kanaInput,
            sync: "pending" // IndexedDB Outbox パターン
        };

        dbRecords.unshift(newRecord); // メモリ上(UI表示用)に追加
        setDefaultBagNo(true); // 次の番号へ自動で繰り上げ
        incrementAutoBagSeq(); // ⚡自動連番カウントアップ
        
        // IndexedDBへ保存し、同期を試行する
        idbPutRecord(newRecord).then(() => {
            renderTable();
            pushPendingRecords();
        });
    }
    
    if (showNotice) {
        showToast("名簿に正常に登録しました！");
    }
}

// 印刷成功時に自動で呼ぶサイレント名簿登録関数 (A項目)
async function saveRecordSilent() {
    const nameInput = document.getElementById("nameInput") ? document.getElementById("nameInput").value.trim() : "";
    if (!nameInput) return null;

    const bagNoInput = document.getElementById("bagNoInput") ? document.getElementById("bagNoInput").value.trim() : "";
    const addressInput = document.getElementById("addressInput") ? document.getElementById("addressInput").value.trim() : "";
    const kanaInput = document.getElementById("kanaInput") ? document.getElementById("kanaInput").value.trim() : "";
    const rawAmount = document.getElementById("amountInput") ? document.getElementById("amountInput").value.trim() : "";
    const emptyCheck = document.getElementById("emptyCheck") ? document.getElementById("emptyCheck").checked : false;

    let dbAmount = typeof getFormattedAmountString === "function" ? getFormattedAmountString() : rawAmount;
    if (emptyCheck) {
        if (dbAmount) {
            dbAmount = dbAmount + " [空]";
        } else if (rawAmount) {
            dbAmount = rawAmount + " [空]";
        } else {
            dbAmount = "[空]";
        }
    } else if (!dbAmount && rawAmount) {
        dbAmount = rawAmount;
    }

    const newRecord = {
        id: "rec_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
        date: new Date().toISOString(),
        timestamp: new Date().toISOString(),
        template: currentTemplate,
        name: nameInput,
        amount: dbAmount,
        bagNo: bagNoInput || getNextBagNo().toString(),
        address: addressInput,
        kana: kanaInput,
        sync: "pending"
    };

    dbRecords.unshift(newRecord);

    try {
        await idbPutRecord(newRecord);
        renderTable();
        pushPendingRecords();
    } catch (e) {
        console.warn("サイレント名簿登録エラー:", e);
    }

    return newRecord;
}

async function deleteRecord(id) {
    if (confirm("このレコードを名簿から削除しますか？")) {
        const record = dbRecords.find(r => r.id === id);
        dbRecords = dbRecords.filter(r => r.id !== id);

        if (record) {
            // 墓標(tombstone)方式: すぐに物理削除せず「削除待ち」として残す。
            // オフラインで削除してもオンライン復帰時にクラウドへ削除が伝搬され、
            // 「名簿フル復元」で削除済みデータが蘇る問題を防ぐ。
            record.sync = "pending_delete";
            await idbPutRecord(record);
        } else {
            await idbDeleteRecord(id);
        }

        renderTable();
        showToast("名簿から削除しました");

        // クラウドへの削除伝搬を試行（オフライン時は復帰時に自動送信される）
        pushPendingRecords();
    }
}

// --- 名簿アイテムのフォーム呼び出し ---
function loadRecordToForm(id) {
    const record = dbRecords.find(r => r.id === id);
    if (!record) return;

    // 1. テンプレートの変更
    selectTemplate(record.template);
    
    // 2. フォーム入力値の設定（[空]タグは剥がしてから復元する）
    document.getElementById("nameInput").value = record.name;
    if (document.getElementById("bagNoInput")) document.getElementById("bagNoInput").value = (record.bagNo || "").toString();
    if (document.getElementById("addressInput")) document.getElementById("addressInput").value = record.address || "";
    if (document.getElementById("kanaInput")) document.getElementById("kanaInput").value = String(record.kana ?? "");

    const val = parseAmountForForm(record); // "金五萬圓也 [空]" → "五" など
    if (record.template === "10000en" || record.template === "1000en") {
        const amountSelect = document.getElementById("amountSelect");
        if (amountSelect) amountSelect.value = val;
        document.getElementById("amountInput").value = val;
    } else {
        document.getElementById("amountInput").value = val;
    }

    // 「空」チェックボックスの状態も復元
    const emptyCheck = document.getElementById("emptyCheck");
    if (emptyCheck) emptyCheck.checked = hasEmptyTag(record.amount);

    editingRecordId = id;
    const btn = document.getElementById("btnRegister");
    if (btn) btn.innerHTML = '<i class="fa-solid fa-pen"></i> 更新';
    
    let cancelBtn = document.getElementById("btnCancelEdit");
    if (!cancelBtn && btn) {
        cancelBtn = document.createElement("button");
        cancelBtn.id = "btnCancelEdit";
        cancelBtn.className = "btn btn-secondary";
        cancelBtn.style.marginLeft = "10px";
        cancelBtn.innerHTML = '<i class="fa-solid fa-times"></i> キャンセル';
        cancelBtn.onclick = () => {
            clearForm();
        };
        btn.parentNode.insertBefore(cancelBtn, btn.nextSibling);
    } else if (cancelBtn) {
        cancelBtn.style.display = "inline-block";
    }

    // 3. プレビューの再描画
    updatePreview();
    showToast("名簿データを読み込みました。修正後「更新」を押してください。");
}

// --- 名簿テーブルのレンダリング (v55 6列＆エラーガード版) ---
function renderTable() {
    updateDashboardStats();
    const tbody = document.getElementById("recordsTbody");
    if (!tbody) {
        console.error("renderTable: tbody not found (recordsTbody)");
        return;
    }

    // 再描画前に選択中のレコードIDを退避し、行の再生成後も選択状態を維持する。
    // フィルタや表示件数の都合で再描画後に存在しない行のIDは、単に再生成されないため
    // 自然と選択から外れる（見えない行が選択されたままにはならない）。
    const checkedIdsBeforeRender = new Set(
        Array.from(document.querySelectorAll('.record-checkbox:checked')).map(cb => cb.value)
    );

    tbody.innerHTML = "";

    // 明らかな壊れた旧データをスキップ
    let validRecords = dbRecords.filter(r => {
        const nameStr = String(r.name ?? "").trim();
        return !(nameStr.startsWith("¥") || nameStr.startsWith("\\") || nameStr.startsWith("合計") || nameStr.startsWith("物品まとめ"));
    });

    // 1. 検索フィルタリング (かな正規化・全半角無視部分一致)
    const normSearch = kanaNormalize(dbSearchQuery);
    if (normSearch) {
        validRecords = validRecords.filter(r => {
            const nameNorm = kanaNormalize(r.name);
            const addrNorm = kanaNormalize(r.address);
            const amtNorm  = kanaNormalize(r.amount);
            const bagNorm  = kanaNormalize(r.bagNo || r.bag_no);
            const kanaNorm = kanaNormalize(r.kana);

            return nameNorm.includes(normSearch) ||
                   addrNorm.includes(normSearch) ||
                   amtNorm.includes(normSearch)  ||
                   bagNorm.includes(normSearch)  ||
                   kanaNorm.includes(normSearch);
        });
    }

    // 2. 絞り込みチップフィルタリング
    if (currentFilterChip !== "all") {
        validRecords = validRecords.filter(r => {
            const amtStr = String(r.amount ?? "").trim();
            const hasEmpty = amtStr.includes('[空]') || amtStr.includes('［空］') || amtStr.includes('空');
            const parsedVal = parseKanjiNumber(amtStr);

            if (currentFilterChip === "empty") {
                return hasEmpty;
            }
            if (currentFilterChip === "item") {
                return (parsedVal === 0 && amtStr !== "") || hasEmpty;
            }
            if (currentFilterChip === "3000") {
                return parsedVal === 3000;
            }
            if (currentFilterChip === "5000") {
                return parsedVal === 5000;
            }
            if (currentFilterChip === "10000") {
                return parsedVal === 10000;
            }
            if (currentFilterChip === "other_money") {
                return parsedVal > 0 && parsedVal !== 3000 && parsedVal !== 5000 && parsedVal !== 10000 && !hasEmpty;
            }
            return true;
        });
    }

    // 3. 並び替え (デフォルト: 日時の新しい順 date_desc)
    const dateVal = r => { const d = recordDate(r); return d ? d.getTime() : 0; };
    const bagVal  = r => { const b = parseInt(r.bagNo || r.bag_no || 0, 10); return isNaN(b) ? 0 : b; };
    const amtVal  = r => parseKanjiNumber(r.amount);

    validRecords.sort((a, b) => {
        let cmp = 0;
        if (currentSortField === "date") {
            cmp = dateVal(a) - dateVal(b);
        } else if (currentSortField === "bag") {
            cmp = bagVal(a) - bagVal(b);
        } else if (currentSortField === "name") {
            cmp = String(a.name ?? "").localeCompare(String(b.name ?? ""), "ja");
        } else if (currentSortField === "amount") {
            cmp = amtVal(a) - amtVal(b);
        }
        return currentSortOrder === "asc" ? cmp : -cmp;
    });

    if (validRecords.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="no-data" style="text-align: center; padding: 24px; color: #94a3b8;">条件に一致する名簿データがありません。</td></tr>`;
        const btnMore = document.getElementById("btnLoadMore");
        if (btnMore) btnMore.style.display = "none";
        const selectAllCb = document.getElementById("selectAllCheckbox");
        if (selectAllCb) selectAllCb.checked = false;
        updateBatchCount();
        return;
    }

    // 4. 50件パジネーション (6列構成)
    const displayRecords = validRecords.slice(0, recordsDisplayLimit);

    displayRecords.forEach(r => {
        const tr = document.createElement("tr");

        const dateStr = formatDateForDisplay(r.timestamp || r.date);
        const bagNoStr = String(r.bagNo || r.bag_no || "");
        const amountStr = String(r.amount ?? "");
        const addressStr = String(r.address ?? "");

        const isChecked = checkedIdsBeforeRender.has(String(r.id));

        tr.innerHTML = `
            <td style="padding: 10px; border-bottom: 1px solid #f1f5f9; text-align: center;"><input type="checkbox" class="record-checkbox" value="${escapeHTML(String(r.id))}" ${isChecked ? "checked" : ""} onchange="updateBatchCount()"></td>
            <td data-label="日時" style="white-space: nowrap; font-size: 13px; padding: 10px; border-bottom: 1px solid #f1f5f9;">${escapeHTML(dateStr)}</td>
            <td data-label="袋番号" style="font-weight: 600; padding: 10px; border-bottom: 1px solid #f1f5f9;">${escapeHTML(bagNoStr)}</td>
            <td data-label="氏名" style="font-weight: bold; color: #1e293b; padding: 10px; border-bottom: 1px solid #f1f5f9;">${escapeHTML(String(r.name ?? ""))}</td>
            <td data-label="住所" style="font-size: 13px; color: #475569; padding: 10px; border-bottom: 1px solid #f1f5f9;">${escapeHTML(addressStr)}</td>
            <td data-label="金額/物品" style="padding: 10px; border-bottom: 1px solid #f1f5f9;">${escapeHTML(amountStr)}</td>
            <td data-label="操作" style="text-align: center; padding: 10px; border-bottom: 1px solid #f1f5f9; position: sticky; right: 0; background: #ffffff;">
                <div class="action-btns" style="white-space: nowrap; display: flex; gap: 4px; justify-content: center;">
                    <button class="btn-table btn-table-edit" style="padding: 4px 8px; font-size: 12px; background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; border-radius: 4px; cursor: pointer;">
                        <i class="fa-solid fa-arrows-spin"></i> 呼出
                    </button>
                    <button class="btn-table btn-table-reprint" data-reprint-id="${escapeHTML(String(r.id))}" title="現在のデザイン設定で再生成します" style="padding: 4px 8px; font-size: 12px; background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; border-radius: 4px; cursor: pointer;">
                        <i class="fa-solid fa-print"></i> 再印刷
                    </button>
                    <button class="btn-table btn-table-del" style="padding: 4px 8px; font-size: 12px; background: #fff5f5; color: #b91c1c; border: 1px solid #fca5a5; border-radius: 4px; cursor: pointer;">
                        <i class="fa-solid fa-trash-can"></i> 削除
                    </button>
                </div>
            </td>
        `;
        tr.querySelector(".btn-table-edit").addEventListener("click", () => loadRecordToForm(r.id));
        tr.querySelector(".btn-table-del").addEventListener("click", () => deleteRecordById(r.id));
        tbody.appendChild(tr);
    });

    // 「さらに表示」ボタン制御
    const btnMore = document.getElementById("btnLoadMore");
    const remainingEl = document.getElementById("remainingCount");
    if (btnMore) {
        if (validRecords.length > recordsDisplayLimit) {
            btnMore.style.display = "block";
            if (remainingEl) remainingEl.textContent = (validRecords.length - recordsDisplayLimit).toLocaleString();
        } else {
            btnMore.style.display = "none";
        }
    }

    // ヘッダーの全選択チェックは「表示中の全行が選択されているか」で状態を決める
    const selectAllCb = document.getElementById("selectAllCheckbox");
    if (selectAllCb) {
        const rowCheckboxes = document.querySelectorAll('.record-checkbox');
        selectAllCb.checked = rowCheckboxes.length > 0 &&
            document.querySelectorAll('.record-checkbox:checked').length === rowCheckboxes.length;
    }
    updateBatchCount();
}

// 再印刷ボタンのイベント委譲（行ごとにaddEventListenerせず、tbodyに1度だけ張る）
(function setupReprintDelegation() {
    document.addEventListener("DOMContentLoaded", () => {
        const tbody = document.getElementById("recordsTbody");
        if (!tbody) return;
        tbody.addEventListener("click", (e) => {
            const btn = e.target.closest("[data-reprint-id]");
            if (!btn) return;
            reprintRecord(btn.getAttribute("data-reprint-id"));
        });
    });
})();

// 名簿からの再印刷: 当時のdesignSettingsは保存していないため、現在のデザイン設定で再生成する
// （designSettingsは端末・プリンタごとのキャリブレーション値であり、レコードごとの意図ではないため）
async function reprintRecord(id) {
    const record = dbRecords.find(r => String(r.id) === String(id));
    if (!record) {
        showToast("レコードが見つかりません", "error");
        return;
    }

    showStatus("再印刷用のPDFを生成中...", true);
    try {
        const blob = await generatePDF(true, {
            template: record.template,
            name: record.name,
            amount: parseAmountForForm(record)
        });
        if (!blob) {
            showToast("PDFの生成に失敗しました", "error");
            showStatus("準備完了", false);
            return;
        }
        const filename = `奉納ビラ_${record.name || "無題"}.pdf`;
        openPdfForPrint(blob, filename);
        showToast(`「${record.name}」を再印刷します`);
        showStatus("再印刷準備完了", false);
    } catch (e) {
        console.error("再印刷エラー:", e);
        showToast("再印刷に失敗しました: " + e.message, "error");
        showStatus("準備完了", false);
    }
}

// --- CSVエクスポート機能 ---
function buildCsvContent(records) {
    let csvContent = "\ufeff"; // Excelでの文字化けを防ぐためのBOM付きUTF-8
    csvContent += "日時,テンプレート種類,奉納袋番号,奉納者氏名,読み仮名,住所,金額/物品名\n";

    records.forEach(r => {
        const dateStr = formatDateForDisplay(r.date);
        const templateStr = r.template === "10000en" ? "萬圓用" : (r.template === "1000en" ? "阡圓用" : "フリー用");

        // カンマやダブルクォーテーションのエスケープ
        const escapedName = `"${(r.name || "").replace(/"/g, '""')}"`;
        const escapedKana = `"${String(r.kana ?? "").replace(/"/g, '""')}"`;
        const escapedAmount = `"${(r.amount || "").replace(/"/g, '""')}"`;
        const escapedBagNo = `"${(r.bagNo || "").toString().replace(/"/g, '""')}"`;
        const escapedAddress = `"${(r.address || "").replace(/"/g, '""')}"`;

        csvContent += `${dateStr},${templateStr},${escapedBagNo},${escapedName},${escapedKana},${escapedAddress},${escapedAmount}\n`;
    });
    return csvContent;
}

function downloadCsv(csvContent, filename) {
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function exportCSV() {
    if (dbRecords.length === 0) {
        showToast("エクスポートするデータがありません", "error");
        return;
    }
    downloadCsv(buildCsvContent(dbRecords), `奉納名簿履歴_${new Date().toISOString().slice(0,10)}.csv`);
    showToast("名簿データをCSVとして出力しました！");
}

// 選択レコードのみCSV出力（従来はボタンだけ存在し未実装だった）
function batchExportCSV() {
    const selectedIds = Array.from(document.querySelectorAll('.record-checkbox:checked')).map(cb => cb.value);
    const selected = dbRecords.filter(r => selectedIds.includes(r.id));
    if (selected.length === 0) {
        showToast("エクスポートするレコードを選択してください", "error");
        return;
    }
    downloadCsv(buildCsvContent(selected), `奉納名簿選択分_${selected.length}件_${new Date().toISOString().slice(0,10)}.csv`);
    showToast(`選択した${selected.length}件をCSVとして出力しました！`);
}

// 選択レコードの一括削除（従来はボタンだけ存在し未実装だった）
async function batchDeleteRecords() {
    const selectedIds = Array.from(document.querySelectorAll('.record-checkbox:checked')).map(cb => cb.value);
    if (selectedIds.length === 0) {
        showToast("削除するレコードを選択してください", "error");
        return;
    }
    if (!confirm(`選択した ${selectedIds.length}件 のレコードを名簿から削除しますか？`)) return;

    for (const id of selectedIds) {
        const record = dbRecords.find(r => r.id === id);
        if (record) {
            // 個別削除と同じく墓標方式でクラウドへも削除を伝搬する
            record.sync = "pending_delete";
            await idbPutRecord(record);
        }
    }
    dbRecords = dbRecords.filter(r => !selectedIds.includes(r.id));
    renderTable();
    updateBatchCount();
    showToast(`${selectedIds.length}件を名簿から削除しました`);
    pushPendingRecords();
}

// #9 スマホ用PDF保存（直接ダウンロード）
async function mobilePrintPDF() {
    const nameInput = document.getElementById("nameInput").value.trim();
    if (!nameInput) {
        showToast("氏名を入力してから保存してください", "error");
        return;
    }
    if (!confirmAmountBeforePrint()) return;
    showStatus("PDF生成中...", true);
    const pdfBlob = await generatePDF(true);
    
    if (pdfBlob) {
        const pdfUrl = URL.createObjectURL(pdfBlob);
        const link = document.createElement("a");
        link.href = pdfUrl;
        link.download = `奉納ビラ_${nameInput}.pdf`;
        link.click();
        // 即時revokeするとダウンロード開始前にURLが無効化されるブラウザがあるため遅延させる
        setTimeout(() => URL.revokeObjectURL(pdfUrl), 10000);
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
    if (!confirmAmountBeforePrint()) return;

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
// 旧実装は存在しない .calib-btn を対象にしていたため機能していなかった。
// 実在する調整ボタン（onclickがadjust系）を対象に、pointerイベントで実装し直した。
// preventDefaultしないため通常のタップ（単発クリック）はそのまま動作する。
(function setupLongPressRepeat() {
    document.addEventListener("DOMContentLoaded", () => {
        const buttons = document.querySelectorAll('button[onclick^="adjust"]');

        buttons.forEach(btn => {
            let intervalId = null;
            let timeoutId = null;

            const startRepeat = () => {
                stopRepeat();
                // 400ms保持でリピート開始（初回操作は通常のclickが担う）
                timeoutId = setTimeout(() => {
                    intervalId = setInterval(() => {
                        btn.dataset.lpRepeating = "1";
                        btn.click();
                    }, 80);
                }, 400);
            };

            const stopRepeat = () => {
                clearTimeout(timeoutId);
                clearInterval(intervalId);
                intervalId = null;
                timeoutId = null;
                // 直後のtrusted click抑止のため少しだけフラグを残し、その後必ず掃除する
                // （pointerleave等でclickが発火しなかった場合にフラグが残り続けるのを防ぐ）
                if (btn.dataset.lpRepeating) {
                    setTimeout(() => { delete btn.dataset.lpRepeating; }, 300);
                }
            };

            btn.addEventListener("pointerdown", startRepeat);
            btn.addEventListener("pointerup", stopRepeat);
            btn.addEventListener("pointercancel", stopRepeat);
            btn.addEventListener("pointerleave", stopRepeat);
            // 長押し中のスクロールによる誤操作を防ぐ
            btn.style.touchAction = "manipulation";
        });

        // リピート実行後の指離しで発火する「余分な1回分のclick」をキャプチャ段階で抑止
        document.addEventListener("click", (e) => {
            const btn = e.target.closest && e.target.closest('button[onclick^="adjust"]');
            if (btn && btn.dataset.lpRepeating) {
                // リピートによる合成click（isTrusted=false）は素通しし、
                // 実際のポインタ操作由来のclickだけを1回無効化する
                if (e.isTrusted) {
                    delete btn.dataset.lpRepeating;
                    e.stopPropagation();
                    e.preventDefault();
                }
            }
        }, true);
    });
})();

// --- フォームのクリア ---
function clearForm() {
    editingRecordId = null;
    const btn = document.getElementById("btnRegister");
    if (btn) btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> 登録';
    const cancelBtn = document.getElementById("btnCancelEdit");
    if (cancelBtn) cancelBtn.style.display = "none";
    
    document.getElementById("nameInput").value = "";
    document.getElementById("amountInput").value = "";
    if (document.getElementById("addressInput")) document.getElementById("addressInput").value = "";
    if (document.getElementById("kanaInput")) document.getElementById("kanaInput").value = "";
    setDefaultBagNo(true);
    const amountSelect = document.getElementById("amountSelect");
    if (amountSelect) amountSelect.value = "壱";
    const emptyCheck = document.getElementById("emptyCheck");
    if (emptyCheck) emptyCheck.checked = false;
    updatePreview();
    showToast("フォームをクリアしました");
}

// --- HTMLエスケープ (型安全＆表記揺れ吸収版) ---
function escapeHTML(str) {
    if (str === null || str === undefined) return "";
    return String(str)
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
        const fetchUrl = withAuthParam(gasUrl + (gasUrl.includes("?") ? "&" : "?") + "t=" + Date.now());
        const response = await fetch(fetchUrl, { method: "GET", mode: "cors" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (data.error) {
            const err = new Error(data.error);
            err.code = data.code || "";
            throw err;
        }

        const rawNames = data.names || [
            ...(data["10000en_names"] || []),
            ...(data["1000en_names"] || []),
            ...(data["free_names"] || [])
        ];
        
        const cloudData = {
            names: [...new Set(rawNames)],
            items: data.items || data["free_items"] || []
        };
        
        await idbKvSet("cloud_suggests", cloudData);
        await buildSuggestData(); // 再構築
        await markSynced();

        if (!isBackground) {
            const totalCount = cloudData.names.length + cloudData.items.length;
            showToast(`スプレッドシートからサジェストデータ ${totalCount}件を同期しました`);
        }
    } catch (e) {
        console.error("GAS同期エラー:", e);
        if (e.code === "unauthorized") handleGasAuthError();
        if (!isBackground) showToast("サジェストデータの同期に失敗しました: " + e.message, "error");
    } finally {
        if (btn) {
            btn.innerHTML = '<i class="fa-solid fa-rotate"></i> サジェスト同期';
            btn.style.opacity = "1";
            btn.disabled = false;
        }
    }
}

// --- IndexedDB対応 サジェスト構築 (ローカル優先) ---
async function buildSuggestData() {
    // DB名簿から抽出
    const all = await idbGetAllRecords();
    const names = all.map(r => String(r.name ?? "")).filter(Boolean);
    const items = all.map(r => String(r.amount ?? "")).filter(Boolean);
    
    // クラウドキャッシュから抽出
    const cloud = await idbKvGet("cloud_suggests") || { names: [], items: [] };
    const cloudNames = (cloud.names || []).map(v => String(v ?? "")).filter(Boolean);
    const cloudItems = (cloud.items || []).map(v => String(v ?? "")).filter(Boolean);
    
    suggestData = {
        names: [...new Set([...names, ...cloudNames])],
        items: [...new Set([...items, ...cloudItems])]
    };
    renderSheetList();
}

// 履歴データをスプレッドシートへ自動追記（Outbox同期）
// - 登録/更新 (sync: "pending") と 削除 (sync: "pending_delete") の両方を送信する
// - CORSで応答を検証し、GASが success を返した場合のみ同期済みにする
//   （旧実装の no-cors は失敗検知ができず、静かなデータ欠損の原因だった）
let isPushingPendings = false; // 多重実行ガード (online/visibilitychange の同時発火対策)
async function pushPendingRecords() {
    if (!navigator.onLine || !gasUrl || isPushingPendings || gasAuthBlocked || !gasSettingsLoaded) return;
    isPushingPendings = true;

    try {
        const pendings = await idbGetPendingRecords();
        const pendingDeletes = await idbGetPendingDeletes();

        updateSyncBadge(pendings.length + pendingDeletes.length);
        if (pendings.length === 0 && pendingDeletes.length === 0) return;

        console.log(`未送信データ ${pendings.length}件 / 削除待ち ${pendingDeletes.length}件 を同期開始...`);
        const token = await idbKvGet("api_token") || "GUEST_TOKEN_" + Math.random().toString(36).substr(2);
        await idbKvSet("api_token", token);
        let successCount = 0;

        // 1. 登録・更新の送信
        for (const record of pendings) {
            let templateTypeStr = "フリー用";
            if (record.template === "10000en") templateTypeStr = "萬圓用";
            else if (record.template === "1000en") templateTypeStr = "阡圓用";

            const recDate = parseFlexibleDate(record.date);
            const payload = {
                id: record.id,
                timestamp: (recDate || new Date()).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }),
                templateType: templateTypeStr,
                name: record.name,
                amount: record.amount,
                bagNo: record.bagNo || "",
                address: record.address || "",
                kana: record.kana || "",
                token: token
            };

            try {
                await postToGas(payload); // success応答を確認できた場合のみ次へ進む
                record.sync = "synced";
                await idbPutRecord(record);

                const memRec = dbRecords.find(r => r.id === record.id);
                if (memRec) memRec.sync = "synced";
                successCount++;
            } catch (e) {
                console.warn("GAS同期に失敗しました。レコードは未送信のまま保持し、以降は中断します:", e);
                if (e.code === "unauthorized") { handleGasAuthError(); break; }
                break;
            }
        }

        // 2. 削除（墓標）の送信 — 成功したらローカルから物理削除
        for (const record of pendingDeletes) {
            try {
                await postToGas({ id: record.id, action: "delete", token: token });
                await idbDeleteRecord(record.id);
                successCount++;
            } catch (e) {
                console.warn("GAS削除同期に失敗しました。墓標は保持し、以降は中断します:", e);
                if (e.code === "unauthorized") { handleGasAuthError(); break; }
                break;
            }
        }

        const remaining = await idbGetPendingRecords();
        const remainingDeletes = await idbGetPendingDeletes();
        updateSyncBadge(remaining.length + remainingDeletes.length);
        renderTable(); // バッジ表示などを更新
        if (successCount > 0) await markSynced();
    } finally {
        isPushingPendings = false;
    }
}

// GAS認証エラー発生時の処理：以降の同期を止め、トークン修正を促す
function handleGasAuthError() {
    gasAuthBlocked = true;
    showToastWithAction("スプレッドシートの認証に失敗しました。アクセストークンを確認してください", "設定を開く", () => {
        openSettingsAndFocusToken();
    }, 8000);
    showStatus("同期停止中（認証エラー）", false);
}

// 設定アコーディオンを開いてトークン入力欄にフォーカスする
function openSettingsAndFocusToken() {
    const accordion = document.getElementById("gasAccordion");
    const arrow = document.getElementById("gasAccordionArrow");
    if (accordion && !accordion.classList.contains("open")) {
        accordion.classList.add("open");
        if (arrow) arrow.className = "fa-solid fa-chevron-up";
    }
    const tokenInput = document.getElementById("gasTokenInput");
    if (tokenInput) {
        tokenInput.focus();
        tokenInput.scrollIntoView({ behavior: "smooth", block: "center" });
    }
}

// 未送信バッジの更新
function updateSyncBadge(count) {
    let badge = document.getElementById("offlineQueueBadge");
    
    if (count === 0) {
        if (badge) badge.style.display = "none";
        return;
    }
    
    if (!badge) {
        badge = document.createElement("div");
        badge.id = "offlineQueueBadge";
        badge.style.cssText = "display: inline-flex; align-items: center; gap: 6px; font-size: 12px; background: #fef3c7; color: #d97706; padding: 4px 10px; border-radius: 20px; border: 1px solid #fde68a; cursor: pointer; font-weight: 600;";
        badge.title = "クリックして未送信データを確認・送信";
        badge.onclick = () => {
            openQueueModal();
        };
        const syncBar = document.getElementById("syncStatusBar");
        const header = document.querySelector("header");
        if (syncBar) syncBar.appendChild(badge);
        else if (header) header.appendChild(badge);
    }

    badge.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> 未送信 ${count}件`;
    badge.style.display = "inline-flex";
}

// 最終同期時刻の記録（成功時のみ呼ぶこと。失敗時に呼ぶと表示の意味が壊れる）
async function markSynced() {
    await idbKvSet("last_sync_at", new Date().toISOString());
    renderSyncStatus();
}

// 相対時刻表示（60秒未満→たった今 / 60分未満→N分前 / 24時間未満→N時間前 / それ以上→M/D HH:mm）
function formatRelativeTime(iso) {
    const date = new Date(iso);
    if (isNaN(date.getTime())) return "--";
    const diffMs = Date.now() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return "たった今";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}分前`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}時間前`;
    const m = date.getMonth() + 1;
    const d = date.getDate();
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    return `${m}/${d} ${hh}:${mm}`;
}

// 同期ステータス表示の更新（最終同期時刻・未送信件数・オフライン表示）
async function renderSyncStatus() {
    const syncLastAt = document.getElementById("syncLastAt");
    const syncPendingCount = document.getElementById("syncPendingCount");

    if (syncLastAt) {
        const lastSyncAt = await idbKvGet("last_sync_at");
        const offlinePrefix = !navigator.onLine ? '<span style="color:#dc2626;font-weight:600;">オフライン</span> ' : "";
        if (lastSyncAt) {
            syncLastAt.innerHTML = offlinePrefix + "最終同期: " + formatRelativeTime(lastSyncAt);
            syncLastAt.title = new Date(lastSyncAt).toLocaleString("ja-JP");
        } else {
            syncLastAt.innerHTML = offlinePrefix + "最終同期: --";
            syncLastAt.title = "";
        }
    }

    if (syncPendingCount) {
        try {
            const [pendings, pendingDeletes] = await Promise.all([idbGetPendingRecords(), idbGetPendingDeletes()]);
            const total = pendings.length + pendingDeletes.length;
            if (total > 0) {
                syncPendingCount.textContent = `未送信 ${total}件`;
                syncPendingCount.style.display = "inline";
            } else {
                syncPendingCount.style.display = "none";
            }
        } catch (e) {
            syncPendingCount.style.display = "none";
        }
    }
}

// イベントリスナー登録 (オンライン復帰、表示時)
window.addEventListener("online", () => {
    showToast("オンラインに復帰しました。未送信データを同期します。");
    pushPendingRecords();
    renderSyncStatus();
});
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        pushPendingRecords();
        buildSuggestData(); // 復帰時にサジェストも再構築
    }
});

// ==========================================
// バックアップ・復元
// ==========================================
async function exportBackupData() {
    try {
        const records = await idbGetAllRecords();
        const data = {
            version: 1,
            date: new Date().toISOString(),
            records: records
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `honou_backup_${new Date().getTime()}.json`;
        a.click();
        showToast("バックアップデータを保存しました");
    } catch (e) {
        showToast("バックアップ失敗: " + e.message, "error");
    }
}

async function importBackupData(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!data.records || !Array.isArray(data.records)) throw new Error("無効なフォーマット");
        
        for (const r of data.records) {
            await idbPutRecord(r);
        }
        await loadDbRecords();
        renderTable();
        showToast(`バックアップから ${data.records.length}件のデータを読み込みました`);
    } catch (err) {
        showToast("読み込み失敗: " + err.message, "error");
    }
    e.target.value = "";
}

async function restoreFromGAS() {
    if (!gasUrl) {
        showToast("GASのURLを設定してください", "error");
        return;
    }
    if (!confirm("クラウド（スプレッドシート）から最新の名簿全件を復元します。\n端末のローカルデータを全クリアし、スプレッドシートの正解データで完全上書き同期します。よろしいですか？")) return;
    
    const btn = document.getElementById("btnRestoreGAS");
    if (btn) btn.innerHTML = "復元中...";
    try {
        const fetchUrl = withAuthParam(gasUrl + (gasUrl.includes("?") ? "&" : "?") + "mode=restore&t=" + Date.now());
        const response = await fetch(fetchUrl);
        const data = await response.json();
        if (data.error) {
            const err = new Error(data.error);
            err.code = data.code || "";
            throw err;
        }

        const records = data.records || [];

        // ガード1: スプレッドシートから0件が返った場合、シート名変更や空シートで
        // ローカルの名簿を全消失させる事故を防ぐため確認する
        if (records.length === 0 && dbRecords.length > 0) {
            const proceedEmpty = confirm(`スプレッドシートから0件が返りました。このまま実行するとローカルの名簿 ${dbRecords.length}件がすべて消えます。続行しますか？`);
            if (!proceedEmpty) {
                showToast("復元を中止しました", "error");
                return;
            }
        }

        // ガード2: スプレッドシートに「読み仮名」列が無い場合、GAS側は kana: "" を返すため、
        // 端末に入力済みの読み仮名が全件消えてしまう。事前に警告する
        const localKanaCount = dbRecords.filter(r => String(r.kana || "").trim() !== "").length;
        const gasHasAnyKana = records.some(r => String(r.kana ?? "").trim() !== "");
        if (localKanaCount > 0 && !gasHasAnyKana) {
            const proceedKana = confirm(`スプレッドシートに『読み仮名』列が無いため、この端末に入力済みの読み仮名 ${localKanaCount}件がすべて消えます。先にスプレッドシートへ列を追加することをおすすめします。このまま復元しますか？`);
            if (!proceedKana) {
                showToast("復元を中止しました", "error");
                return;
            }
        }

        // 名簿フル復元時は、端末側の旧データ・旧削除墓標も含めて全クリアし、クラウドの正解データで100%上書きする
        await idbClearAllRecords();

        let count = 0;
        for (let i = 0; i < records.length; i++) {
            const r = records[i];
            const nm = String(r.name ?? "").trim();
            if (!nm || nm.startsWith("¥") || nm.startsWith("\\") || nm.startsWith("合計") || nm.startsWith("物品まとめ")) continue;

            const parsedDate = parseFlexibleDate(r.timestamp);
            const bag = String(r.bagNo ?? "");
            const addr = String(r.address ?? "");
            const amt = String(r.amount ?? "");
            const recordId = r.id || stableIdFromRow(String(r.timestamp || ""), nm, amt, bag, addr, i);

            const record = {
                id: recordId,
                date: (parsedDate || new Date()).toISOString(),
                template: r.templateType === "萬圓用" ? "10000en" : (r.templateType === "阡圓用" ? "1000en" : "free"),
                name: nm,
                amount: amt,
                bagNo: bag,
                address: addr,
                kana: String(r.kana ?? ""),
                sync: "synced"
            };
            await idbPutRecord(record);
            count++;
        }
        await loadDbRecords();
        renderTable();
        await markSynced();
        showToast(`クラウドから ${count}件の名簿全件を完全復元しました`);
    } catch (e) {
        if (e.code === "unauthorized") handleGasAuthError();
        showToast("復元失敗: " + e.message, "error");
    } finally {
        if (btn) btn.innerHTML = `<i class="fa-solid fa-cloud-arrow-down"></i> 名簿フル復元`;
    }
} 

// ==========================================
// ボトムシート（サジェストUI）制御ロジック
// ==========================================
let currentSheetTarget = 'name'; // 'name' or 'amount'

function openBottomSheet(target) {
    currentSheetTarget = target;
    const overlay = document.getElementById('sheetOverlay');
    const sheet = document.getElementById('bottomSheet');
    const searchInput = document.getElementById('sheetSearchInput');
    
    if (target === 'name') {
        searchInput.placeholder = "氏名を直接入力 または 検索 (かな対応)...";
    } else {
        searchInput.placeholder = "金額・物品名を直接入力 または 検索 (かな対応)...";
    }
    
    searchInput.value = '';
    const btnConfirm = document.getElementById('btnConfirmNew');
    if (btnConfirm) btnConfirm.classList.remove('show');

    overlay.classList.add('active');
    sheet.classList.add('active');
    
    renderSheetList();
}

function closeBottomSheet() {
    const overlay = document.getElementById('sheetOverlay');
    const sheet = document.getElementById('bottomSheet');
    if (overlay) overlay.classList.remove('active');
    if (sheet) sheet.classList.remove('active');
}

function handleSheetSearch() {
    const query = document.getElementById('sheetSearchInput').value.trim();
    const btnConfirm = document.getElementById('btnConfirmNew');
    const newTextSpan = document.getElementById('newSheetInputText');
    
    if (query.length > 0) {
        if (newTextSpan) newTextSpan.textContent = query;
        if (btnConfirm) btnConfirm.classList.add('show');
    } else {
        if (btnConfirm) btnConfirm.classList.remove('show');
    }
    
    renderSheetList();
}

function renderSheetList() {
    const rawQuery = document.getElementById('sheetSearchInput') ? document.getElementById('sheetSearchInput').value.trim() : "";
    const normQuery = kanaNormalize(rawQuery);
    const content = document.getElementById('sheetListContent');
    if (!content) return;
    content.innerHTML = '';

    const combinedList = [];
    const seenMap = new Set();

    if (currentSheetTarget === 'name') {
        // 1. ローカル名簿レコード (新しい順)
        const sortedLocal = [...dbRecords].sort((a, b) => {
            const da = parseFlexibleDate(a.timestamp || a.date);
            const db = parseFlexibleDate(b.timestamp || b.date);
            return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
        });

        for (const r of sortedLocal) {
            const val = String(r.name ?? "").trim();
            if (!val || val.startsWith("¥") || val.startsWith("\\") || val.startsWith("合計") || val.startsWith("物品まとめ")) continue;

            if (!seenMap.has(val)) {
                seenMap.add(val);
                if (!normQuery || kanaNormalize(val).includes(normQuery) || kanaNormalize(r.address).includes(normQuery)) {
                    combinedList.push({
                        value: val,
                        subText: r.address || "",
                        source: "device"
                    });
                }
            }
        }

        // 2. クラウドサジェスト
        const cloudNames = suggestData.names || [];
        for (const cn of cloudNames) {
            const val = String(cn ?? "").trim();
            if (!val || val.startsWith("¥") || val.startsWith("\\") || val.startsWith("合計")) continue;

            if (!seenMap.has(val)) {
                seenMap.add(val);
                if (!normQuery || kanaNormalize(val).includes(normQuery)) {
                    combinedList.push({
                        value: val,
                        subText: "",
                        source: "cloud"
                    });
                }
            }
        }
    } else {
        // 金額・物品
        const sortedLocal = [...dbRecords].sort((a, b) => {
            const da = parseFlexibleDate(a.timestamp || a.date);
            const db = parseFlexibleDate(b.timestamp || b.date);
            return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
        });

        for (const r of sortedLocal) {
            const val = String(r.amount ?? "").trim();
            if (!val) continue;

            if (!seenMap.has(val)) {
                seenMap.add(val);
                if (!normQuery || kanaNormalize(val).includes(normQuery)) {
                    combinedList.push({
                        value: val,
                        subText: "",
                        source: "device"
                    });
                }
            }
        }

        const cloudItems = suggestData.items || [];
        for (const ci of cloudItems) {
            const val = String(ci ?? "").trim();
            if (!val) continue;

            if (!seenMap.has(val)) {
                seenMap.add(val);
                if (!normQuery || kanaNormalize(val).includes(normQuery)) {
                    combinedList.push({
                        value: val,
                        subText: "",
                        source: "cloud"
                    });
                }
            }
        }
    }

    if (normQuery) {
        const exactMatch = combinedList.some(item => kanaNormalize(item.value) === normQuery);
        const btnConfirm = document.getElementById('btnConfirmNew');
        if (exactMatch && btnConfirm) {
            btnConfirm.classList.remove('show');
        }
    }

    if (combinedList.length === 0) {
        content.innerHTML = '<div class="empty-message" style="padding: 24px; text-align: center; color: #94a3b8; font-size: 14px;">該当する候補がありません。<br>上の入力欄にそのまま入力して決定ボタンを押してください。</div>';
        return;
    }

    combinedList.slice(0, 50).forEach(item => {
        const div = document.createElement('div');
        div.className = 'list-item';
        div.style.cssText = 'padding: 12px 16px; border-bottom: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center; cursor: pointer;';

        const badgeClass = item.source === "device" ? "badge-device" : "badge-cloud";
        const badgeLabel = item.source === "device" ? "端末" : "クラウド";

        div.innerHTML = `
            <div style="flex: 1; display: flex; flex-direction: column;">
                <div style="display: flex; align-items: center;">
                    <span style="font-size: 15px; font-weight: 600; color: #1e293b;">${escapeHTML(item.value)}</span>
                    <span class="badge-source ${badgeClass}">${badgeLabel}</span>
                </div>
                ${item.subText ? `<div style="font-size: 12px; color: #64748b; margin-top: 2px;">${escapeHTML(item.subText)}</div>` : ''}
            </div>
            <i class="fa-solid fa-chevron-right" style="color: #cbd5e1; font-size: 13px;"></i>
        `;

        div.onclick = () => {
            if (currentSheetTarget === 'name') {
                document.getElementById('nameInput').value = item.value;
                if (item.subText && document.getElementById('addressInput')) {
                    document.getElementById('addressInput').value = item.subText;
                }
            } else {
                document.getElementById('amountInput').value = item.value;
            }
            closeBottomSheet();
            triggerAutoUpdate();
        };

        content.appendChild(div);
    });
}

// サジェスト候補の個別削除
async function deleteSuggestItem(val, type) {
    if (confirm(`このサジェスト候補「${val}」を一覧から削除しますか？`)) {
        let removedRecords = [];
        if (currentSheetTarget === 'name') {
            if (suggestData.names) {
                suggestData.names = suggestData.names.filter(item => item !== val);
            }
            if (type === 'recent') {
                removedRecords = dbRecords.filter(r => r.name === val);
                dbRecords = dbRecords.filter(r => r.name !== val);
            }
        } else {
            if (suggestData.items) {
                suggestData.items = suggestData.items.filter(item => item !== val);
            }
            if (type === 'recent') {
                removedRecords = dbRecords.filter(r => r.amount === val);
                dbRecords = dbRecords.filter(r => r.amount !== val);
            }
        }

        // IndexedDBにも反映（旧実装は空関数を呼んでおり、リロードで復活していた）
        for (const r of removedRecords) {
            try { await idbDeleteRecord(r.id); } catch (e) { console.warn("サジェスト削除のDB反映エラー:", e); }
        }
        if (removedRecords.length > 0) renderTable();

        // キャッシュにサジェストデータを保存
        localStorage.setItem("pdf_mail_merge_suggests", JSON.stringify(suggestData));
        showToast("サジェスト候補を削除しました");
        renderSheetList(); // リスト再描画
    }
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
// 一括印刷機能
// ==========================================
let batchPrintAbort = false;
let batchPrintRunning = false;

// 進捗バー表示
function showBatchProgress(total) {
    const wrap = document.getElementById("batchProgressWrap");
    const label = document.getElementById("batchProgressLabel");
    const bar = document.getElementById("batchProgressBar");
    const btnAbort = document.getElementById("btnBatchAbort");
    if (wrap) wrap.style.display = "block";
    if (label) label.textContent = `0 / ${total} 件`;
    if (bar) bar.style.width = "0%";
    if (btnAbort) btnAbort.disabled = false;
}

function updateBatchProgress(done, total) {
    const label = document.getElementById("batchProgressLabel");
    const bar = document.getElementById("batchProgressBar");
    if (label) label.textContent = `${done} / ${total} 件`;
    if (bar) bar.style.width = (total > 0 ? (done / total * 100) : 0) + "%";
}

function hideBatchProgress() {
    const wrap = document.getElementById("batchProgressWrap");
    if (wrap) wrap.style.display = "none";
}

function abortBatchPrint() {
    batchPrintAbort = true;
    const btnAbort = document.getElementById("btnBatchAbort");
    const label = document.getElementById("batchProgressLabel");
    if (btnAbort) btnAbort.disabled = true;
    if (label) label.textContent = "中断しています…";
}

// PDF BlobをウィンドウでprintするorダウンロードするorFallback
function openPdfForPrint(blob, filename) {
    const url = URL.createObjectURL(blob);

    // 印刷 or ダウンロード
    const newWindow = window.open(url, '_blank');
    if (newWindow) {
        let printCalled = false;
        const triggerPrint = () => {
            if (printCalled) return;
            printCalled = true;
            try { newWindow.print(); } catch (e) { /* noop */ }
        };
        newWindow.onload = triggerPrint;
        setTimeout(triggerPrint, 2000);
    } else {
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000); // メモリリーク防止
}

// 一括選択/解除
function toggleSelectAll(checked) {
    document.querySelectorAll('.record-checkbox').forEach(cb => cb.checked = checked);
    updateBatchCount();
}

// 選択件数の更新
function updateBatchCount() {
    const count = document.querySelectorAll('.record-checkbox:checked').length;
    const countSpan = document.getElementById('batchCount');
    if (countSpan) countSpan.textContent = `${count}件選択中`;
    // 選択0件のときはツールバーごと非表示、1件以上で表示
    const toolbar = document.getElementById('batchToolbar');
    if (toolbar) toolbar.style.display = count > 0 ? 'flex' : 'none';
    // 一括印刷・選択分CSV・選択削除の3ボタンをまとめて表示制御（ツールバー内なので常に表示でよいが、既存コードとの互換のため残す）
    for (const id of ['btnBatchPrint', 'btnBatchExport', 'btnBatchDelete']) {
        const btn = document.getElementById(id);
        if (btn) btn.style.display = count > 0 ? 'inline-flex' : 'none';
    }
}

// 一括印刷
async function batchPrint() {
    if (batchPrintRunning) return;

    const checkedBoxes = document.querySelectorAll('.record-checkbox:checked');
    const selectedIds = Array.from(checkedBoxes).map(cb => cb.value);

    if (selectedIds.length === 0) {
        showToast('印刷するレコードを選択してください', 'error');
        return;
    }

    batchPrintRunning = true;
    batchPrintAbort = false;
    showBatchProgress(selectedIds.length);
    showStatus(`一括印刷: ${selectedIds.length}件のPDFを生成中...`, true);

    let generatedCount = 0;
    try {
        const mergedPdf = await PDFLib.PDFDocument.create();

        for (let i = 0; i < selectedIds.length; i++) {
            if (batchPrintAbort) break;

            const record = dbRecords.find(r => r.id === selectedIds[i]);
            if (!record) continue;

            showStatus(`一括印刷: ${i + 1}/${selectedIds.length} 件目を処理中...`, true);

            // イベントループにマクロタスクとして制御を戻し、中断ボタンのクリックを処理できるようにする
            // （generatePDF内のawaitはマイクロタスクのため、これが無いと中断が効かない）
            await new Promise(r => setTimeout(r, 0));

            // generatePDFのoverride引数でレコードデータを直接渡す
            // （フォームDOMを書き換えないため、画面のチラつきや状態復元漏れが起きない）
            // parseAmountForForm が「[空]」タグと金〜圓也の装飾を安全に剥がす
            const pdfBlob = await generatePDF(true, {
                template: record.template,
                name: record.name,
                amount: parseAmountForForm(record)
            });
            if (pdfBlob) {
                const pdfBytes = await pdfBlob.arrayBuffer();
                const srcDoc = await PDFLib.PDFDocument.load(pdfBytes);
                const copiedPages = await mergedPdf.copyPages(srcDoc, srcDoc.getPageIndices());
                copiedPages.forEach(page => mergedPdf.addPage(page));
                generatedCount++;
            }

            updateBatchProgress(i + 1, selectedIds.length);
        }

        if (mergedPdf.getPageCount() === 0) {
            showToast('PDFの生成に失敗しました', 'error');
            showStatus('準備完了', false);
            return;
        }

        if (batchPrintAbort) {
            const proceed = confirm(`中断しました。ここまでの ${generatedCount} 件を印刷しますか？`);
            if (!proceed) {
                showToast('一括印刷を中断しました', 'error');
                showStatus('準備完了', false);
                return;
            }
        }

        const mergedBytes = await mergedPdf.save();
        const blob = new Blob([mergedBytes], { type: 'application/pdf' });
        const filename = `奉納ビラ一括_${generatedCount}件_${new Date().toISOString().slice(0,10)}.pdf`;
        openPdfForPrint(blob, filename);
        showToast(`${generatedCount}件のPDFを一括印刷します`);

        showStatus('一括印刷完了', false);

    } catch (e) {
        console.error('一括印刷エラー:', e);
        showToast('一括印刷に失敗しました: ' + e.message, 'error');
        showStatus('準備完了', false);
    } finally {
        batchPrintRunning = false;
        hideBatchProgress();
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
            // fieldズームモード中は矩形が動くため、表示サイズ・スクロール位置を即座に追従させる
            if (previewZoomMode.startsWith("field:")) {
                applyPreviewDisplaySize();
            }
        }
    }
}


// ==========================================
// 集計（ダッシュボード）更新処理
// ==========================================
// 漢数字・金額パース用関数 (物品名の容量・個数の数値誤認を防止する高度パース)
function parseKanjiNumber(str) {
    if (!str) return 0;
    const strVal = String(str).trim();

    // 1. 物品単位や掛け算 (ml, L, ケース, 本, 箱, 枚, 缶, 袋, 束, kg, g, %, 度, 個, セット, 人前, パック, × 等) の付いた数値を消去
    const patternUnits = /[\d０-９\.\,]+\s*(?:ml|L|ℓ|l|ケース|本|箱|枚|缶|袋|束|kg|g|%|度|個|セット|人前|パック)/gi;
    const patternMult = /[×xX\*]\s*[\d０-９]+|[\d０-９]+\s*[×xX\*]/g;
    
    let sCleaned = strVal.replace(patternUnits, '').replace(patternMult, '');
    
    // 2. 物品キーワードが含まれ、かつ明らかな金銭指定 (¥, 円, 万, 千) がない場合は物品（0円）とみなす
    const itemKeywords = ['ビール', '麦茶', '緑茶', '酒', '餃子', '茶', 'ジュース', 'ケース', '本', '箱', '枚', '缶', '券', '接待', 'ケース'];
    const hasItemKw = itemKeywords.some(kw => strVal.includes(kw));
    const hasMoneyExpress = /[¥\\円金萬万阡千]/.test(strVal);
    if (hasItemKw && !hasMoneyExpress) {
        return 0;
    }

    // 3. 全角数字を半角に
    let halfStr = sCleaned.replace(/[０-９]/g, function(s) { return String.fromCharCode(s.charCodeAt(0) - 0xFEE0); });
    // 4. アラビア数字があればそれを優先して抽出
    let arabicMatch = halfStr.replace(/[^0-9]/g, '');
    if (arabicMatch && parseInt(arabicMatch, 10) > 0) {
        return parseInt(arabicMatch, 10);
    }

    // 5. 漢数字をパース
    const numMap = {'一':1, '壱':1, '二':2, '弐':2, '三':3, '参':3, '四':4, '五':5, '伍':5, '六':6, '七':7, '八':8, '九':9};
    const smallUnitMap = {'阡':1000, '千':1000, '陌':100, '佰':100, '百':100, '拾':10, '什':10, '十':10};
    const bigUnitMap = {'萬':10000, '万':10000, '億':100000000};

    const chars = Array.from(halfStr).filter(c =>
        numMap[c] !== undefined || smallUnitMap[c] !== undefined || bigUnitMap[c] !== undefined
    );
    if (chars.length === 0) return 0;

    let total = 0;
    let section = 0;
    let digit = 0;

    for (const c of chars) {
        if (numMap[c] !== undefined) {
            digit = numMap[c];
        } else if (smallUnitMap[c] !== undefined) {
            section += (digit === 0 ? 1 : digit) * smallUnitMap[c];
            digit = 0;
        } else if (bigUnitMap[c] !== undefined) {
            section += digit;
            total += (section === 0 ? 1 : section) * bigUnitMap[c];
            section = 0;
            digit = 0;
        }
    }
    return total + section + digit;
}

// ==========================================
// 集計の期間切替・前年同期比較
// ==========================================
let statsPeriod = "all"; // "today"|"month"|"year"|"all"|"custom"
let statsCustomFrom = null;
let statsCustomTo = null;

// 選択期間の集計値を計算する（既存 updateDashboardStats のループ本体をそのまま切り出したもの）
// 祭礼ごとの集計などを将来追加する際は、絞り込み済みのrecords配列を渡すだけで再利用できる
function computeStats(records) {
    let totalMoney = 0;
    let emptyTotalMoney = 0;
    let moneyCount = 0;
    let itemCount = 0;
    let validRecords = [];

    for (let r of records) {
        const nameStr = String(r.name ?? "").trim();
        // 明らかな誤データ（氏名欄に金額や「合計金額」が入っている壊れたレコード）はスキップ
        if (nameStr.startsWith("¥") || nameStr.startsWith("\\") || nameStr.startsWith("合計") || nameStr.startsWith("物品まとめ")) {
            continue;
        }
        validRecords.push(r);

        const _amt = String(r.amount ?? "").trim();
        const hasEmptyTag = _amt.includes('[空]') || _amt.includes('［空］') || _amt.includes('空');

        if (hasEmptyTag) {
            // [空] タグが含まれている場合は、数字のみを取り出して[空]合計金に合算
            const emptyNum = parseKanjiNumber(_amt);
            if (emptyNum > 0) {
                emptyTotalMoney += emptyNum;
            }
            itemCount++;
        } else {
            const num = parseKanjiNumber(_amt);
            if (num > 0) {
                totalMoney += num;
                moneyCount++;
            } else if (_amt !== "") {
                itemCount++;
            }
        }
    }

    return {
        totalMoney,
        emptyTotalMoney,
        count: validRecords.length,
        moneyCount,
        itemCount
    };
}

// 期間指定から {from, to, label} を返す。"all" の場合は null（絞り込み無し）
function getStatsRange(period) {
    const now = new Date();
    if (period === "today") {
        const from = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        return { from, to, label: "今日" };
    }
    if (period === "month") {
        const from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        return { from, to, label: "今月" };
    }
    if (period === "year") {
        const from = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
        const to = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
        return { from, to, label: "今年" };
    }
    if (period === "custom") {
        if (!statsCustomFrom || !statsCustomTo) return null;
        const from = new Date(statsCustomFrom + "T00:00:00");
        const to = new Date(statsCustomTo + "T23:59:59.999");
        if (isNaN(from) || isNaN(to)) return null;
        return { from, to, label: "期間指定" };
    }
    // "all"
    return null;
}

// 指定rangeの前年同期rangeを返す（2/29は2/28に丸める）
function shiftRangeOneYear(range) {
    if (!range) return null;
    const shiftYear = (d) => {
        const y = d.getFullYear() - 1;
        const m = d.getMonth();
        const day = d.getDate();
        const shifted = new Date(d.getTime());
        shifted.setFullYear(y, m, day);
        // 2/29→2/28への丸め対策（setFullYearで3/1にずれてしまうケースを補正）
        if (shifted.getMonth() !== m) {
            shifted.setFullYear(y, m + 1, 0);
        }
        return shifted;
    };
    return {
        from: shiftYear(range.from),
        to: shiftYear(range.to),
        label: range.label + "（前年同期）"
    };
}

// rangeでレコードを絞り込む。range が null なら全件。
// パース失敗レコードは range が null（全期間）のときのみ含める（現状の集計値を壊さないため）
function filterRecordsByRange(records, range) {
    if (!range) return records;
    return records.filter(r => {
        const d = recordDate(r);
        if (!d) return false;
        return d.getTime() >= range.from.getTime() && d.getTime() <= range.to.getTime();
    });
}

function setStatsPeriod(p) {
    statsPeriod = p;
    try { localStorage.setItem("pdf_mail_merge_stats_period", p); } catch (e) { /* noop */ }
    const customWrap = document.getElementById("statsCustomRange");
    if (customWrap) customWrap.style.display = (p === "custom") ? "flex" : "none";
    document.querySelectorAll(".stats-period-btn").forEach(btn => {
        btn.classList.toggle("active", btn.id === "statsPeriod" + p.charAt(0).toUpperCase() + p.slice(1));
    });
    updateDashboardStats();
}

function applyStatsCustomRange() {
    const from = document.getElementById("statsDateFrom");
    const to = document.getElementById("statsDateTo");
    statsCustomFrom = from && from.value ? from.value : null;
    statsCustomTo = to && to.value ? to.value : null;
    if (statsPeriod === "custom") updateDashboardStats();
}

function updateDashboardStats() {
    const range = getStatsRange(statsPeriod);
    const filtered = filterRecordsByRange(dbRecords, range);
    const stats = computeStats(filtered);

    // カンマ区切りでフォーマット
    const elTotalMoney = document.getElementById("statTotalMoney");
    if (elTotalMoney) elTotalMoney.textContent = stats.totalMoney.toLocaleString();

    const elEmptyMoney = document.getElementById("statEmptyMoney");
    if (elEmptyMoney) elEmptyMoney.textContent = stats.emptyTotalMoney.toLocaleString();

    const elTotalCount = document.getElementById("statCountTotal");
    if (elTotalCount) elTotalCount.textContent = stats.count.toLocaleString();

    const elMoneyCount = document.getElementById("statMoneyCount");
    if (elMoneyCount) elMoneyCount.textContent = stats.moneyCount.toLocaleString();

    const elItemCount = document.getElementById("statItemCount");
    if (elItemCount) elItemCount.textContent = stats.itemCount.toLocaleString();

    // 期間キャプション
    const caption = document.getElementById("statsPeriodCaption");
    if (caption) caption.textContent = range ? `${range.label}: ${formatDateForDisplay(range.from)} 〜 ${formatDateForDisplay(range.to)}` : "全期間";

    // 前年同期比較（"all" のときは比較対象が無いので非表示）
    const compareWrap = document.getElementById("statsCompareWrap");
    if (range) {
        const prevRange = shiftRangeOneYear(range);
        const prevFiltered = filterRecordsByRange(dbRecords, prevRange);
        const prevStats = computeStats(prevFiltered);

        const pct = (curr, prev) => {
            if (prev === 0) return curr === 0 ? null : Infinity;
            return ((curr - prev) / prev) * 100;
        };
        const formatDelta = (curr, prev) => {
            const p = pct(curr, prev);
            if (p === null) return "±0%";
            if (p === Infinity) return "+∞%";
            return (p >= 0 ? "+" : "") + p.toFixed(1) + "%";
        };
        const setDelta = (id, curr, prev) => {
            const el = document.getElementById(id);
            if (!el) return;
            const p = pct(curr, prev);
            el.textContent = formatDelta(curr, prev);
            el.style.color = (p !== null && p < 0) ? "#dc2626" : "#16a34a";
        };

        const elPrevMoney = document.getElementById("statTotalMoneyPrev");
        if (elPrevMoney) elPrevMoney.textContent = prevStats.totalMoney.toLocaleString();
        setDelta("statTotalMoneyDelta", stats.totalMoney, prevStats.totalMoney);

        const elPrevCount = document.getElementById("statCountTotalPrev");
        if (elPrevCount) elPrevCount.textContent = prevStats.count.toLocaleString();
        setDelta("statCountTotalDelta", stats.count, prevStats.count);

        if (compareWrap) compareWrap.style.display = "flex";
    } else {
        if (compareWrap) compareWrap.style.display = "none";
    }
}


// ==========================================
// 手動キャッシュクリア ＆ 強制再同期
// ==========================================
async function forceClearAppCache() {
    if (confirm("アプリのキャッシュ（フォントやPDF原本テンプレートなど）をすべてクリアし、最新ファイルを強制的に再ダウンロードします。よろしいですか？\n※デザインの微調整値や名簿の履歴は消去されません。")) {
        // 設定バージョンなどのLocalStorageフラグを削除
        localStorage.removeItem("pdf_mail_merge_config_version");

        // IndexedDB のファイルキャッシュ（フォント・PDF原本）を全削除
        // ※ 名簿(STORE_RECORDS)とKV(STORE_KV)は消さない
        try {
            const db = await openDB();
            const tx = db.transaction(STORE_FILES, "readwrite");
            tx.objectStore(STORE_FILES).clear();
            await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; });
            console.log("IndexedDB キャッシュを強制クリアしました。");
        } catch (dbErr) {
            console.warn("IndexedDB強制クリアエラー:", dbErr);
        }

        // Service Worker のキャッシュも削除して最新ファイルを取得させる
        try {
            if (window.caches) {
                const keys = await caches.keys();
                await Promise.all(keys.map(k => caches.delete(k)));
            }
        } catch (swErr) {
            console.warn("SWキャッシュ削除エラー:", swErr);
        }

        // ページをリロードして再起動
        window.location.reload();
    }
}

// ==========================================
// オフライン送信キュー個別管理モーダル
// ==========================================
function openQueueModal() {
    const overlay = document.getElementById('queueModalOverlay');
    const modal = document.getElementById('queueModal');
    
    if (overlay && modal) {
        overlay.classList.add('active');
        modal.classList.add('active');
        renderQueueModalList();
    }
}

function closeQueueModal() {
    const overlay = document.getElementById('queueModalOverlay');
    const modal = document.getElementById('queueModal');
    if (overlay && modal) {
        overlay.classList.remove('active');
        modal.classList.remove('active');
    }
}

async function renderQueueModalList() {
    const content = document.getElementById('queueModalContent');
    if (!content) return;
    content.innerHTML = '';

    // IndexedDB Outbox から未送信（登録待ち＋削除待ち）を取得
    let pendings = [];
    let pendingDeletes = [];
    try {
        pendings = await idbGetPendingRecords();
        pendingDeletes = await idbGetPendingDeletes();
    } catch (e) {
        console.warn("未送信キュー取得エラー:", e);
    }

    const items = [
        ...pendings.map(r => ({ record: r, kind: "upsert" })),
        ...pendingDeletes.map(r => ({ record: r, kind: "delete" }))
    ];

    if (items.length === 0) {
        content.innerHTML = '<div class="empty-message">未送信のデータはありません。</div>';
        setTimeout(() => closeQueueModal(), 1500); // キューが空なら自動で閉じる
        return;
    }

    items.forEach(({ record, kind }) => {
        const div = document.createElement('div');
        div.className = 'list-item';
        div.style.position = 'relative';
        div.style.paddingRight = '110px'; // アクションボタン用スペース

        const templateStr = record.template === "10000en" ? "萬圓用" : (record.template === "1000en" ? "阡圓用" : "フリー用");
        const kindLabel = kind === "delete"
            ? '<span style="color: #ef4444; font-weight: bold;">[削除待ち]</span> '
            : '';

        div.innerHTML = `
            <div style="display: flex; flex-direction: column; flex: 1;">
                <span style="font-size: 14px; font-weight: bold; color: var(--text-primary);">${kindLabel}${escapeHTML(record.name || "")}</span>
                <span style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">${templateStr} | ${escapeHTML(record.amount || "")}</span>
                <span style="font-size: 10px; color: #94a3b8; margin-top: 4px;">登録日時: ${escapeHTML(formatDateForDisplay(record.date))}</span>
            </div>
            <div style="position: absolute; right: 12px; top: 50%; transform: translateY(-50%); display: flex; gap: 6px; z-index: 5;">
                <button type="button" class="btn queue-send-btn" style="padding: 6px 8px; font-size: 11px; background: #e0f2fe; color: #0284c7; min-height: 28px; width: auto; border: 1px solid #bae6fd; border-radius: 4px; font-weight: 600;">
                    送信
                </button>
                <button type="button" class="btn queue-drop-btn" style="padding: 6px 8px; font-size: 11px; background: #fee2e2; color: #ef4444; min-height: 28px; width: auto; border: 1px solid #fecaca; border-radius: 4px; font-weight: 600;">
                    除外
                </button>
            </div>
        `;
        div.querySelector('.queue-send-btn').addEventListener('click', () => sendSingleQueueItem(record.id, kind));
        div.querySelector('.queue-drop-btn').addEventListener('click', () => deleteSingleQueueItem(record.id, kind));
        content.appendChild(div);
    });
}

// キューの個別送信（応答を検証し、成功した場合のみ同期済みにする）
async function sendSingleQueueItem(id, kind) {
    if (!navigator.onLine) {
        showToast("オフライン状態のため送信できません", "error");
        return;
    }
    if (!gasUrl) {
        showToast("GASのURLが設定されていません", "error");
        return;
    }

    const all = await idbGetAllRecords();
    const record = all.find(r => r.id === id);
    if (!record) return;

    showToast(`${record.name || ""}様 のデータを送信中...`);

    try {
        const token = await idbKvGet("api_token") || "GUEST_TOKEN_" + Math.random().toString(36).substr(2);
        await idbKvSet("api_token", token);

        if (kind === "delete") {
            await postToGas({ id: record.id, action: "delete", token: token });
            await idbDeleteRecord(record.id);
        } else {
            let templateTypeStr = "フリー用";
            if (record.template === "10000en") templateTypeStr = "萬圓用";
            else if (record.template === "1000en") templateTypeStr = "阡圓用";
            const recDate = parseFlexibleDate(record.date);
            await postToGas({
                id: record.id,
                timestamp: (recDate || new Date()).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }),
                templateType: templateTypeStr,
                name: record.name,
                amount: record.amount,
                token: token
            });
            record.sync = "synced";
            await idbPutRecord(record);
            const memRec = dbRecords.find(r => r.id === record.id);
            if (memRec) memRec.sync = "synced";
        }

        const remaining = (await idbGetPendingRecords()).length + (await idbGetPendingDeletes()).length;
        updateSyncBadge(remaining);
        renderQueueModalList();
        showToast("データを正常に送信しました！");
    } catch (e) {
        showToast("送信に失敗しました: " + e.message, "error");
    }
}

// キューからの個別除外（クラウドへ送信せずに未送信状態を解消する）
async function deleteSingleQueueItem(id, kind) {
    const all = await idbGetAllRecords();
    const record = all.find(r => r.id === id);
    if (!record) return;

    const msg = kind === "delete"
        ? `この削除待ちデータ（${record.name || ""}様）を取り消しますか？\n※ローカルからは既に削除済みです。クラウド上のデータは残ります。`
        : `この未送信データ（${record.name || ""}様）をクラウドへ送信せず、送信済み扱いにしますか？\n※ローカルの名簿には残ります。`;

    if (confirm(msg)) {
        if (kind === "delete") {
            // 墓標を破棄（クラウドへの削除は行わない）
            await idbDeleteRecord(record.id);
        } else {
            record.sync = "synced";
            await idbPutRecord(record);
            const memRec = dbRecords.find(r => r.id === record.id);
            if (memRec) memRec.sync = "synced";
        }
        const remaining = (await idbGetPendingRecords()).length + (await idbGetPendingDeletes()).length;
        updateSyncBadge(remaining);
        renderQueueModalList();
        showToast("未送信リストから除外しました");
    }
}

// モーダルからの全件送信
async function flushOfflineQueueFromModal() {
    if (!navigator.onLine) {
        showToast("オフライン状態のため送信できません", "error");
        return;
    }
    closeQueueModal();
    showToast("未送信データの同期を開始します...");
    await pushPendingRecords();
}

// =================================-------------------
// 🚀 追加拡張機能: GASコードコピー、用紙サイズプリセット、自動連番、CSVインポート、設定出入力
// =================================-------------------

// 1. GASコードをワンクリックでクリップボードへコピー
// 注: GASコードの実体は gas_script.js（リポジトリ直下の実ファイル）。
// 起動時にプリフェッチした gasCodeCache を使う。iPad Safari ではクリック直後の
// clipboard.writeText でないとユーザージェスチャ文脈が切れて拒否されるため、この関数は async にしない。
function copyGasCodeToClipboard() {
    if (!gasCodeCache) {
        alert("コードを取得中です。数秒後にもう一度お試しください");
        return;
    }
    const gasCodeText = gasCodeCache;
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
        openGasCodeFallbackModal(gasCodeText);
        return;
    }
    navigator.clipboard.writeText(gasCodeText).then(() => {
        alert("📋 配布用 GASコードをクリップボードにコピーしました！\n\n【次の手順】\n1. 自分のGoogleスプレッドシートを開きます\n2. メニュー「拡張機能」 ➡️ 「Apps Script」を開きます\n3. コードを全消去して Ctrl + V で貼り付けます\n4. 「デプロイ」 ➡️ 「新しいデプロイ」 (アクセス権: 全員) を実行してください。");
    }).catch(err => {
        openGasCodeFallbackModal(gasCodeText);
    });
}

// クリップボードが使えない環境向けのフォールバック（手動選択コピー用モーダル）
function openGasCodeFallbackModal(text) {
    const overlay = document.getElementById('gasCodeFallbackModalOverlay');
    const modal = document.getElementById('gasCodeFallbackModal');
    const textarea = document.getElementById('gasCodeFallbackText');
    if (!overlay || !modal || !textarea) {
        alert("コピーに失敗しました。手動でコピーしてください。");
        return;
    }
    textarea.value = text;
    overlay.classList.add('active');
    modal.classList.add('active');
    textarea.focus();
    textarea.select();
}

function closeGasCodeFallbackModal() {
    const overlay = document.getElementById('gasCodeFallbackModalOverlay');
    const modal = document.getElementById('gasCodeFallbackModal');
    if (overlay && modal) {
        overlay.classList.remove('active');
        modal.classList.remove('active');
    }
}


// 2. 用紙サイズプリセット設定
function onPaperPresetChange(val) {
    const customDiv = document.getElementById("customPaperDimensions");
    const wInput = document.getElementById("paperWidthInput");
    const hInput = document.getElementById("paperHeightInput");
    
    if (val === "tanzaku") {
        if (customDiv) customDiv.style.display = "none";
        paperSizeSettings.width = 105;
        paperSizeSettings.height = 390;
    } else if (val === "a4") {
        if (customDiv) customDiv.style.display = "none";
        paperSizeSettings.width = 210;
        paperSizeSettings.height = 297;
    } else if (val === "b5") {
        if (customDiv) customDiv.style.display = "none";
        paperSizeSettings.width = 182;
        paperSizeSettings.height = 257;
    } else if (val === "custom") {
        if (customDiv) customDiv.style.display = "grid";
        if (wInput) paperSizeSettings.width = parseFloat(wInput.value) || 105;
        if (hInput) paperSizeSettings.height = parseFloat(hInput.value) || 390;
    }
    localStorage.setItem("pdf_mail_merge_paper_preset", val);
    localStorage.setItem("pdf_mail_merge_paper_size", JSON.stringify(paperSizeSettings));
    if (typeof updatePreview === "function") updatePreview();
}

function saveCustomPaperSize() {
    const wInput = document.getElementById("paperWidthInput");
    const hInput = document.getElementById("paperHeightInput");
    if (wInput && hInput) {
        paperSizeSettings.width = parseFloat(wInput.value) || 105;
        paperSizeSettings.height = parseFloat(hInput.value) || 390;
        localStorage.setItem("pdf_mail_merge_paper_size", JSON.stringify(paperSizeSettings));
        if (typeof updatePreview === "function") updatePreview();
    }
}

// 3. 奉納袋番号の自動連番管理
function toggleAutoBagNo() {
    const toggle = document.getElementById("autoBagNoToggle");
    const bagInput = document.getElementById("bagNoInput");
    if (toggle && toggle.checked) {
        const nextNo = getNextAutoBagNo();
        if (bagInput && !bagInput.value) bagInput.value = nextNo;
    }
    localStorage.setItem("pdf_mail_merge_auto_bag_toggle", toggle ? toggle.checked : true);
}

function getNextAutoBagNo() {
    const datePrefix = new Date().toLocaleDateString("ja-JP", { month: "2-digit", day: "2-digit" }).replace(/\//g, "");
    let lastSeq = parseInt(localStorage.getItem("pdf_mail_merge_bag_seq_" + datePrefix) || "1", 10);
    return `${datePrefix}-${String(lastSeq).padStart(3, '0')}`;
}

function incrementAutoBagSeq() {
    const toggle = document.getElementById("autoBagNoToggle");
    if (toggle && toggle.checked) {
        const datePrefix = new Date().toLocaleDateString("ja-JP", { month: "2-digit", day: "2-digit" }).replace(/\//g, "");
        let lastSeq = parseInt(localStorage.getItem("pdf_mail_merge_bag_seq_" + datePrefix) || "1", 10);
        localStorage.setItem("pdf_mail_merge_bag_seq_" + datePrefix, (lastSeq + 1).toString());
        const bagInput = document.getElementById("bagNoInput");
        if (bagInput) bagInput.value = `${datePrefix}-${String(lastSeq + 1).padStart(3, '0')}`;
    }
}

// 4. 設定のみのJSONエクスポート
function exportSettingsOnly() {
    const settingsData = {
        appVersion: "43",
        exportDate: new Date().toISOString(),
        gasUrl: localStorage.getItem("pdf_mail_merge_gas_url") || "",
        designSettings: designSettings,
        paperPreset: localStorage.getItem("pdf_mail_merge_paper_preset") || "tanzaku",
        paperSize: paperSizeSettings,
        receiptOption: localStorage.getItem("pdf_mail_merge_receipt_opt") === "true"
    };
    const jsonStr = JSON.stringify(settingsData, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `honou_settings_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

// 5. CSV一括インポートモーダル制御
let parsedCsvRecords = [];

function openCsvImportModal() {
    const modal = document.getElementById("csvImportModal");
    const overlay = document.getElementById("csvImportModalOverlay");
    if (modal && overlay) {
        modal.classList.add("open");
        overlay.classList.add("open");
    }
}

function closeCsvImportModal() {
    const modal = document.getElementById("csvImportModal");
    const overlay = document.getElementById("csvImportModalOverlay");
    if (modal && overlay) {
        modal.classList.remove("open");
        overlay.classList.remove("open");
    }
}

function handleCsvFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(evt) {
        let text = evt.target.result;
        parseAndPreviewCsv(text);
    };
    reader.readAsText(file, "utf-8");
}

function parseAndPreviewCsv(text) {
    const lines = text.split(/\r\n|\n/).filter(line => line.trim() !== "");
    if (lines.length === 0) { alert("CSVファイルが空です"); return; }

    parsedCsvRecords = [];
    const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
    
    let nameIdx = headers.findIndex(h => h.includes("氏名") || h.includes("名前") || h.includes("奉納者"));
    let amountIdx = headers.findIndex(h => h.includes("金額") || h.includes("物品") || h.includes("初穂料"));
    let bagNoIdx = headers.findIndex(h => h.includes("番号") || h.includes("袋"));
    let addressIdx = headers.findIndex(h => h.includes("住所"));
    // 「読み仮名」列が無いCSV（従来形式）も引き続き読めるよう、見つからなければ -1 のまま空文字扱いにする
    let kanaIdx = headers.findIndex(h => h.includes("読み仮名") || h.includes("ふりがな") || h.includes("フリガナ"));
    // 「日時」列（本アプリのCSVエクスポート形式）があれば取込時にそのまま登録日として使う
    let dateIdx = headers.findIndex(h => h.includes("日時") || h.includes("日付") || h.includes("登録日"));

    if (nameIdx === -1) nameIdx = 0;
    if (amountIdx === -1) amountIdx = 1;

    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",").map(c => c.trim().replace(/^"|"$/g, ""));
        if (cols.length <= nameIdx) continue;

        const name = cols[nameIdx] || "";
        const amount = amountIdx !== -1 && cols[amountIdx] ? cols[amountIdx] : "";
        const bagNo = bagNoIdx !== -1 && cols[bagNoIdx] ? cols[bagNoIdx] : "";
        const address = addressIdx !== -1 && cols[addressIdx] ? cols[addressIdx] : "";
        const kana = kanaIdx !== -1 && cols[kanaIdx] ? cols[kanaIdx] : "";
        const csvDate = dateIdx !== -1 && cols[dateIdx] ? cols[dateIdx] : "";

        if (name) {
            parsedCsvRecords.push({ name, amount, bagNo, address, kana, date: csvDate, templateType: String(amount).includes("萬") ? "10000en" : "free" });
        }
    }

    const container = document.getElementById("csvPreviewTableContainer");
    const countText = document.getElementById("csvCountText");
    const previewArea = document.getElementById("csvPreviewArea");
    const btnExec = document.getElementById("btnExecuteCsvImport");

    if (container && parsedCsvRecords.length > 0) {
        let html = `<table style="width: 100%; border-collapse: collapse; font-size: 12px;">
            <thead><tr style="background: #f1f5f9; text-align: left;">
                <th style="padding: 6px; border: 1px solid #cbd5e1;">氏名</th>
                <th style="padding: 6px; border: 1px solid #cbd5e1;">金額/物品</th>
                <th style="padding: 6px; border: 1px solid #cbd5e1;">袋番号</th>
                <th style="padding: 6px; border: 1px solid #cbd5e1;">住所</th>
            </tr></thead><tbody>`;
        
        parsedCsvRecords.slice(0, 5).forEach(r => {
            html += `<tr>
                <td style="padding: 6px; border: 1px solid #cbd5e1;">${r.name}</td>
                <td style="padding: 6px; border: 1px solid #cbd5e1;">${r.amount}</td>
                <td style="padding: 6px; border: 1px solid #cbd5e1;">${r.bagNo}</td>
                <td style="padding: 6px; border: 1px solid #cbd5e1;">${r.address}</td>
            </tr>`;
        });
        html += `</tbody></table>`;
        container.innerHTML = html;
        if (countText) countText.textContent = `検出された名簿件数: 全 ${parsedCsvRecords.length} 件`;
        if (previewArea) previewArea.style.display = "block";
        if (btnExec) btnExec.disabled = false;
    }
}

async function executeCsvImport() {
    if (parsedCsvRecords.length === 0) return;

    showToast(`名簿 ${parsedCsvRecords.length} 件を一括インポート中...`);
    let imported = 0;

    for (const rec of parsedCsvRecords) {
        const id = "rec_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5);
        const importTimestamp = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
        // 登録日(date)は、CSVに日付列があればその値を、無ければ取込時刻を使う。
        // timestampは常に取込時刻（表示・互換用）とし、date（本来の登録日時）と役割を分ける。
        const recordDateValue = rec.date && parseFlexibleDate(rec.date) ? rec.date : importTimestamp;
        const recordData = {
            id: id,
            date: recordDateValue,
            timestamp: importTimestamp,
            templateType: rec.templateType,
            name: rec.name,
            honorific: "様",
            amount: rec.amount,
            bagNo: rec.bagNo,
            address: rec.address,
            kana: rec.kana || "",
            sync: "pending"
        };
        await idbPutRecord(recordData);
        dbRecords.unshift(recordData);
        if (suggestData.names && !suggestData.names.includes(rec.name)) suggestData.names.push(rec.name);
        if (rec.amount && suggestData.items && !suggestData.items.includes(rec.amount)) suggestData.items.push(rec.amount);
        imported++;
    }

    closeCsvImportModal();
    showToast(`${imported} 件の名簿を一括インポートしました！`);
    if (gasUrl) pushPendingRecords().catch(() => {});
}

function saveReceiptOption() {
    const chk = document.getElementById("printReceiptCheck");
    if (chk) localStorage.setItem("pdf_mail_merge_receipt_opt", chk.checked);
}

// 6. 発行者名および発行者住所、領収書用紙サイズの保存・管理
function saveReceiptIssuer(val) {
    localStorage.setItem("pdf_mail_merge_receipt_issuer", val || "");
}

let issuerAddressDebounceTimer = null;

function handleReceiptIssuerAddressInput(val) {
    saveReceiptIssuerAddress(val);
    if (issuerAddressDebounceTimer) clearTimeout(issuerAddressDebounceTimer);
    issuerAddressDebounceTimer = setTimeout(() => {
        if (typeof normalizeAddress === "function" && val && val.trim()) {
            const normalized = normalizeAddress(val);
            if (normalized && normalized !== val) {
                const el = document.getElementById("receiptIssuerAddressInput");
                if (el) {
                    el.value = normalized;
                    saveReceiptIssuerAddress(normalized);
                }
            }
        }
    }, 500);
}

function saveReceiptIssuerAddress(val) {
    localStorage.setItem("pdf_mail_merge_receipt_issuer_address", val || "");
}

let receiptPaperSizeSettings = { width: 210, height: 148 }; // デフォルト A5横

function loadReceiptPaperSettings() {
    try {
        const preset = localStorage.getItem("pdf_mail_merge_receipt_paper_preset") || "a5_landscape";
        const w = parseFloat(localStorage.getItem("pdf_mail_merge_receipt_paper_w")) || (preset === "a6_landscape" ? 148 : (preset === "a4_portrait" ? 210 : 210));
        const h = parseFloat(localStorage.getItem("pdf_mail_merge_receipt_paper_h")) || (preset === "a6_landscape" ? 105 : (preset === "a4_portrait" ? 297 : 148));
        receiptPaperSizeSettings = { width: w, height: h };

        const sel = document.getElementById("receiptPaperPresetSelect");
        if (sel) sel.value = preset;

        const customDiv = document.getElementById("receiptCustomPaperDimensions");
        if (customDiv) customDiv.style.display = (preset === "custom") ? "grid" : "none";

        const wInput = document.getElementById("receiptPaperWidthInput");
        const hInput = document.getElementById("receiptPaperHeightInput");
        if (wInput) wInput.value = w;
        if (hInput) hInput.value = h;
    } catch (e) {
        console.warn("領収書用紙設定復元失敗:", e);
    }
}

function onReceiptPaperPresetChange(val) {
    localStorage.setItem("pdf_mail_merge_receipt_paper_preset", val);
    const customDiv = document.getElementById("receiptCustomPaperDimensions");

    if (val === "a5_landscape") {
        receiptPaperSizeSettings = { width: 210, height: 148 };
        if (customDiv) customDiv.style.display = "none";
    } else if (val === "a6_landscape") {
        receiptPaperSizeSettings = { width: 148, height: 105 };
        if (customDiv) customDiv.style.display = "none";
    } else if (val === "a4_portrait") {
        receiptPaperSizeSettings = { width: 210, height: 297 };
        if (customDiv) customDiv.style.display = "none";
    } else if (val === "custom") {
        if (customDiv) customDiv.style.display = "grid";
        saveReceiptCustomPaperSize();
        return;
    }
    localStorage.setItem("pdf_mail_merge_receipt_paper_w", receiptPaperSizeSettings.width);
    localStorage.setItem("pdf_mail_merge_receipt_paper_h", receiptPaperSizeSettings.height);
}

function saveReceiptCustomPaperSize() {
    const wInput = document.getElementById("receiptPaperWidthInput");
    const hInput = document.getElementById("receiptPaperHeightInput");
    const w = parseFloat(wInput ? wInput.value : 210) || 210;
    const h = parseFloat(hInput ? hInput.value : 148) || 148;
    receiptPaperSizeSettings = { width: w, height: h };
    localStorage.setItem("pdf_mail_merge_receipt_paper_w", w);
    localStorage.setItem("pdf_mail_merge_receipt_paper_h", h);
}

// 7. 単独での奉納受領証（領収書）印刷 (用紙サイズ・@page設定付き)
async function printReceiptSingle() {
    const rawNameInput = document.getElementById("nameInput") ? document.getElementById("nameInput").value.trim() : "";
    const amountSelect = document.getElementById("amountSelect");
    let rawAmountInput = currentTemplate === "free" ? (document.getElementById("amountInput") ? document.getElementById("amountInput").value.trim() : "") : (amountSelect ? amountSelect.value : (document.getElementById("amountInput") ? document.getElementById("amountInput").value.trim() : ""));
    const bagNoInput = (document.getElementById("bagNoInput") ? document.getElementById("bagNoInput").value : "").trim();
    const rawAddressInput = (document.getElementById("addressInput") ? document.getElementById("addressInput").value : "").trim();
    const rawIssuerName = localStorage.getItem("pdf_mail_merge_receipt_issuer") || "奉納事業実行委員会";
    const rawIssuerAddress = localStorage.getItem("pdf_mail_merge_receipt_issuer_address") || "";

    const nameInput = expandCompatChars(rawNameInput);
    const amountInput = expandCompatChars(rawAmountInput);
    const addressInput = expandCompatChars(rawAddressInput);
    const issuerName = expandCompatChars(rawIssuerName);
    const issuerAddress = expandCompatChars(rawIssuerAddress);

    if (!nameInput) {
        showToast("奉納者氏名を入力してください", "error");
        return;
    }

    let displayAmount = amountInput;
    if (currentTemplate === "10000en") displayAmount = `一金 ${amountInput || "一"}萬圓也`;
    else if (currentTemplate === "1000en") displayAmount = `一金 ${amountInput || "一"}阡圓也`;

    showToast("📄 奉納受領証（領収書）を発行中...");

    const todayStr = new Date().toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });

    const W = receiptPaperSizeSettings.width || 210;
    const H = receiptPaperSizeSettings.height || 148;

    // スケール係数 (A5横 210mm x 148mm 基準)
    const scale = Math.min(W / 210, H / 148);

    const fontTitle = Math.max(16, Math.round(28 * scale));
    const fontDateNo = Math.max(10, Math.round(14 * scale));
    const fontName = Math.max(14, Math.round(22 * scale));
    const fontAmount = Math.max(14, Math.round(22 * scale));
    const fontProviso = Math.max(11, Math.round(15 * scale));
    const fontIssuer = Math.max(12, Math.round(18 * scale));
    const fontSubAddr = Math.max(10, Math.round(12 * scale));
    const fontNote = Math.max(9, Math.round(11 * scale));
    const stampSize = Math.max(45, Math.round(70 * scale));
    const stampFont = Math.max(8, Math.round(10 * scale));
    const paddingContainer = Math.max(8, Math.round(24 * scale));

    const receiptHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>奉納受領証 - ${escapeHTML(nameInput)} 様</title>
            <style>
                @page {
                    size: ${W}mm ${H}mm;
                    margin: 0;
                }
                * { box-sizing: border-box; }
                html, body {
                    width: ${W}mm;
                    height: ${H}mm;
                    margin: 0;
                    padding: 0;
                    background: #fff;
                    font-family: 'Yu Mincho', '游明朝', 'Hiragino Mincho ProN', serif;
                    overflow: hidden;
                }
                .page-wrap {
                    width: ${W}mm;
                    height: ${H}mm;
                    padding: ${Math.max(3, Math.round(8 * scale))}mm;
                    box-sizing: border-box;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .container {
                    width: 100%;
                    height: 100%;
                    border: ${Math.max(2, Math.round(3 * scale))}px double #4a1c1d;
                    padding: ${paddingContainer}px;
                    display: flex;
                    flex-direction: column;
                    justify-content: space-between;
                    border-radius: 6px;
                }
                .header { text-align: center; border-bottom: 2px solid #4a1c1d; padding-bottom: ${Math.max(4, Math.round(8 * scale))}px; margin-bottom: ${Math.max(6, Math.round(14 * scale))}px; }
                .title { font-size: ${fontTitle}px; font-weight: bold; letter-spacing: 6px; color: #4a1c1d; }
                .date-no { display: flex; justify-content: space-between; font-size: ${fontDateNo}px; margin-bottom: ${Math.max(6, Math.round(14 * scale))}px; color: #334155; }
                .name-box { font-size: ${fontName}px; font-weight: bold; border-bottom: 1.5px solid #333; padding-bottom: 4px; margin-bottom: ${Math.max(6, Math.round(14 * scale))}px; width: 80%; }
                .amount-box { font-size: ${fontAmount}px; font-weight: bold; text-align: center; background: #fdf2f4; border: 2px solid #8c2d38; padding: ${Math.max(6, Math.round(10 * scale))}px; margin-bottom: ${Math.max(6, Math.round(14 * scale))}px; border-radius: 6px; }
                .proviso { font-size: ${fontProviso}px; margin-bottom: ${Math.max(6, Math.round(16 * scale))}px; line-height: 1.5; }
                .footer { display: flex; justify-content: space-between; align-items: flex-end; margin-top: auto; }
                .issuer { font-size: ${fontIssuer}px; font-weight: bold; line-height: 1.4; text-align: right; word-break: break-all; }
                .stamp-box { border: 1px dashed #94a3b8; width: ${stampSize}px; height: ${stampSize}px; display: flex; align-items: center; justify-content: center; font-size: ${stampFont}px; color: #64748b; text-align: center; border-radius: 4px; flex-shrink: 0; }
                .note { font-size: ${fontNote}px; color: #64748b; margin-top: ${Math.max(4, Math.round(8 * scale))}px; border-top: 1px solid #e2e8f0; padding-top: 4px; }
            </style>
        </head>
        <body onload="window.print()">
            <div class="page-wrap">
                <div class="container">
                    <div>
                        <div class="header">
                            <div class="title">奉 納 受 領 証</div>
                        </div>
                        <div class="date-no">
                            <div>No. ${escapeHTML(bagNoInput) || '----'}</div>
                            <div>日付: ${todayStr}</div>
                        </div>
                        <div class="name-box">
                            ${escapeHTML(nameInput)} 様
                        </div>
                        <div class="amount-box">
                            金額 / 奉納: ${escapeHTML(displayAmount)}
                        </div>
                        <div class="proviso">
                            但し 奉納金（初穂料）として、正に受領いたしました。
                        </div>
                    </div>
                    <div>
                        <div class="footer">
                            <div class="stamp-box">
                                非課税<br>(印紙不要)
                            </div>
                            <div class="issuer">
                                ${escapeHTML(issuerName)}
                                ${issuerAddress ? `<div style="font-size: ${fontSubAddr}px; font-weight: normal; color: #334155; margin-top: 2px;">${escapeHTML(issuerAddress)}</div>` : ''}
                                ${addressInput ? `<div style="font-size: ${fontSubAddr}px; font-weight: normal; color: #475569; margin-top: 2px;">（奉納者住所: ${escapeHTML(addressInput)}）</div>` : ''}
                            </div>
                        </div>
                        <div class="note">
                            ※宗教法人法・印紙税法に基づき、奉納金・初穂料につき収入印紙は非課税となります。
                        </div>
                    </div>
                </div>
            </div>
        </body>
        </html>
    `;

    const printWin = window.open("", "_blank");
    if (printWin) {
        printWin.document.write(receiptHtml);
        printWin.document.close();
    } else {
        alert("ポップアップがブロックされました。ブラウザの設定でポップアップ許可をしてください。");
    }
}

