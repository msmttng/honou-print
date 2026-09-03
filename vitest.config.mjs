import { defineConfig } from "vitest/config";

// tests/smoke.spec.mjs は vitest のテストではなく、Playwright を直接使う独立した
// Node スクリプト（`npm run test:e2e` で実行）なので、vitest の収集対象から除外する。
export default defineConfig({
    test: {
        include: ["tests/**/*.test.mjs"],
    },
});
