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
    currentPortfolioId: 'main',
    portfolioOwnerEmail: '',
    db: null,
    auth: null,
    unsubscribeSnapshot: null,
    listeners: {
      onAuth: [],
      onData: []
    },

    getPortfolioIdFromUrl() {
      try {
        const params = new URLSearchParams(window.location.search);
        let id = (params.get('id') || 'main').toLowerCase().trim();
        if (id === 'daniel' || id === '') id = 'main';
        // 僅保留英數字、底線與連字號，長度不超過 30 字元
        const cleanId = id.replace(/[^a-z0-9_-]/g, '').slice(0, 30);
        return cleanId || 'main';
      } catch (e) {
        return 'main';
      }
    },

    init() {
      this.currentPortfolioId = this.getPortfolioIdFromUrl();
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
      const pid = this.currentPortfolioId || 'main';

      // 1. 若為預設核心儀表板 'main' (Daniel 專屬)
      if (pid === 'main') {
        const isDefaultOwner = localAcl.ownerEmail && localAcl.ownerEmail.toLowerCase().trim() === lowerEmail;
        if (isDefaultOwner) {
          this.userRole = 'owner';
          this.portfolioOwnerEmail = localAcl.ownerEmail;
          return;
        }
        if (Array.isArray(localAcl.viewerEmails) && localAcl.viewerEmails.some(e => e.toLowerCase().trim() === lowerEmail)) {
          this.userRole = 'viewer';
          return;
        }

        // 檢查 access/main 雲端名單
        try {
          if (this.db) {
            const aclSnap = await this.db.collection('access').doc('main').get();
            if (aclSnap.exists) {
              const data = aclSnap.data() || {};
              const remoteOwner = (data.owner || '').toLowerCase().trim();
              const remoteViewers = (data.viewers || []).map(v => (v || '').toLowerCase().trim());

              if (remoteOwner && remoteOwner === lowerEmail) {
                this.userRole = 'owner';
                this.portfolioOwnerEmail = remoteOwner;
                return;
              }
              if (remoteViewers.includes(lowerEmail)) {
                this.userRole = 'viewer';
                return;
              }
            }
          }
        } catch (e) {
          console.warn("讀取 access/main 權限注意:", e);
        }

        this.userRole = 'unauthorized';
        return;
      }

      // 2. 若為自訂多租戶儀表板 (如 ?id=alice, ?id=bob, ?id=mom)
      try {
        if (this.db) {
          const docSnap = await this.db.collection('portfolios').doc(pid).get();
          if (docSnap.exists) {
            const data = docSnap.data() || {};
            const docOwner = (data.owner || '').toLowerCase().trim();
            this.portfolioOwnerEmail = docOwner;
            const docViewers = (data.viewers || []).map(v => (v || '').toLowerCase().trim());

            // 系統最高管理員 (Daniel: imsmallnew@gmail.com) 具備全局查看/維護權限
            const isSystemAdmin = localAcl.ownerEmail && localAcl.ownerEmail.toLowerCase().trim() === lowerEmail;
            if (docOwner === lowerEmail || isSystemAdmin) {
              this.userRole = 'owner';
              return;
            }
            if (docViewers.includes(lowerEmail)) {
              this.userRole = 'viewer';
              return;
            }
            this.userRole = 'unauthorized';
            return;
          } else {
            // Document 尚不存在：當前登入者可作為此新組合之建立者 (Owner)
            this.portfolioOwnerEmail = lowerEmail;
            this.userRole = 'owner';
            return;
          }
        }
      } catch (err) {
        console.warn(`讀取 portfolio [${pid}] 失敗:`, err);
      }

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
        const pid = this.currentPortfolioId || 'main';
        const docSnap = await this.db.collection('portfolios').doc(pid).get();
        if (docSnap.exists) {
          const data = docSnap.data();
          this.currentVersion = data.version || 1;
          this.portfolioOwnerEmail = data.owner || '';
          return data;
        }
        return null;
      } catch (err) {
        console.error(`從 Firestore 載入 [${this.currentPortfolioId}] 失敗:`, err);
        throw err;
      }
    },

    subscribePortfolio(callback) {
      if (!this.isConfigured || !this.db) return null;
      if (this.unsubscribeSnapshot) {
        this.unsubscribeSnapshot();
      }

      const pid = this.currentPortfolioId || 'main';
      this.unsubscribeSnapshot = this.db.collection('portfolios').doc(pid)
        .onSnapshot((doc) => {
          if (doc.exists) {
            const data = doc.data();
            this.currentVersion = data.version || 1;
            this.portfolioOwnerEmail = data.owner || '';
            callback(data);
          }
        }, (err) => {
          console.warn(`Firestore 即時監聽 [${pid}] 注意:`, err);
        });

      return this.unsubscribeSnapshot;
    },

    async savePortfolio(payload) {
      if (!this.isConfigured || !this.db) {
        throw new Error("Firebase 尚未配置");
      }
      if (this.userRole !== 'owner') {
        throw new Error("您無權限修改此投資組合內容 (僅限該儀表板擁有者)");
      }

      const pid = this.currentPortfolioId || 'main';
      const docRef = this.db.collection('portfolios').doc(pid);
      return await this.db.runTransaction(async (transaction) => {
        const sfDoc = await transaction.get(docRef);
        let newVersion = 1;
        let originalOwner = this.currentUser ? this.currentUser.email : 'owner';
        if (sfDoc.exists) {
          const currentData = sfDoc.data() || {};
          const currentRemoteVersion = currentData.version || 0;
          newVersion = currentRemoteVersion + 1;
          if (currentData.owner) {
            originalOwner = currentData.owner;
          }
        } else if (pid === 'main') {
          originalOwner = window.REMOTE_ACCESS_CONFIG?.ownerEmail || (this.currentUser ? this.currentUser.email : 'owner');
        }

        const dataToSave = {
          ...payload,
          portfolioId: pid,
          owner: originalOwner,
          version: newVersion,
          lastUpdated: new Date().toLocaleString('zh-TW', { hour12: false }),
          updatedBy: this.currentUser ? this.currentUser.email : 'owner',
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        transaction.set(docRef, dataToSave, { merge: true });
        this.currentVersion = newVersion;
        this.portfolioOwnerEmail = originalOwner;
        return { success: true, version: newVersion, portfolioId: pid };
      });
    },

    listUserPortfolios() {
      const list = [
        { id: 'main', name: '👑 Daniel 核心投資儀表板 (預設)', isDefault: true }
      ];
      if (this.currentUser?.email) {
        const mySlug = this.currentUser.email.split('@')[0].toLowerCase().replace(/[^a-z0-9_-]/g, '');
        if (mySlug && mySlug !== 'imsmallnew' && mySlug !== 'main') {
          list.push({ id: mySlug, name: `👤 我的專屬組合 (${mySlug})`, isMine: true });
        }
      }
      return list;
    },

    async loadAcl() {
      const defaultOwner = (window.REMOTE_ACCESS_CONFIG?.ownerEmail || '').toLowerCase().trim();
      const defaultViewers = (window.REMOTE_ACCESS_CONFIG?.viewerEmails || []).map(e => (e || '').toLowerCase().trim());
      if (!this.isConfigured || !this.db) {
        return { owner: defaultOwner, viewers: defaultViewers };
      }
      try {
        const snap = await this.db.collection('access').doc('main').get();
        if (snap.exists) {
          const data = snap.data() || {};
          return {
            owner: (data.owner || defaultOwner).toLowerCase().trim(),
            viewers: Array.isArray(data.viewers) ? data.viewers.map(e => (e || '').toLowerCase().trim()) : defaultViewers
          };
        }
      } catch (err) {
        console.warn("讀取 access/main 失敗，使用本機設定:", err);
      }
      return { owner: defaultOwner, viewers: defaultViewers };
    },

    async saveAcl(viewers) {
      if (!this.isConfigured || !this.db) {
        throw new Error("Firebase 尚未配置");
      }
      if (this.userRole !== 'owner') {
        throw new Error("僅擁有者具備修改授權名單權限");
      }
      const cleanViewers = Array.isArray(viewers) 
        ? viewers.map(v => (v || '').toLowerCase().trim()).filter(Boolean)
        : [];
      
      const owner = (window.REMOTE_ACCESS_CONFIG?.ownerEmail || this.currentUser?.email || '').toLowerCase().trim();
      await this.db.collection('access').doc('main').set({
        owner: owner,
        viewers: cleanViewers,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedBy: this.currentUser?.email || 'owner'
      }, { merge: true });

      return cleanViewers;
    }
  };

  window.cloudStore = CloudStore;
})();
