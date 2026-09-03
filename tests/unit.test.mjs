// app.js を書き換えずに、テキスト抽出方式(load-app-functions.mjs)で
// 純粋関数だけを取り出してテストする。
//
// 期待値は app.js の実装を実際に読んで確定させたものであり、憶測では書いていない。
// 実装のバグと思われる挙動を見つけた場合は、そのバグを「再現するテスト」として書いた上で
// コメントでバグである旨を明記している（app.js 自体は修正しない）。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadAppFunctions } from "./load-app-functions.mjs";

const fns = loadAppFunctions([
    "parseKanjiNumber",
    "normalizeAddress",
    "stableIdFromRow",
    "tokenizeVertical",
    "kanaNormalize",
    "formatRelativeTime",
    "hasEmptyTag",
    "stripEmptyTag",
    "parseFlexibleDate",
    "computeStats",
    "getStatsRange",
    "shiftRangeOneYear",
    "filterRecordsByRange",
    "recordDate",
]);

// withAuthParam / withAuthPayload はグローバル変数 gasSharedToken を参照するため、
// トークン有無それぞれのケースを別々に注入して読み込む。
const fnsNoToken = loadAppFunctions(["withAuthParam", "withAuthPayload"], {
    globals: { gasSharedToken: "" },
});
const fnsWithToken = loadAppFunctions(["withAuthParam", "withAuthPayload"], {
    globals: { gasSharedToken: "secret-token-123" },
});

// 抽出漏れがあれば即座にテストスイート全体を失敗させる（黙ってスキップしない）
const REQUIRED = [
    "parseKanjiNumber",
    "normalizeAddress",
    "stableIdFromRow",
    "tokenizeVertical",
    "kanaNormalize",
    "formatRelativeTime",
    "hasEmptyTag",
    "stripEmptyTag",
    "parseFlexibleDate",
    "computeStats",
    "getStatsRange",
    "shiftRangeOneYear",
    "filterRecordsByRange",
    "recordDate",
];
describe("app.js からの関数抽出", () => {
    it("対象の全関数が抽出できている", () => {
        for (const name of REQUIRED) {
            expect(typeof fns[name], `${name} が関数として抽出されていること`).toBe("function");
        }
    });

    it("withAuthParam / withAuthPayload が抽出できている", () => {
        expect(typeof fnsNoToken.withAuthParam).toBe("function");
        expect(typeof fnsNoToken.withAuthPayload).toBe("function");
        expect(typeof fnsWithToken.withAuthParam).toBe("function");
        expect(typeof fnsWithToken.withAuthPayload).toBe("function");
    });
});

describe("parseKanjiNumber", () => {
    it("空文字・値なしは 0", () => {
        expect(fns.parseKanjiNumber("")).toBe(0);
        expect(fns.parseKanjiNumber(null)).toBe(0);
        expect(fns.parseKanjiNumber(undefined)).toBe(0);
    });

    it("数字を含まない文字列は 0", () => {
        expect(fns.parseKanjiNumber("あいうえお")).toBe(0);
    });

    it("単純な漢数字（一〜九）", () => {
        expect(fns.parseKanjiNumber("五")).toBe(5);
        expect(fns.parseKanjiNumber("伍")).toBe(5); // 大字
        expect(fns.parseKanjiNumber("九")).toBe(9);
    });

    it("『十』は 10 として扱われる", () => {
        expect(fns.parseKanjiNumber("十")).toBe(10);
        expect(fns.parseKanjiNumber("三十")).toBe(30);
    });

    // v84 で修正: 大字の「拾」「什」「陌」「佰」が smallUnitMap に無く、
    // 壱/弐/参/伍 は対応済みなのに「拾」だけ 0 になっていた（奉納札は大字表記が主体なので実害あり）。
    it("大字の単位「拾」「陌」「佰」に対応している", () => {
        expect(fns.parseKanjiNumber("拾")).toBe(10);
        expect(fns.parseKanjiNumber("参拾")).toBe(30);
        expect(fns.parseKanjiNumber("五拾")).toBe(50);
        expect(fns.parseKanjiNumber("壱阡五佰")).toBe(1500);
        expect(fns.parseKanjiNumber("金参萬伍阡円")).toBe(35000);
    });

    it("百・阡/千・萬/万 の組み合わせ", () => {
        expect(fns.parseKanjiNumber("百")).toBe(100);
        expect(fns.parseKanjiNumber("千")).toBe(1000);
        expect(fns.parseKanjiNumber("阡")).toBe(1000);
        expect(fns.parseKanjiNumber("万")).toBe(10000);
        expect(fns.parseKanjiNumber("萬")).toBe(10000);
    });

    // CHANGELOG: 「『十萬』『壱阡五百』などの複合表記が正しく集計されない問題を修正」
    it("複合表記『十萬』が正しく 100000 になる（CHANGELOGのバグ修正対象）", () => {
        expect(fns.parseKanjiNumber("十萬")).toBe(100000);
    });

    it("複合表記『壱阡五百』が正しく 1500 になる（CHANGELOGのバグ修正対象）", () => {
        expect(fns.parseKanjiNumber("壱阡五百")).toBe(1500);
    });

    it("『金五萬圓也』のような接頭辞・接尾辞付きでも 50000 になる", () => {
        expect(fns.parseKanjiNumber("金五萬圓也")).toBe(50000);
    });

    it("『弐阡円』が 2000 になる", () => {
        expect(fns.parseKanjiNumber("弐阡円")).toBe(2000);
    });

    it("アラビア数字が含まれる場合はアラビア数字を優先する（実装仕様）", () => {
        // parseKanjiNumber は「4. アラビア数字があればそれを優先して抽出」する実装のため、
        // 漢数字の単位(萬など)が付いていてもアラビア数字部分のみが返る。
        expect(fns.parseKanjiNumber("3万")).toBe(3);
        expect(fns.parseKanjiNumber("１０００")).toBe(1000); // 全角数字も半角化されて優先される
    });

    it("全角ゼロや0はアラビア数字優先の対象外（0より大きくないため）", () => {
        expect(fns.parseKanjiNumber("０")).toBe(0);
    });

    it("物品名（単位付き）で明らかな金銭表現がない場合は 0 円扱いになる", () => {
        expect(fns.parseKanjiNumber("ビール1ケース")).toBe(0);
        expect(fns.parseKanjiNumber("麦茶2本")).toBe(0);
    });
});

describe("normalizeAddress", () => {
    it("空/未入力は空文字", () => {
        expect(fns.normalizeAddress("")).toBe("");
        expect(fns.normalizeAddress(null)).toBe("");
        expect(fns.normalizeAddress(undefined)).toBe("");
    });

    it("〒+郵便番号で始まる場合、辞書一致すれば町名まで正規化される", () => {
        expect(fns.normalizeAddress("〒144-0043")).toBe("〒144-0043 東京都大田区羽田");
    });

    it("郵便番号(ハイフンなし)+続く住所を正規化できる", () => {
        expect(fns.normalizeAddress("1440043羽田1-1-1")).toBe("〒144-0043 東京都大田区羽田1-1-1");
    });

    it("全角数字・全角ハイフン・全角スペースを半角/全角統一して処理する", () => {
        expect(fns.normalizeAddress("144－0043　羽田１－１－１")).toBe(
            "〒144-0043 東京都大田区羽田1-1-1"
        );
    });

    it("郵便番号なしでも町名と一致すれば郵便番号・都道府県を補完する", () => {
        expect(fns.normalizeAddress("東京都大田区羽田1-1-1")).toBe(
            "〒144-0043 東京都大田区羽田1-1-1"
        );
    });

    it("辞書内の町名でも直前の文字列が都道府県・市区と一致しない場合は変化させない", () => {
        // "大田区" は isMatchCondition の許容パターン（"", "東京都大田区" 等）に含まれないため、
        // 単なる "大田区" 接頭では郵便番号補完は行われない（app.js の仕様どおり）
        expect(fns.normalizeAddress("大田区羽田1-1-1")).toBe("大田区羽田1-1-1");
    });

    it("辞書にない住所は変化させない", () => {
        expect(fns.normalizeAddress("存在しない町123")).toBe("存在しない町123");
    });
});

describe("stableIdFromRow", () => {
    // CHANGELOG: 「ID列が空の行を復元するたびにデータが二重登録される問題を修正
    //             （行内容から決定的なIDを生成）」
    it("同じ入力からは常に同じIDが生成される（決定性）", () => {
        const id1 = fns.stableIdFromRow("2026/07/20 15:30:00", "田中太郎", "五千円", "", "東京都大田区羽田1-1-1", 0);
        const id2 = fns.stableIdFromRow("2026/07/20 15:30:00", "田中太郎", "五千円", "", "東京都大田区羽田1-1-1", 0);
        expect(id1).toBe(id2);
    });

    it("複数回にわたって呼び出しても常に決定的である", () => {
        const ids = new Set();
        for (let i = 0; i < 20; i++) {
            ids.add(fns.stableIdFromRow("2026/07/20 15:30:00", "山田花子", "壱萬円", "袋A", "神奈川県川崎市川崎区中瀬1-2-3", 3));
        }
        expect(ids.size).toBe(1);
    });

    it("氏名が異なれば異なるIDになる", () => {
        const id1 = fns.stableIdFromRow("t", "田中太郎", "a", "", "", 0);
        const id2 = fns.stableIdFromRow("t", "鈴木一郎", "a", "", "", 0);
        expect(id1).not.toBe(id2);
    });

    it("金額が異なれば異なるIDになる", () => {
        const id1 = fns.stableIdFromRow("t", "n", "五千円", "", "", 0);
        const id2 = fns.stableIdFromRow("t", "n", "壱萬円", "", "", 0);
        expect(id1).not.toBe(id2);
    });

    it("タイムスタンプが異なれば異なるIDになる", () => {
        const id1 = fns.stableIdFromRow("2026/07/20 15:30:00", "n", "a", "", "", 0);
        const id2 = fns.stableIdFromRow("2026/07/20 15:31:00", "n", "a", "", "", 0);
        expect(id1).not.toBe(id2);
    });

    it("idx（同一行内の重複解決用インデックス）が異なれば異なるIDになる", () => {
        const id1 = fns.stableIdFromRow("t", "n", "a", "", "", 0);
        const id2 = fns.stableIdFromRow("t", "n", "a", "", "", 1);
        expect(id1).not.toBe(id2);
    });

    it("IDのプレフィックスは rec_res_ である", () => {
        expect(fns.stableIdFromRow("t", "n", "a")).toMatch(/^rec_res_[0-9a-z]+$/);
    });
});

describe("tokenizeVertical", () => {
    it("空文字は空配列", () => {
        expect(fns.tokenizeVertical("")).toEqual([]);
        expect(fns.tokenizeVertical(null)).toEqual([]);
    });

    it("通常の文字（長音記号・英数字・記号含む）は1文字ずつ type:char として分割される", () => {
        const result = fns.tokenizeVertical("ラーメンABC123ー");
        expect(result).toEqual([
            { type: "char", ch: "ラ" },
            { type: "char", ch: "ー" },
            { type: "char", ch: "メ" },
            { type: "char", ch: "ン" },
            { type: "char", ch: "A" },
            { type: "char", ch: "B" },
            { type: "char", ch: "C" },
            { type: "char", ch: "1" },
            { type: "char", ch: "2" },
            { type: "char", ch: "3" },
            { type: "char", ch: "ー" },
        ]);
    });

    it("拗音（小書き文字）もそのまま1文字の type:char として分割される", () => {
        const result = fns.tokenizeVertical("きゃ");
        expect(result).toEqual([
            { type: "char", ch: "き" },
            { type: "char", ch: "ゃ" },
        ]);
    });

    it("(株)のような括弧囲み漢字1文字は type:tcu の組文字トークンにまとめられる", () => {
        const result = fns.tokenizeVertical("(株)テスト");
        expect(result[0]).toEqual({ type: "tcu", unitText: "（株）" });
        expect(result.slice(1)).toEqual([
            { type: "char", ch: "テ" },
            { type: "char", ch: "ス" },
            { type: "char", ch: "ト" },
        ]);
    });

    it("全角括弧囲み漢字（有）も組文字として扱われる", () => {
        const result = fns.tokenizeVertical("（有）");
        expect(result).toEqual([{ type: "tcu", unitText: "（有）" }]);
    });

    it("組文字コードポイント（㈱ ㈲ 等）も対応する組文字トークンに変換される", () => {
        expect(fns.tokenizeVertical("㈱")).toEqual([{ type: "tcu", unitText: "（株）" }]);
        expect(fns.tokenizeVertical("㈲")).toEqual([{ type: "tcu", unitText: "（有）" }]);
    });

    it("㍿ は事前展開され『株式会社』4文字として分割される", () => {
        const result = fns.tokenizeVertical("㍿テスト");
        expect(result.slice(0, 4)).toEqual([
            { type: "char", ch: "株" },
            { type: "char", ch: "式" },
            { type: "char", ch: "会" },
            { type: "char", ch: "社" },
        ]);
    });
});

describe("kanaNormalize", () => {
    it("ひらがな・カタカナ・半角カナが同じ結果になる", () => {
        const a = fns.kanaNormalize("たなか");
        const b = fns.kanaNormalize("タナカ");
        const c = fns.kanaNormalize("ﾀﾅｶ");
        expect(a).toBe(b);
        expect(b).toBe(c);
        expect(a).toBe("タナカ");
    });

    it("空文字・未入力は空文字", () => {
        expect(fns.kanaNormalize("")).toBe("");
        expect(fns.kanaNormalize(null)).toBe("");
        expect(fns.kanaNormalize(undefined)).toBe("");
    });

    it("英字は小文字化される", () => {
        expect(fns.kanaNormalize("ABC")).toBe("abc");
    });
});

describe("hasEmptyTag / stripEmptyTag", () => {
    // CHANGELOG: 「名簿からの呼び出し・一括印刷時に『[空]』がそのまま印字される問題を修正」
    it("hasEmptyTag は [空] タグの有無を判定する", () => {
        expect(fns.hasEmptyTag("五千円 [空]")).toBe(true);
        expect(fns.hasEmptyTag("五千円")).toBe(false);
        expect(fns.hasEmptyTag(null)).toBe(false);
        expect(fns.hasEmptyTag(123)).toBe(false);
    });

    it("stripEmptyTag は [空] タグと前後の空白を除去する", () => {
        expect(fns.stripEmptyTag("五千円 [空]")).toBe("五千円");
        expect(fns.stripEmptyTag(" [空] 五千円")).toBe("五千円");
        expect(fns.stripEmptyTag("五千円")).toBe("五千円");
    });

    it("stripEmptyTag は文字列以外はそのまま返す", () => {
        expect(fns.stripEmptyTag(null)).toBe(null);
        expect(fns.stripEmptyTag(undefined)).toBe(undefined);
        expect(fns.stripEmptyTag(123)).toBe(123);
    });

    it("印字前に必ず [空] を除去した文字列を使えば『[空]』がそのまま印字される問題は起きない", () => {
        const raw = "金五萬圓也 [空]";
        expect(fns.hasEmptyTag(raw)).toBe(true);
        const stripped = fns.stripEmptyTag(raw);
        expect(stripped).toBe("金五萬圓也");
        expect(fns.hasEmptyTag(stripped)).toBe(false);
    });

    // 修正8: GAS側は全角「［空］」も有効なタグとして扱うため、全角にも対応する
    it("hasEmptyTag / stripEmptyTag は全角［空］にも対応する", () => {
        expect(fns.hasEmptyTag("金参萬圓也 ［空］")).toBe(true);
        expect(fns.stripEmptyTag("金参萬圓也 ［空］")).toBe("金参萬圓也");
        expect(fns.stripEmptyTag("［空］ 金参萬圓也")).toBe("金参萬圓也");
    });
});

describe("parseFlexibleDate", () => {
    // CHANGELOG: 「スプレッドシート由来の日付形式がSafari等でパースできず日時表示が壊れる問題を修正」
    it("ISO 8601形式（タイムゾーンなし）をパースできる", () => {
        const d = fns.parseFlexibleDate("2026-07-20T15:30:00");
        expect(d).not.toBeNull();
        expect(d.getFullYear()).toBe(2026);
        expect(d.getMonth()).toBe(6); // 0-indexed = 7月
        expect(d.getDate()).toBe(20);
    });

    it("ISO 8601形式（Z付き）をパースできる", () => {
        const d = fns.parseFlexibleDate("2026-07-20T15:30:00.000Z");
        expect(d).not.toBeNull();
        expect(d.toISOString()).toBe("2026-07-20T15:30:00.000Z");
    });

    it("スプレッドシート(GAS)由来の 'YYYY/M/D H:mm:ss' 形式をパースできる", () => {
        const d = fns.parseFlexibleDate("2026/7/20 15:30:00");
        expect(d).not.toBeNull();
        expect(d.getFullYear()).toBe(2026);
        expect(d.getMonth()).toBe(6);
        expect(d.getDate()).toBe(20);
        expect(d.getHours()).toBe(15);
        expect(d.getMinutes()).toBe(30);
    });

    it("秒なしの 'YYYY/M/D H:mm' 形式もパースできる", () => {
        const d = fns.parseFlexibleDate("2026/7/20 15:30");
        expect(d).not.toBeNull();
        expect(d.getHours()).toBe(15);
        expect(d.getMinutes()).toBe(30);
    });

    it("時刻なしの 'YYYY/M/D' 形式もパースできる（0時0分扱い）", () => {
        const d = fns.parseFlexibleDate("2026/7/20");
        expect(d).not.toBeNull();
        expect(d.getFullYear()).toBe(2026);
        expect(d.getHours()).toBe(0);
        expect(d.getMinutes()).toBe(0);
    });

    it("Dateインスタンスをそのまま渡した場合は有効ならそのまま返し、不正なら null", () => {
        const validDate = new Date(2026, 6, 20);
        expect(fns.parseFlexibleDate(validDate)).toBe(validDate);
        expect(fns.parseFlexibleDate(new Date("invalid"))).toBeNull();
    });

    it("無効な入力は例外を投げずに null を返す", () => {
        expect(() => fns.parseFlexibleDate("not a date")).not.toThrow();
        expect(fns.parseFlexibleDate("not a date")).toBeNull();
        expect(fns.parseFlexibleDate("")).toBeNull();
        expect(fns.parseFlexibleDate(null)).toBeNull();
        expect(fns.parseFlexibleDate(undefined)).toBeNull();
        expect(fns.parseFlexibleDate(12345)).toBeNull();
        expect(fns.parseFlexibleDate({})).toBeNull();
    });
});

describe("formatRelativeTime", () => {
    const BASE = new Date("2026-09-03T12:00:00.000Z");

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(BASE);
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("無効な日付は '--'", () => {
        expect(fns.formatRelativeTime("not a date")).toBe("--");
        expect(fns.formatRelativeTime(undefined)).toBe("--");
    });

    it("59秒前は『たった今』（60秒未満の境界）", () => {
        const iso = new Date(BASE.getTime() - 59 * 1000).toISOString();
        expect(fns.formatRelativeTime(iso)).toBe("たった今");
    });

    it("ちょうど60秒前は『1分前』（60秒未満の境界の外側）", () => {
        const iso = new Date(BASE.getTime() - 60 * 1000).toISOString();
        expect(fns.formatRelativeTime(iso)).toBe("1分前");
    });

    it("59分前は『59分前』（60分未満の境界）", () => {
        const iso = new Date(BASE.getTime() - 59 * 60 * 1000).toISOString();
        expect(fns.formatRelativeTime(iso)).toBe("59分前");
    });

    it("ちょうど60分前は『1時間前』（60分未満の境界の外側）", () => {
        const iso = new Date(BASE.getTime() - 60 * 60 * 1000).toISOString();
        expect(fns.formatRelativeTime(iso)).toBe("1時間前");
    });

    it("23時間前は『23時間前』（24時間未満の境界）", () => {
        const iso = new Date(BASE.getTime() - 23 * 60 * 60 * 1000).toISOString();
        expect(fns.formatRelativeTime(iso)).toBe("23時間前");
    });

    it("ちょうど24時間前は 'M/D HH:mm' 形式（24時間未満の境界の外側）", () => {
        const target = new Date(BASE.getTime() - 24 * 60 * 60 * 1000);
        const iso = target.toISOString();
        const expected = `${target.getMonth() + 1}/${target.getDate()} ${String(target.getHours()).padStart(2, "0")}:${String(target.getMinutes()).padStart(2, "0")}`;
        expect(fns.formatRelativeTime(iso)).toBe(expected);
    });
});

describe("computeStats", () => {
    // CHANGELOG v84: [空]タグ付きレコードは itemCount に数えつつ、金額は emptyTotalMoney 側に分離集計する
    it("[空]タグ・金額のみ・物品のみ・壊れた行が混在する配列を正しく集計する", () => {
        const records = [
            { name: "空タグ太郎", amount: "五千円 [空]" },      // [空]タグ付き: emptyTotalMoney += 5000, itemCount++
            { name: "金額花子", amount: "壱萬圓" },              // 金額のみ: totalMoney += 10000, moneyCount++
            { name: "物品次郎", amount: "ビール" },              // 物品のみ（金銭表現なし）: 0円だが itemCount++
            { name: "¥100 壊れた行", amount: "壱萬圓" },         // 壊れた旧データ: 集計から完全除外
        ];

        const stats = fns.computeStats(records);

        expect(stats.totalMoney).toBe(10000);
        expect(stats.emptyTotalMoney).toBe(5000);
        expect(stats.count).toBe(3); // 壊れた行を除いた有効レコード数
        expect(stats.moneyCount).toBe(1);
        expect(stats.itemCount).toBe(2);
    });
});

describe("getStatsRange", () => {
    const BASE = new Date(2026, 8, 3, 12, 0, 0, 0); // 2026-09-03 12:00 (ローカル時刻)

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(BASE);
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("today は当日 00:00:00.000 〜 23:59:59.999", () => {
        const range = fns.getStatsRange("today");
        expect(range.from).toEqual(new Date(2026, 8, 3, 0, 0, 0, 0));
        expect(range.to).toEqual(new Date(2026, 8, 3, 23, 59, 59, 999));
    });

    it("month は当月1日 〜 月末日 23:59:59.999", () => {
        const range = fns.getStatsRange("month");
        expect(range.from).toEqual(new Date(2026, 8, 1, 0, 0, 0, 0));
        expect(range.to).toEqual(new Date(2026, 8, 30, 23, 59, 59, 999)); // 9月は30日まで
    });

    it("year は当年1/1 〜 12/31 23:59:59.999", () => {
        const range = fns.getStatsRange("year");
        expect(range.from).toEqual(new Date(2026, 0, 1, 0, 0, 0, 0));
        expect(range.to).toEqual(new Date(2026, 11, 31, 23, 59, 59, 999));
    });

    it("all は null（絞り込み無し）", () => {
        expect(fns.getStatsRange("all")).toBeNull();
    });
});

describe("shiftRangeOneYear", () => {
    it("range が null なら null を返す", () => {
        expect(fns.shiftRangeOneYear(null)).toBeNull();
    });

    it("通常の日付は1年前の同日にシフトする", () => {
        const range = {
            from: new Date(2026, 5, 15, 9, 0, 0),
            to: new Date(2026, 5, 20, 18, 0, 0),
            label: "期間指定",
        };
        const shifted = fns.shiftRangeOneYear(range);
        expect(shifted.from).toEqual(new Date(2025, 5, 15, 9, 0, 0));
        expect(shifted.to).toEqual(new Date(2025, 5, 20, 18, 0, 0));
        expect(shifted.label).toBe("期間指定（前年同期）");
    });

    it("閏日（2/29）は前年の2/28に丸められる", () => {
        const leapDay = new Date(2024, 1, 29, 10, 30, 0); // 2024/2/29 10:30
        const range = { from: leapDay, to: leapDay, label: "閏日テスト" };
        const shifted = fns.shiftRangeOneYear(range);

        expect(shifted.from.getFullYear()).toBe(2023);
        expect(shifted.from.getMonth()).toBe(1); // 2月 (0-indexed)
        expect(shifted.from.getDate()).toBe(28); // 3/1にずれず2/28に丸められること
        expect(shifted.from.getHours()).toBe(10);
        expect(shifted.from.getMinutes()).toBe(30);
    });
});

describe("filterRecordsByRange", () => {
    const range = { from: new Date(2026, 0, 1, 0, 0, 0, 0), to: new Date(2026, 11, 31, 23, 59, 59, 999) };
    const inRange = { id: "in", date: "2026-06-15T00:00:00" };
    const outOfRange = { id: "out", date: "2025-06-15T00:00:00" };
    const brokenDate = { id: "broken", date: "not-a-date" };

    it("range指定時は範囲内のレコードだけを残す", () => {
        const result = fns.filterRecordsByRange([inRange, outOfRange, brokenDate], range);
        expect(result).toEqual([inRange]);
    });

    it("range が null のときは全件（日付パース失敗レコードも含む）を返す", () => {
        const result = fns.filterRecordsByRange([inRange, outOfRange, brokenDate], null);
        expect(result).toEqual([inRange, outOfRange, brokenDate]);
    });

    it("date が無く timestamp のみのレコードも recordDate 経由で判定される", () => {
        const timestampOnly = { id: "ts-only", timestamp: "2026-06-15T00:00:00" };
        const result = fns.filterRecordsByRange([timestampOnly], range);
        expect(result).toEqual([timestampOnly]);
    });
});

describe("withAuthParam / withAuthPayload", () => {
    it("トークンが空文字のときは引数を無加工で返す（移行期間の互換性）", () => {
        expect(fnsNoToken.withAuthParam("https://example.com/exec")).toBe("https://example.com/exec");
        const payload = { name: "太郎" };
        expect(fnsNoToken.withAuthPayload(payload)).toBe(payload); // 同一参照のまま返る
    });

    it("トークンありのとき、?を含まないURLには ? で auth クエリを付与する", () => {
        const result = fnsWithToken.withAuthParam("https://example.com/exec");
        expect(result).toBe("https://example.com/exec?auth=secret-token-123");
    });

    it("トークンありのとき、既に ? を含むURLには & で auth クエリを付与する", () => {
        const result = fnsWithToken.withAuthParam("https://example.com/exec?foo=1");
        expect(result).toBe("https://example.com/exec?foo=1&auth=secret-token-123");
    });

    it("トークンありのとき、payloadに auth が追加される（元のオブジェクトは変更しない）", () => {
        const payload = { name: "太郎" };
        const result = fnsWithToken.withAuthPayload(payload);
        expect(result).toEqual({ name: "太郎", auth: "secret-token-123" });
        expect(payload).toEqual({ name: "太郎" }); // 元オブジェクトは非破壊
        expect(result).not.toBe(payload);
    });
});
