#!/usr/bin/env python3
"""
一鍵將本機 data.json 上傳至 Firestore 雲端資料庫工具
使用方式：
1. 到 Firebase Console -> 專案設定 -> 服務帳戶 -> 產生新的私密金鑰，下載存成 serviceAccountKey.json
2. 執行：python3 upload_data_to_firebase.py
"""

import os
import sys
import json

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PARENT_DIR = os.path.dirname(SCRIPT_DIR)
LOCAL_DATA_FILE = os.path.join(PARENT_DIR, "data.json")
SERVICE_KEY_FILE = os.path.join(SCRIPT_DIR, "serviceAccountKey.json")

def main():
    print("=" * 60)
    print("🚀 投資儀表板 - Firestore 資料上傳工具")
    print("=" * 60)

    if not os.path.exists(LOCAL_DATA_FILE):
        print(f"❌ 找不到本機資料檔：{LOCAL_DATA_FILE}")
        return

    with open(LOCAL_DATA_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    tx_count = len(data.get("transactions", []))
    real_count = len(data.get("realizedRecords", []))
    div_count = len(data.get("dividendRecords", []))
    print(f"📊 已讀取本機資料：交易 {tx_count} 筆、已實現結算 {real_count} 筆、配息 {div_count} 筆")

    if not os.path.exists(SERVICE_KEY_FILE):
        print("\n💡 提示：您尚未下載 serviceAccountKey.json。")
        print("不用擔心！您有兩種方式將資料放上雲端：")
        print("【方式一 (最推薦/最簡單)】：")
        print("1. 將 remote-version 部署到 GitHub Pages 後，使用您的擁有者 Google 帳號登入。")
        print("2. 網頁版首次登入時，會自動提示將本機基準資料一鍵同步寫入 Firestore！")
        print("\n【方式二 (透過此腳本命令列直接上傳)】：")
        print("1. 至 Firebase Console (https://console.firebase.google.com/) -> 專案設定 -> 服務帳戶")
        print("2. 點擊「產生新的私密金鑰」，下載並重新命名為 serviceAccountKey.json 放至 remote-version/ 目錄")
        print("3. 安裝套件：pip install firebase-admin")
        print("4. 再次執行此腳本即可自動完成上傳！")
        return

    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
    except ImportError:
        print("❌ 請先安裝 firebase-admin 套件：pip install firebase-admin")
        return

    try:
        cred = credentials.Certificate(SERVICE_KEY_FILE)
        firebase_admin.initialize_app(cred)
        db = firestore.client()

        # 上傳到 portfolios/main
        data["version"] = 1
        data["updatedBy"] = "cli_migration"
        db.collection("portfolios").document("main").set(data)
        print("✅ 成功將資產與交易資料寫入 Firestore: portfolios/main")

        # 檢查 access/main
        acl_doc = db.collection("access").document("main").get()
        if not acl_doc.exists:
            owner_email = input("請輸入擁有者 Google Email (如 example@gmail.com): ").strip()
            if owner_email:
                db.collection("access").document("main").set({
                    "owner": owner_email,
                    "viewers": []
                })
                print(f"✅ 成功建立授權名單：擁有者 = {owner_email}")

        print("\n🎉 恭喜！雲端資料庫已就緒，您可以隨時在手機與公司電腦開啟查詢！")

    except Exception as e:
        print(f"❌ 上傳過程中發生錯誤: {e}")

if __name__ == "__main__":
    main()
