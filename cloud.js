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
        let rawId = params.get('id');
        if (!rawId) return 'main';
        let id = decodeURIComponent(rawId).trim();
        const lowerId = id.toLowerCase();
        if (lowerId === 'daniel' || lowerId === 'imsmallnew' || lowerId === 'main' || lowerId === '') {
          return 'main';
        }
        // 支援中文字、英數字、底線與連字號，長度不超過 30 字元
        const cleanId = id.replace(/[^\w\u4e00-\u9fa5_-]/g, '').slice(0, 30);
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

        // 捕捉跳轉登入結果 (例如手機瀏覽器跳轉回來)
        this.auth.getRedirectResult().then(async (result) => {
          if (result && result.user) {
            this.currentUser = result.user;
            await this.resolveUserRole(result.user.email);
            this.emitAuth(this.currentUser, this.userRole);
          }
        }).catch((err) => {
          console.warn("getRedirectResult 注意:", err);
        });

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

      // 系統最高管理員 (Daniel: imsmallnew@gmail.com 或 localAcl.ownerEmail)
      const isSystemAdmin = lowerEmail === 'imsmallnew@gmail.com' || 
        (localAcl.ownerEmail && localAcl.ownerEmail.toLowerCase().trim() === lowerEmail);

      if (isSystemAdmin) {
        this.userRole = 'owner';
        this.portfolioOwnerEmail = lowerEmail;
        return;
      }

      // 檢查此登入者是否已獲白名單授權（查詢 access/main 中的 viewers 或 localAcl）
      let isApprovedInWhitelist = false;
      if (Array.isArray(localAcl.viewerEmails) && localAcl.viewerEmails.some(e => e.toLowerCase().trim() === lowerEmail)) {
        isApprovedInWhitelist = true;
      }
      try {
        if (this.db) {
          const aclSnap = await this.db.collection('access').doc('main').get();
          if (aclSnap.exists) {
            const data = aclSnap.data() || {};
            const remoteViewers = (data.viewers || []).map(v => (v || '').toLowerCase().trim());
            if (remoteViewers.includes(lowerEmail)) {
              isApprovedInWhitelist = true;
            }
          }
        }
      } catch (e) {
        console.warn("讀取 access/main 白名單注意:", e);
      }

      // 1. 若為核心儀表板 'main' (包含 ?id=imsmallnew, ?id=main, ?id=daniel)
      if (pid === 'main') {
        if (isApprovedInWhitelist) {
          // 授權親友/訪客：可以「看」Daniel / 其他人的資料
          this.userRole = 'viewer';
          return;
        }
        this.userRole = 'unauthorized';
        return;
      }

      // 2. 若為自訂多租戶空間 (如 ?id=訪客id, ?id=alice, ?id=bob)
      try {
        if (this.db) {
          const docSnap = await this.db.collection('portfolios').doc(pid).get();
          if (docSnap.exists) {
            const data = docSnap.data() || {};
            const docOwner = (data.owner || '').toLowerCase().trim();
            this.portfolioOwnerEmail = docOwner;
            const docViewers = (data.viewers || []).map(v => (v || '').toLowerCase().trim());

            if (docOwner === lowerEmail) {
              // 該組合之擁有者：可以「進入維護自己的資料」
              this.userRole = 'owner';
              return;
            }
            if (docViewers.includes(lowerEmail) || isApprovedInWhitelist) {
              // 授權親友或白名單成員：可以「看」其他人的資料
              this.userRole = 'viewer';
              return;
            }
            this.userRole = 'unauthorized';
            return;
          } else {
            // Document 尚不存在：當前登入者前往此自訂 ID，可作為此專屬組合之建立者 (Owner) 進入維護自己的資料！
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
        const errCode = err.code || '';
        const errMsg = err.message || '';

        if (errCode === 'auth/unauthorized-domain') {
          const currentHost = window.location.hostname;
          alert(`⚠️ Google 登入網域未授權：\n目前網址網域 [${currentHost}] 尚未加入 Firebase 授權名單。\n\n【解決方式】\n請至 Firebase Console (https://console.firebase.google.com/) -> 專案【my-portfolio-dashboard-daniel】-> Authentication -> Settings -> 授權網域 (Authorized domains)，新增「${currentHost}」即可！`);
          return null;
        }

        if (errCode === 'auth/invalid-action-code' || errMsg.includes('The requested action is invalid') || errCode === 'auth/configuration-not-found') {
          alert(`⚠️ Firebase Google 登入設定提醒：\n錯誤代碼：${errCode}\n訊息：The requested action is invalid.\n\n【解決步驟】\n這是因為 Firebase Console 中尚未啟用 Google Sign-in 提供者：\n1. 請至 Firebase Console (https://console.firebase.google.com/)\n2. 點進專案【my-portfolio-dashboard-daniel】\n3. 點選左側【Authentication】->【Sign-in method (登入方式)】\n4. 點擊【Google】-> 勾選開啟【啟用 (Enable)】\n5. 設定「專案支援電子郵件 (Project support email)」為您的信箱 (例如 imsmallnew@gmail.com)\n6. 按下【儲存 (Save)】！\n7. 確認【Settings】->【Authorized domains】包含「imsmallnew.github.io」\n\n💡 若暫時無法操作 Firebase 後台，您也可以在登入視窗下方使用管理員通關碼 (888) 直接進入管理員模式！`);
          return null;
        }

        if (errCode === 'auth/popup-blocked') {
          alert("⚠️ 瀏覽器攔截了 Google 登入彈出視窗，請在網址列允許彈出視窗後重新點擊登入！");
          return null;
        }

        if (errCode === 'auth/popup-closed-by-user' || errCode === 'auth/cancelled-popup-request') {
          console.log("使用者關閉了 Google 登入彈出視窗");
          return null;
        }

        alert("Google 登入失敗：" + (errMsg || errCode || err));
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
    },

    // 訪客提交加入白名單審核申請
    async submitWhitelistRequest(email, name = '', note = '') {
      if (!this.isConfigured || !this.db) {
        throw new Error("雲端資料庫尚未連線，請稍候再試");
      }
      const cleanEmail = (email || '').toLowerCase().trim();
      if (!cleanEmail || !cleanEmail.includes('@')) {
        throw new Error("請輸入有效的 Email 信箱");
      }

      const docId = cleanEmail.replace(/[^a-zA-Z0-9]/g, '_');
      try {
        await this.db.collection('whitelist_requests').doc(docId).set({
          email: cleanEmail,
          name: (name || '').trim(),
          note: (note || '').trim(),
          status: 'pending', // 'pending' | 'approved' | 'rejected'
          requestedAt: firebase.firestore.FieldValue.serverTimestamp(),
          requestedAtStr: new Date().toLocaleString('zh-TW', { hour12: false })
        }, { merge: true });

        return { success: true, email: cleanEmail };
      } catch (err) {
        console.warn("寫入 whitelist_requests 權限注意:", err);
        const errCode = err.code || '';
        const errMsg = err.message || '';
        if (errCode === 'permission-denied' || errMsg.includes('Missing or insufficient permissions')) {
          return {
            success: false,
            permissionDenied: true,
            email: cleanEmail,
            name: (name || '').trim()
          };
        }
        throw err;
      }
    },

    // 管理員載入待審核白名單申請
    async loadWhitelistRequests() {
      if (!this.isConfigured || !this.db) return [];
      try {
        const snap = await this.db.collection('whitelist_requests')
          .where('status', '==', 'pending')
          .get();
        const list = [];
        snap.forEach(doc => {
          list.push({ id: doc.id, ...doc.data() });
        });
        return list;
      } catch (err) {
        console.warn("讀取待審核白名單注意:", err);
        return [];
      }
    },

    // 管理員批准加入白名單
    async approveWhitelistRequest(requestId, email) {
      if (!this.isConfigured || !this.db) throw new Error("Firebase 尚未配置");
      const cleanEmail = (email || '').toLowerCase().trim();
      
      // 1. 取得目前 access/main 的 viewers
      const acl = await this.loadAcl();
      const currentViewers = acl.viewers || [];
      if (!currentViewers.includes(cleanEmail)) {
        currentViewers.push(cleanEmail);
        await this.saveAcl(currentViewers);
      }

      // 2. 更新申請狀態為 approved
      if (requestId) {
        await this.db.collection('whitelist_requests').doc(requestId).update({
          status: 'approved',
          approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
          approvedBy: this.currentUser?.email || 'owner'
        });
      }

      return currentViewers;
    },

    // 管理員忽略/拒絕申請
    async rejectWhitelistRequest(requestId) {
      if (!this.isConfigured || !this.db || !requestId) return;
      await this.db.collection('whitelist_requests').doc(requestId).update({
        status: 'rejected',
        rejectedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
  };

  window.cloudStore = CloudStore;
})();
