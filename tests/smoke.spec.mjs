#!/usr/bin/env node
// E2Eスモークテスト（Playwright / chromium.launch を直接利用）
//
// @playwright/test のテストランナーは導入されていない（playwright パッケージのみ）ため、
// このファイルは素の Node スクリプトとして書かれており、`node tests/smoke.spec.mjs` で実行する。
// アプリ本体（app.js / index.html 等）は一切書き換えない。
//
// テスト対象は http://localhost:8767/ を優先して使うが、そのポートで何も応答していない場合は
// このスクリプト自身が `python3 -m http.server` をリポジトリルートで一時的に起動し、
// 終了時に必ず後片付けする（= 単独実行でも再現可能）。
//
// ネットワーク制限により Google Fonts / GAS(script.google.com) へのアクセスは失敗するため、
// それに起因する console.error / ERR_FAILED / Failed to fetch は無視する。
// ただし pageerror（未捕捉のJS例外）は無視せず、1件でもあれば失敗とする。

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, "..");
const PREFERRED_URL = "http://localhost:8766/";
const FALLBACK_PORT = 8899;

let failures = 0;
let passed = 0;

function ok(condition, message) {
    if (condition) {
        passed++;
        console.log(`  OK: ${message}`);
    } else {
        failures++;
        console.error(`  NG: ${message}`);
    }
}

function checkUrlAlive(url) {
    return new Promise((resolve) => {
        const req = http.get(url, (res) => {
            res.resume();
            resolve(true);
        });
        req.on("error", () => resolve(false));
        req.setTimeout(1500, () => {
            req.destroy();
            resolve(false);
        });
    });
}

function isIgnorableNetworkNoise(text) {
    return (
        text.includes("fonts.googleapis.com") ||
        text.includes("fonts.gstatic.com") ||
        text.includes("script.google.com") ||
        text.includes("ERR_FAILED") ||
        text.includes("ERR_NAME_NOT_RESOLVED") ||
        text.includes("ERR_CONNECTION") ||
        text.includes("ERR_INTERNET_DISCONNECTED") ||
        text.includes("Failed to fetch") ||
        text.includes("net::ERR")
    );
}

async function startFallbackServer() {
    const pythonCmd = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
    const proc = spawn(pythonCmd, ["-m", "http.server", String(FALLBACK_PORT)], {
        cwd: ROOT_DIR,
        stdio: "ignore",
        shell: process.platform === "win32",
    });
    // サーバ起動待ち（最大5秒）
    const url = `http://localhost:${FALLBACK_PORT}/`;
    for (let i = 0; i < 25; i++) {
        await new Promise((r) => setTimeout(r, 200));
        if (await checkUrlAlive(url)) return { proc, url };
    }
    proc.kill();
    throw new Error("フォールバックHTTPサーバの起動に失敗しました");
}

async function main() {
    console.log("=== E2Eスモークテスト開始 ===");

    let targetUrl = PREFERRED_URL;
    let fallbackProc = null;

    if (!(await checkUrlAlive(PREFERRED_URL))) {
        console.log(`${PREFERRED_URL} が応答しないため、一時サーバを起動します`);
        const { proc, url } = await startFallbackServer();
        fallbackProc = proc;
        targetUrl = url;
    } else {
        console.log(`既存のサーバ ${PREFERRED_URL} を使用します`);
    }

    const launchOptions = {};
    if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
        launchOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    } else if (process.platform !== "win32" && fs.existsSync("/opt/pw-browsers/chromium")) {
        launchOptions.executablePath = "/opt/pw-browsers/chromium";
    }
    const browser = await chromium.launch(launchOptions);
    const pageErrors = [];
    const consoleErrors = [];

    try {
        const page = await browser.newPage();

        // Service Worker を登録させない。
        // 登録すると controllerchange -> location.reload() が走り、page.evaluate 実行中に
        // "Execution context was destroyed" になってテストが不安定になるため。
        // register() を偽オブジェクトで差し替える方法は、app.js 側が受け取った registration を
        // 本物として扱うぶん挙動がぶれるので、sw.js の取得自体を止めて register() を
        // 自然に reject させる（app.js は .catch でこれを想定済み）。
        await page.route("**/sw.js", (route) => route.abort());

        page.on("pageerror", (err) => {
            pageErrors.push(String(err && err.stack ? err.stack : err));
        });
        page.on("console", (msg) => {
            if (msg.type() === "error") {
                consoleErrors.push(msg.text());
            }
        });

        // 1. トップページを開き、pageerror が0件であること
        console.log("\n[1] トップページを開く");
        await page.goto(targetUrl, { waitUntil: "load", timeout: 30000 });

        // 2. 初期化完了待ち（#statusText が「準備完了」相当になるまで）
        console.log("[2] 初期化完了(#statusText)を待機");
        await page.waitForFunction(
            () => {
                const el = document.getElementById("statusText");
                return !!el && el.textContent && el.textContent.includes("準備完了");
            },
            // 初回起動はフォント(4.5MB)+台紙PDFのダウンロードが入るため長めに取る
            { timeout: 120000 }
        ).catch(() => {
            // タイムアウトしても続行はするが、後段のチェックで失敗として扱われる
        });

        const statusText = await page.textContent("#statusText").catch(() => null);
        ok(!!statusText && statusText.includes("準備完了"), `#statusText が「準備完了」になっている（実際: "${statusText}"）`);

        // pageerror チェック（ネットワーク由来のノイズは元々 pageerror には出ないので、そのまま件数チェックでよい）
        ok(pageErrors.length === 0, `pageerror が0件である（実際: ${pageErrors.length}件）`);
        if (pageErrors.length > 0) {
            for (const e of pageErrors) console.error("    pageerror detail:", e);
        }

        // 参考情報として、ネットワーク起因以外の console.error があれば表示（失敗条件にはしない）
        const unexpectedConsoleErrors = consoleErrors.filter((t) => !isIgnorableNetworkNoise(t));
        if (unexpectedConsoleErrors.length > 0) {
            console.warn(`  参考: ネットワーク起因以外の console.error が ${unexpectedConsoleErrors.length}件あります`);
            for (const t of unexpectedConsoleErrors) console.warn("    console.error:", t);
        }

        // 3. #nameInput に値を入れて updatePreview() を実行し、#pdfCanvas の width/height > 0
        console.log("[3] #nameInput に値を設定して updatePreview() を実行");
        await page.evaluate(() => {
            const input = document.getElementById("nameInput");
            input.value = "テスト太郎";
        });
        await page.evaluate(() => updatePreview());
        await page.waitForFunction(
            () => {
                const c = document.getElementById("pdfCanvas");
                // 初期値(300x150)から実際の描画サイズに変わるまで待つ
                return !!c && (c.width !== 300 || c.height !== 150) && c.width > 0 && c.height > 0;
            },
            { timeout: 15000 }
        ).catch(() => {
            // タイムアウトしても後段のチェックで失敗として記録される
        });

        const canvasSize = await page.evaluate(() => {
            const c = document.getElementById("pdfCanvas");
            return c ? { width: c.width, height: c.height } : null;
        });
        ok(!!canvasSize, "#pdfCanvas が存在する");
        ok(!!canvasSize && canvasSize.width > 0, `#pdfCanvas.width > 0 である（実際: ${canvasSize && canvasSize.width}）`);
        ok(!!canvasSize && canvasSize.height > 0, `#pdfCanvas.height > 0 である（実際: ${canvasSize && canvasSize.height}）`);

        // 4. setPreviewZoom('field:name') → setPreviewZoom('fit') が例外なく動くこと
        console.log("[4] setPreviewZoom('field:name') → setPreviewZoom('fit')");
        const zoomResult = await page.evaluate(() => {
            try {
                setPreviewZoom("field:name");
                setPreviewZoom("fit");
                return { ok: true };
            } catch (e) {
                return { ok: false, error: String(e) };
            }
        });
        ok(zoomResult.ok, `setPreviewZoom が例外なく実行できる（${zoomResult.error || ""}）`);

        // 5. 名簿タブでチェックボックスを操作したとき #batchToolbar が表示されること
        //    （初回起動時は名簿データが空のことがあるため、テスト用のチェックボックスを一時的に挿入して検証する）
        console.log("[5] チェックボックス操作で #batchToolbar が表示される");
        const toolbarResult = await page.evaluate(() => {
            const toolbar = document.getElementById("batchToolbar");
            if (!toolbar) return { toolbarExists: false };

            const displayBefore = getComputedStyle(toolbar).display;

            let cb = document.querySelector(".record-checkbox");
            let injected = false;
            if (!cb) {
                cb = document.createElement("input");
                cb.type = "checkbox";
                cb.className = "record-checkbox";
                cb.value = "smoke-test-id";
                document.body.appendChild(cb);
                injected = true;
            }
            cb.checked = true;
            updateBatchCount();
            const displayAfterCheck = getComputedStyle(toolbar).display;

            cb.checked = false;
            updateBatchCount();
            const displayAfterUncheck = getComputedStyle(toolbar).display;

            if (injected) cb.remove();

            return { toolbarExists: true, displayBefore, displayAfterCheck, displayAfterUncheck };
        });
        ok(toolbarResult.toolbarExists, "#batchToolbar が存在する");
        ok(
            toolbarResult.toolbarExists && toolbarResult.displayAfterCheck !== "none",
            `チェック時に #batchToolbar が表示される（実際: display=${toolbarResult.displayAfterCheck}）`
        );
        ok(
            toolbarResult.toolbarExists && toolbarResult.displayAfterUncheck === "none",
            `選択解除後は #batchToolbar が非表示に戻る（実際: display=${toolbarResult.displayAfterUncheck}）`
        );

        // 6. setStatsPeriod('today') / ('all') が例外なく動くこと
        console.log("[6] setStatsPeriod('today') / setStatsPeriod('all')");
        const statsResult = await page.evaluate(() => {
            try {
                setStatsPeriod("today");
                setStatsPeriod("all");
                return { ok: true };
            } catch (e) {
                return { ok: false, error: String(e) };
            }
        });
        ok(statsResult.ok, `setStatsPeriod が例外なく実行できる（${statsResult.error || ""}）`);
    } finally {
        await browser.close();
        if (fallbackProc) fallbackProc.kill();
    }

    console.log(`\n=== 結果: ${passed} OK / ${failures} NG ===`);
    if (failures > 0) {
        process.exitCode = 1;
    }
}

main().catch((e) => {
    console.error("スモークテスト実行中に予期しないエラー:", e);
    process.exitCode = 1;
});
