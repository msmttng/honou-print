// app.js はビルド工程なし・ES Modules不使用の単一ファイル(グローバル関数)であり、
// document / indexedDB / navigator に依存するコードが同居しているため Node でそのまま
// require/import することができない。
//
// このヘルパーは app.js を「書き換えずに」テキストとして読み込み、テスト対象の純粋関数
// （および、その関数が参照しているグローバル定数）だけを波括弧の深さを数えて正確に
// 切り出し、new Function() で評価してエクスポートする。
//
// 抽出したコード片は new Function() に通した時点で構文エラーがあれば例外になるため、
// 「文字列だけ切り出せたが実際には壊れている」ケースは自動的に検出される。
// 加えて、指定した関数/定数が1つでも見つからなければ明示的に例外を投げる
// （app.js のリファクタで関数名が変わった場合にテストが気づけるようにするため）。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const APP_JS_PATH = path.join(__dirname, "..", "app.js");

// -----------------------------------------------------------------------
// 低レベルのトークンスキャナ
// -----------------------------------------------------------------------

// index i が「文字列 / テンプレートリテラル / 行コメント / ブロックコメント / 正規表現リテラル」
// の先頭であれば、そのトークンの直後のindexを返す。そうでなければ null。
function skipOpaqueToken(text, i) {
    const c = text[i];

    if (c === "/" && text[i + 1] === "/") {
        let j = i + 2;
        while (j < text.length && text[j] !== "\n") j++;
        return j;
    }
    if (c === "/" && text[i + 1] === "*") {
        let j = i + 2;
        while (j < text.length && !(text[j] === "*" && text[j + 1] === "/")) j++;
        return Math.min(j + 2, text.length);
    }
    if (c === '"' || c === "'" || c === "`") {
        const quote = c;
        let j = i + 1;
        while (j < text.length) {
            if (text[j] === "\\") { j += 2; continue; }
            if (text[j] === quote) { j++; break; }
            j++;
        }
        return j;
    }
    if (c === "/") {
        // "/" が正規表現リテラルの開始かどうかをヒューリスティックに判定する
        // (割り算演算子との曖昧さは、直前の非空白文字が値を要求する文脈かどうかで判定)
        let k = i - 1;
        while (k >= 0 && /\s/.test(text[k])) k--;
        const prev = k >= 0 ? text[k] : "";
        const prevIsValueContext = "([{,;:=!&|?+-*%^~<>".includes(prev);
        const before = text.slice(Math.max(0, k - 5), k + 1);
        const afterReturn = /\breturn$/.test(before);
        if (prevIsValueContext || afterReturn || k < 0) {
            let j = i + 1;
            let inClass = false;
            while (j < text.length) {
                const cj = text[j];
                if (cj === "\\") { j += 2; continue; }
                if (cj === "[") { inClass = true; j++; continue; }
                if (cj === "]") { inClass = false; j++; continue; }
                if (cj === "\n") return null; // 正規表現ではないと判断（安全側）
                if (cj === "/" && !inClass) { j++; break; }
                j++;
            }
            while (j < text.length && /[a-z]/i.test(text[j])) j++;
            return j;
        }
        return null;
    }
    return null;
}

function skipTrivia(text, i) {
    while (i < text.length) {
        const c = text[i];
        if (c === " " || c === "\t" || c === "\r" || c === "\n") { i++; continue; }
        const skipTo = skipOpaqueToken(text, i);
        if (skipTo !== null && (text[i] === "/")) {
            // コメントのみここでスキップ（文字列や正規表現は呼び出し側の文脈で処理する）
            if (text[i + 1] === "/" || text[i + 1] === "*") { i = skipTo; continue; }
        }
        break;
    }
    return i;
}

// openSet/closeSet の文字だけを対象に深さを数え、depth が 0 に戻った直後の index を返す。
// 文字列・テンプレートリテラル・コメント・正規表現リテラルの中身は無視する。
function scanBalanced(text, startIndex, openSet, closeSet) {
    let i = startIndex;
    let depth = 0;
    let started = false;
    while (i < text.length) {
        const skipTo = skipOpaqueToken(text, i);
        if (skipTo !== null) { i = skipTo; continue; }
        const c = text[i];
        if (openSet.includes(c)) { depth++; started = true; i++; continue; }
        if (closeSet.includes(c)) {
            depth--;
            i++;
            if (started && depth === 0) return i;
            continue;
        }
        i++;
    }
    throw new Error(`app.js の解析に失敗しました（index ${startIndex} 以降で括弧の対応が取れません）`);
}

// -----------------------------------------------------------------------
// 関数 / 定数の切り出し
// -----------------------------------------------------------------------

function extractFunction(text, name) {
    const re = new RegExp(`(^|[^\\w$])function\\s+${name}\\s*\\(`, "m");
    const m = re.exec(text);
    if (!m) {
        throw new Error(`app.js 内に関数 "${name}" が見つかりませんでした（関数名が変更された可能性があります）`);
    }
    const funcStart = m.index + m[0].indexOf("function");
    const parenOpenIdx = m.index + m[0].length - 1; // '(' の位置
    const afterParams = scanBalanced(text, parenOpenIdx, "(", ")");
    const braceOpenIdx = skipTrivia(text, afterParams);
    if (text[braceOpenIdx] !== "{") {
        throw new Error(`関数 "${name}" の本体開始 '{' が見つかりませんでした`);
    }
    const afterBody = scanBalanced(text, braceOpenIdx, "{", "}");
    return text.slice(funcStart, afterBody);
}

function extractConst(text, name) {
    const re = new RegExp(`(^|[^\\w$])const\\s+${name}\\s*=`, "m");
    const m = re.exec(text);
    if (!m) {
        throw new Error(`app.js 内に定数 "${name}" が見つかりませんでした`);
    }
    const constStart = m.index + m[0].indexOf("const");
    let i = m.index + m[0].length;
    let depth = 0;
    let terminated = false;
    while (i < text.length) {
        const skipTo = skipOpaqueToken(text, i);
        if (skipTo !== null) { i = skipTo; continue; }
        const c = text[i];
        if ("([{".includes(c)) depth++;
        else if (")]}".includes(c)) depth--;
        else if (c === ";" && depth === 0) { i++; terminated = true; break; }
        i++;
    }
    if (!terminated) {
        throw new Error(`定数 "${name}" の終端(;)が見つかりませんでした`);
    }
    return text.slice(constStart, i);
}

// -----------------------------------------------------------------------
// 公開API
// -----------------------------------------------------------------------

// name: 関数名。functionDeps に、その関数が依存する他のグローバル関数名/定数名を指定できる。
const FUNCTION_DEPENDENCIES = {
    normalizeAddress: ["ZIP_DICT"],
    hasEmptyTag: ["EMPTY_TAG_RE"],
    stripEmptyTag: ["EMPTY_TAG_RE"],
    computeStats: ["parseKanjiNumber"],
    filterRecordsByRange: ["recordDate", "parseFlexibleDate"],
};

const KNOWN_CONSTANTS = new Set(["ZIP_DICT", "EMPTY_TAG_RE"]);

/**
 * 指定した関数群を app.js から抽出し、実行して { 関数名: 関数 } のオブジェクトを返す。
 * 抽出・構文検証に失敗した関数が1つでもあれば例外を投げる（黙ってスキップしない）。
 *
 * options.globals: 抽出した関数が参照する let/var のグローバル変数（例: gasSharedToken）の
 * 初期値を { 変数名: 値 } の形で注入する。app.js を書き換えずに済むよう、
 * new Function の引数として渡し、抽出コードのスコープにその名前の変数を作る。
 */
export function loadAppFunctions(names, options = {}) {
    const text = fs.readFileSync(APP_JS_PATH, "utf8");
    const globalOverrides = options.globals || {};
    const globalNames = Object.keys(globalOverrides);

    const neededFunctions = new Set(names);
    const neededConstants = new Set();
    for (const n of names) {
        const deps = FUNCTION_DEPENDENCIES[n] || [];
        for (const d of deps) {
            if (KNOWN_CONSTANTS.has(d)) neededConstants.add(d);
            else neededFunctions.add(d);
        }
    }

    const pieces = [];
    const errors = [];

    for (const constName of neededConstants) {
        try {
            const code = extractConst(text, constName);
            new Function(code); // 構文検証（失敗したら例外を投げる）
            pieces.push(code);
        } catch (e) {
            errors.push(`[${constName}] ${e.message}`);
        }
    }

    for (const fnName of neededFunctions) {
        try {
            const code = extractFunction(text, fnName);
            new Function(code); // 構文検証（失敗したら例外を投げる）
            pieces.push(code);
        } catch (e) {
            errors.push(`[${fnName}] ${e.message}`);
        }
    }

    if (errors.length > 0) {
        throw new Error(
            `app.js からの関数抽出に失敗しました:\n${errors.join("\n")}`
        );
    }

    const exportNames = Array.from(neededFunctions).join(", ");
    const body = `${pieces.join("\n\n")}\n\nreturn { ${exportNames} };`;
    const factory = new Function(...globalNames, body);
    return factory(...globalNames.map(n => globalOverrides[n]));
}
