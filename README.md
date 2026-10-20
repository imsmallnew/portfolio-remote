# 富邦投資儀表板 (遠端與跨裝置雲端版)

> 本版本支援公司電腦、筆電、手機（iOS / Android）異地即時查詢與管理。透過 **GitHub Pages** 託管前端，**Firebase Google 驗證 + Firestore 雲端資料庫** 保障隱私與即時同步。

---

## 架構與安全性保證

1. **零隱私洩漏**：GitHub Pages 上的專案原始碼**不包含任何您的個人資產、交易紀錄或持股資料**。
2. **身分權限把關 (Google Auth)**：
   - **擁有者（您）**：具備完整瀏覽、編輯、新增交易、調整資產之權限。
   - **授權檢視者（指定的親友帳號）**：僅能即時查詢、檢視各項圖表與損益，無編輯按鈕。
   - **未授權人士**：即使知道您的 GitHub Pages 網址，登入時也會被雲端資料庫直接阻絕。
3. **跨裝置即時同步**：手機、公司、家裡雙向自動連線，在任何裝置新增交易，其他分頁數秒內自動同步刷新。

---

## 快速設定步驟（約 5~10 分鐘）

### 步驟 1：建立 Firebase 專案與啟用 Google 登入
1. 前往 [Firebase Console](https://console.firebase.google.com/)，點擊「新增專案」（可命名為 `my-portfolio-dashboard`）。
2. 左側選單點擊 **Authentication (身分驗證)** ->「開始使用」-> 在登入方法中選擇 **Google** -> 啟用並儲存。
3. 左側選單點擊 **Firestore Database** ->「建立資料庫」：
   - 安全規則先選擇「以測試模式啟動」（稍後替換為正式安全規則）。
   - 地區建議選擇 `asia-east1` (台灣) 以獲取最快連線速度。

---

### 步驟 2：設定 Firestore 安全規則 (安全關鍵)
點擊 Firestore 的「規則 (Rules)」分頁，將內容替換為下方規則並點擊「發布」：

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // 取得存取控制名單
    function getAcl() {
      return get(/databases/$(database)/documents/access/main).data;
    }
    
    function isOwner() {
      return request.auth != null && 
             request.auth.token.email_verified && 
             request.auth.token.email.lower() == getAcl().owner.lower();
    }
    
    function isViewer() {
      return request.auth != null && 
             request.auth.token.email_verified && 
             (request.auth.token.email.lower() in getAcl().viewers || isOwner());
    }

    // 投資數據集合：擁有者可讀寫，檢視者只能讀取
    match /portfolios/{docId} {
      allow read: if isViewer();
      allow write: if isOwner();
    }

    // 權限名單：僅允許檢視者讀取，禁止由前端隨意寫入 (由後台維護)
    match /access/{docId} {
      allow read: if request.auth != null;
      allow write: if false;
    }
  }
}
```

---

### 步驟 3：取得網頁設定並填入 `firebase-config.js`
1. 在 Firebase 專案總覽中，點擊網頁圖示 `</>` 新增 Web 應用程式。
2. 複製產生的 `firebaseConfig` 物件，貼入本目錄下的 `firebase-config.js`：
```javascript
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSy...",
  authDomain: "my-portfolio.firebaseapp.com",
  projectId: "my-portfolio",
  storageBucket: "my-portfolio.appspot.com",
  messagingSenderId: "...",
  appId: "..."
};

window.REMOTE_ACCESS_CONFIG = {
  ownerEmail: "your_name@gmail.com", // 您的擁有者 Google Email
  viewerEmails: [
    "family_member@gmail.com"        // 允許查看的親友 Email
  ],
  workerQuoteUrl: ""                 // 步驟 5 若有部署 Worker 填入
};
```
3. 在 Firebase Console -> **Authentication** -> **設定 (Settings)** -> **授權網域 (Authorized domains)** 中，加入：
   - `localhost`
   - `你的GitHub帳號.github.io`

---

### 步驟 4：推送到 GitHub 並開啟 GitHub Pages
1. 在 GitHub 上建立一個新的公開儲存庫（例如 `portfolio-remote`）。
2. 在本機 `remote-version` 目錄中初始化並推送：
```bash
cd remote-version
git init
git add .
git commit -m "Initial commit for remote portfolio dashboard"
git branch -M main
git remote add origin https://github.com/你的帳號/portfolio-remote.git
git push -u origin main
```
3. 到 GitHub 儲存庫的 **Settings** -> **Pages**：
   - Source 選擇 `GitHub Actions`。
   - 等待 Actions 自動發布完成，即可取得遠端網址：`https://你的帳號.github.io/portfolio-remote/`！

---

### 步驟 5 (選填)：部署 Cloudflare Worker 代抓即時行情
若希望在遠端查詢時也能點擊「更新報價」即時抓取 TradingView 與美元匯率：
1. 進入 `remote-version/worker/` 目錄。
2. 執行：
```bash
npx wrangler login
npx wrangler deploy
```
3. 部署完成後會得到一個網址（如 `https://fubon-quotes-worker.你的子網域.workers.dev`），將此網址貼至 `firebase-config.js` 中的 `workerQuoteUrl` 即可！

---

## 手機瀏覽體驗（加入主畫面）
- **iOS Safari**：開啟網頁後，點擊底部「分享」圖示 -> 選擇「加入主畫面」，即可像原生 App 一樣全螢幕開啟。
- **Android Chrome**：點擊右上角選單 `⋮` -> 選擇「安裝應用程式」或「加到主螢幕」。
