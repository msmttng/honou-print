import os
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from pdf_merge_tool import PDFMailMerger

def create_mock_templates():
    print("--- テスト用モックテンプレートの生成処理を開始します ---")
    
    # PDFMailMergerの初期化（フォントのダウンロードと登録を行うため）
    try:
        merger = PDFMailMerger()
    except Exception as e:
        print(f"初期化中にエラーが発生しました: {e}")
        print("システムフォントを使ったダミー生成を試みます。")
        merger = None

    # フォント名（登録されていればIPAexMincho、だめならHelvetica）
    font_name = "IPAexMincho" if (merger and os.path.exists(merger.font_path)) else "Helvetica"
    print(f"モックテンプレート生成用フォント: {font_name}")

    # 出力ファイル名と設定
    templates = [
        {
            "filename": "奉納ビラ縦.pdf",
            "title": "萬圓用テンプレート",
            "texts": [
                {"text": "奉  納", "x_mm": 105, "y_mm": 240, "size": 48},
                {"text": "金萬圓也", "x_mm": 105, "y_mm": 180, "size": 36},
                {"text": "殿", "x_mm": 155, "y_mm": 120, "size": 28} # 氏名の位置（105, 120）の右側
            ]
        },
        {
            "filename": "奉納ビラ縦阡.pdf",
            "title": "阡圓用テンプレート",
            "texts": [
                {"text": "奉  納", "x_mm": 105, "y_mm": 240, "size": 48},
                {"text": "金阡圆也", "x_mm": 105, "y_mm": 180, "size": 36},
                {"text": "殿", "x_mm": 155, "y_mm": 120, "size": 28} # 氏名の位置（105, 120）の右側
            ]
        },
        {
            "filename": "奉納ビラフリー.pdf",
            "title": "フリー金額用テンプレート",
            "texts": [
                {"text": "奉  納", "x_mm": 105, "y_mm": 240, "size": 48},
                {"text": "殿", "x_mm": 155, "y_mm": 160, "size": 28} # 氏名の位置（105, 160）の右側
                # 金額はマージされるため、ここには印字しない
            ]
        }
    ]

    base_dir = os.path.dirname(os.path.abspath(__file__))

    for t in templates:
        filepath = os.path.join(base_dir, t["filename"])
        if os.path.exists(filepath) and os.path.getsize(filepath) > 0:
            print(f"テンプレートファイルが既に存在するため、モック生成をスキップします: {t['filename']}")
            continue
            
        print(f"モックテンプレートを作成中: {t['filename']}...")
        
        # Canvas of A4 size
        c = canvas.Canvas(filepath, pagesize=A4)
        
        # 背景にガイドラインとテスト用台紙である旨の文字を薄く描く（実際の台紙と区別するため）
        c.setStrokeColorRGB(0.9, 0.9, 0.9)
        c.setLineWidth(1)
        c.rect(10*mm, 10*mm, 190*mm, 277*mm) # 枠線
        
        c.setFont("Helvetica", 10)
        c.setFillColorRGB(0.7, 0.7, 0.7)
        c.drawCentredString(105*mm, 15*mm, f"[Mock Template: {t['title']}]")
        
        # 本文の描画
        c.setFillColorRGB(0.1, 0.1, 0.1) # ほぼ黒
        for text_info in t["texts"]:
            c.setFont(font_name, text_info["size"])
            x = text_info["x_mm"] * mm
            y = text_info["y_mm"] * mm
            
            # 「殿」や「金萬圓也」などを中央揃えで配置（モックの見た目用）
            if text_info["text"] == "殿":
                # 殿は氏名の右側に置くので左揃え
                c.drawString(x, y, text_info["text"])
            else:
                c.drawCentredString(x, y, text_info["text"])
        
        c.save()
        print(f"作成完了: {filepath}")

    print("--- 全てのモックテンプレートが正常に生成されました ---")

if __name__ == "__main__":
    create_mock_templates()
