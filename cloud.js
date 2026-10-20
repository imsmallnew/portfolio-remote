/**
 * Cloud Storage & Remote Auth Adapter (Firebase Auth + Firestore)
 * 適用於 GitHub Pages 與遠端裝置（手機、公司電腦）
 */

(function () {
  const CloudStore = {
    isConfigured: false,
    currentUser: null,
    userRole: 'unauthorized', // 'owner' | 'viewer' | 'unauthorized'
    currentVersion: 0,
    db: null,
    auth: null,
    unsubscribeSnapshot: null,
    listeners: {
      onAuth: [],
      onData: []
    },

    init() {
      const cfg = window.FIREBASE_CONFIG;
      if (!cfg || cfg.apiKey === "YOUR_API_KEY" || !cfg.apiKey) {
        console.warn("⚠️ Firebase 尚未設定，處於本機展示模式。請於 firebase-config.js 填入您的 Firebase 設定。");
        this.isConfigured = false;
        return false;
      }

      try {
        if (!firebase.apps.length) {
          firebase.initializeApp(cfg);
        }
        this.auth = firebase.auth();
        this.db = firebase.firestore();
        this.isConfigured = true;

        // 監聽身分驗證變化
        this.auth.onAuthStateChanged(async (user) => {
          this.currentUser = user;
          if (user) {
            await this.resolveUserRole(user.email);
          } else {
            this.userRole = 'unauthorized';
            if (this.unsubscribeSnapshot) {
              this.unsubscribeSnapshot();
              this.unsubscribeSnapshot = null;
            }
          }
          this.emitAuth(user, this.userRole);
        });

        return true;
      } catch (err) {
        console.error("Firebase 初始化失敗:", err);
        return false;
      }
    },

    async resolveUserRole(email) {
      if (!email) {
        this.userRole = 'unauthorized';
        return;
      }
      const lowerEmail = email.toLowerCase().trim();
      const localAcl = window.REMOTE_ACCESS_CONFIG || {};

      // 1. 優先檢查本地設定檔中的 owner / viewers
      if (localAcl.ownerEmail && localAcl.ownerEmail.toLowerCase().trim() === lowerEmail) {
        this.userRole = 'owner';
        return;
      }
      if (Array.isArray(localAcl.viewerEmails)) {
        const matchesViewer = localAcl.viewerEmails.some(e => e.toLowerCase().trim() === lowerEmail);
        if (matchesViewer) {
          this.userRole = 'viewer';
          return;
        }
      }

      // 2. 嘗試從 Firestore access/main 取得雲端 ACL
      try {
        if (this.db) {
          const aclSnap = await this.db.collection('access').doc('main').get();
          if (aclSnap.exists) {
            const data = aclSnap.data() || {};
            const remoteOwner = (data.owner || '').toLowerCase().trim();
            const remoteViewers = (data.viewers || []).map(v => (v || '').toLowerCase().trim());

            if (remoteOwner && remoteOwner === lowerEmail) {
              this.userRole = 'owner';
              return;
            }
            if (remoteViewers.includes(lowerEmail)) {
              this.userRole = 'viewer';
              return;
            }
          }
        }
      } catch (e) {
        console.warn("讀取 access/main 權限設定時發生注意事件:", e);
      }

      // 3. 若為首次部署且未設定 ACL，第一位登入的使用者若有提供 ownerEmail 則比對
      // 若無設定任何名單，預設提示未授權
      this.userRole = 'unauthorized';
    },

    async signInWithGoogle() {
      if (!this.isConfigured) {
        alert("請先在 firebase-config.js 填入您的 Firebase 專案設定！");
        return null;
      }
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try {
        const result = await this.auth.signInWithPopup(provider);
        return result.user;
      } catch (err) {
        console.error("Google 登入失敗:", err);
        // 若彈出視窗被瀏覽器封鎖，改用 redirect
        if (err.code === 'auth/popup-blocked' || err.code === 'auth/cancelled-popup-request') {
          return await this.auth.signInWithRedirect(provider);
        }
        throw err;
      }
    },

    async signOut() {
      if (!this.auth) return;
      if (this.unsubscribeSnapshot) {
        this.unsubscribeSnapshot();
        this.unsubscribeSnapshot = null;
      }
      await this.auth.signOut();
    },

    onAuthChange(callback) {
      this.listeners.onAuth.push(callback);
      if (this.currentUser !== undefined) {
        callback(this.currentUser, this.userRole);
      }
    },

    emitAuth(user, role) {
      this.listeners.onAuth.forEach(cb => {
        try { cb(user, role); } catch (e) { console.error(e); }
      });
    },

    async loadPortfolio() {
      if (!this.isConfigured || !this.db) {
        return null;
      }
      try {
        const docSnap = await this.db.collection('portfolios').doc('main').get();
        if (docSnap.exists) {
          const data = docSnap.data();
          this.currentVersion = data.version || 1;
          return data;
        }
        return null;
      } catch (err) {
        console.error("從 Firestore 載入資料失敗:", err);
        throw err;
      }
    },

    subscribePortfolio(callback) {
      if (!this.isConfigured || !this.db) return null;
      if (this.unsubscribeSnapshot) {
        this.unsubscribeSnapshot();
      }

      this.unsubscribeSnapshot = this.db.collection('portfolios').doc('main')
        .onSnapshot((doc) => {
          if (doc.exists) {
            const data = doc.data();
            this.currentVersion = data.version || 1;
            callback(data);
          }
        }, (err) => {
          console.warn("Firestore 即時監聽注意:", err);
        });

      return this.unsubscribeSnapshot;
    },

    async savePortfolio(payload) {
      if (!this.isConfigured || !this.db) {
        throw new Error("Firebase 尚未配置");
      }
      if (this.userRole !== 'owner') {
        throw new Error("您無權限修改資料庫內容 (僅限擁有者)");
      }

      const docRef = this.db.collection('portfolios').doc('main');
      return await this.db.runTransaction(async (transaction) => {
        const sfDoc = await transaction.get(docRef);
        let newVersion = 1;
        if (sfDoc.exists) {
          const currentRemoteVersion = sfDoc.data().version || 0;
          newVersion = currentRemoteVersion + 1;
        }

        const dataToSave = {
          ...payload,
          version: newVersion,
          lastUpdated: new Date().toLocaleString('zh-TW', { hour12: false }),
          updatedBy: this.currentUser ? this.currentUser.email : 'owner',
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        transaction.set(docRef, dataToSave, { merge: true });
        this.currentVersion = newVersion;
        return { success: true, version: newVersion };
      });
    }
  };

  window.cloudStore = CloudStore;
})();
