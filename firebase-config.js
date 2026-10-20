/**
 * Firebase 與遠端雲端設定檔
 * 
 * 請至 Firebase Console (https://console.firebase.google.com/) 建立專案並新增 Web 應用程式，
 * 將產生的 firebaseConfig 複製並替換下方的設定內容。
 */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyDgXiFH7i7anRtISWOMkI3CdPLC4aYvypg",
  authDomain: "my-portfolio-dashboard-daniel.firebaseapp.com",
  projectId: "my-portfolio-dashboard-daniel",
  storageBucket: "my-portfolio-dashboard-daniel.firebasestorage.app",
  messagingSenderId: "713695310428",
  appId: "1:713695310428:web:2050b33ce1cb64650cac99",
  measurementId: "G-TXFW1QXD6K"
};

// 權限存取控制 (可在這裡設定預設擁有者與允許檢視的 Email 名單，亦可於 Firestore access/main 文件中維護)
window.REMOTE_ACCESS_CONFIG = {
  // 擁有者 Email (具有完整查看與編輯修改、新增交易權限)
  ownerEmail: "imsmallnew@gmail.com",

  // 允許遠端檢視的 Email 名單 (僅能查詢與瀏覽，無法編輯)
  viewerEmails: [
    // "family_member@gmail.com"
  ],

  // Cloudflare Worker 報價代理服務網址 (部署 worker/worker.js 獲得的網址)
  // 若尚未部署 Worker，系統會自動切換為瀏覽器前端直接抓取模式
  workerQuoteUrl: ""
};
