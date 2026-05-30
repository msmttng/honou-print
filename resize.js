const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

const mmToPt = (mm) => (mm * 72) / 25.4;

const oldWidthMm = 115;
const oldHeightMm = 398;
const newWidthMm = 109;
const newHeightMm = 399;

const newWidthPt = mmToPt(newWidthMm);
const newHeightPt = mmToPt(newHeightMm);

const shiftXMm = (newWidthMm - oldWidthMm) / 2; // (109 - 115) / 2 = -3
const shiftYMm = (newHeightMm - oldHeightMm) / 2; // (399 - 398) / 2 = +0.5

const shiftXPt = mmToPt(shiftXMm);
const shiftYPt = mmToPt(shiftYMm);

async function resizePdf(filename) {
    const filePath = path.join(__dirname, filename);
    if (!fs.existsSync(filePath)) {
        console.log(`Skipping ${filename} (not found)`);
        return;
    }
    
    // バックアップ作成
    const backupPath = filePath + '.bak';
    if (!fs.existsSync(backupPath)) {
        fs.copyFileSync(filePath, backupPath);
        console.log(`Created backup for ${filename}`);
    } else {
        // バックアップが存在する場合は、元のバックアップから読み込んで何度でも安全に実行できるようにする
        fs.copyFileSync(backupPath, filePath);
    }
    
    const pdfBytes = fs.readFileSync(filePath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pages = pdfDoc.getPages();
    
    for (const page of pages) {
        // 古い内容をシフトする
        page.translateContent(shiftXPt, shiftYPt);
        // 新しいサイズを設定する
        page.setSize(newWidthPt, newHeightPt);
    }
    
    const newPdfBytes = await pdfDoc.save();
    fs.writeFileSync(filePath, newPdfBytes);
    console.log(`Resized ${filename} to ${newWidthMm}x${newHeightMm} mm. Centered. Shifted X: ${shiftXMm}mm, Y: ${shiftYMm}mm.`);
}

async function run() {
    await resizePdf('奉納ビラ縦.pdf');
    await resizePdf('奉納ビラ縦阡.pdf');
    await resizePdf('奉納ビラフリー.pdf');
    console.log('All done!');
}

run().catch(console.error);
