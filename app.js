/**
 * Fubon Portfolio Dashboard - Core Application Logic
 * Reactive investment portfolio calculator, real-time & night market price tracker,
 * TradingView integration, drag & drop reordering, realized P/L and dividend ledger,
 * admin authentication, and CSV import/overwrite.
 */

(function () {
  'use strict';

  const IS_FILE_MODE = window.location.protocol === 'file:';

  // Default Admin Password Hash (SHA-256)
  const DEFAULT_ADMIN_HASH = '2bb3ecae7bcfd81b4998db4c5ad96d59404ce322749969eb2a3ebf68e98bc011';

  // State
  const state = {
    dashboardTitle: localStorage.getItem('fubon_dashboard_title') || '投資儀表板 PRO',
    usdRate: 32.51,
    baselineRealizedPl: 0.0,
    baselineDividendIncome: 0.0,
    quotes: {},
    transactions: [],
    realizedRecords: [],
    dividendRecords: [],
    fundReserves: {
      livingReserveTwd: 0,
      investCapitalTwd: 0,
      savingsInsuranceTwd: 0,
      usdInsurance: 0,
      usdSavings: 0,
      monthlyIncomeTwd: 0,
      annualIncomeTwd: 0,
      monthlyExpenseTwd: 0,
      annualExpenseTwd: 0,
      monthlyDcaTwd: 0,
      annualDcaTwd: 0,
      annualSurplusTwd: 0,
      note: ''
    },
    holdings: {},
    lastUpdated: '',

    // Auth Mode: 'view' (Visitor View-Only) or 'admin' (Admin Edit Mode)
    manualAdminUnlocked: sessionStorage.getItem('fubon_manual_admin') === '1',
    authMode: sessionStorage.getItem('fubon_manual_admin') === '1' ? 'admin' : (sessionStorage.getItem('fubon_auth_mode') || 'view'),
    adminPasswordHash: localStorage.getItem('fubon_admin_pw_hash') || DEFAULT_ADMIN_HASH,

    // UI Filters & Sorting
    activeTab: 'tab-holdings',
    holdingFilterCat: 'all',
    holdingSearch: '',
    holdingSort: localStorage.getItem('fubon_holding_sort') || 'custom',
    hideZeroShares: localStorage.getItem('fubon_hide_zero_shares') !== '0', // 釋出全部股數後隱藏
    showHidden: localStorage.getItem('fubon_show_hidden') === '1',

    // Auto Refresh
    autoRefreshSec: parseInt(localStorage.getItem('fubon_auto_refresh') || '0', 10),
    autoTimer: null,
    nextRefreshAt: 0,
    isRefreshing: false,

    // Transactions UI
    txFilterSymbol: 'all',
    txFilterAction: 'all',
    txSearch: '',
    txPage: 1,
    txPerPage: 50,

    editingTxId: null,
    editingDivId: null,
    deleteTarget: null, // { type: 'tx'|'div'|'real', id: ... }

    theme: localStorage.getItem('fubon_theme') || 'dark',
    colorMode: localStorage.getItem('fubon_color_mode') || 'tw', // 'tw': Red=Up, 'us': Green=Up
  };

  const CATEGORY_LABELS = {
    tw_stock: '台股 個股',
    tw_etf: '台股 ETF',
    us: '美股 / ETF',
    fund: '基金',
    other: '其他'
  };

  // Base Quote Metadata with TradingView Tickers (SNDK fixed to NASDAQ:SNDK)
  const DEFAULT_QUOTES = {
    "0050": { price: 108.15, nightPrice: 107.70, prevClose: 109.00, name: "元大台灣50", type: "台股 ETF", category: "tw_etf", currency: "TWD", symbolYahoo: "0050.TW", tvSymbol: "TWSE:0050", order: 0 },
    "2330": { price: 2420.00, nightPrice: 2410.00, prevClose: 2420.00, name: "台積電", type: "台股 個股", category: "tw_stock", currency: "TWD", symbolYahoo: "2330.TW", tvSymbol: "TWSE:2330", order: 1 },
    "VOO": { price: 701.61, nightPrice: 701.61, prevClose: 709.43, name: "Vanguard 標普500 ETF", type: "美股 ETF", category: "us", currency: "USD", symbolYahoo: "VOO", tvSymbol: "AMEX:VOO", order: 2 },
    "00981A": { price: 28.94, nightPrice: 28.82, prevClose: 29.38, name: "統一台灣高息動能/00981A", type: "台股 ETF", category: "tw_etf", currency: "TWD", symbolYahoo: "", tvSymbol: "TWSE:00981A", order: 3 },
    "00403A": { price: 10.24, nightPrice: 10.20, prevClose: 10.38, name: "瀚亞/00403A", type: "台股 基金", category: "fund", currency: "TWD", symbolYahoo: "", tvSymbol: "TWSE:00403A", order: 4 },
    "00406A": { price: 9.18, nightPrice: 9.14, prevClose: 9.30, name: "00406A", type: "台股 基金", category: "fund", currency: "TWD", symbolYahoo: "", tvSymbol: "TWSE:00406A", order: 5 },
    "路博邁": { price: 92.82, nightPrice: 92.82, prevClose: 98.63, name: "路博邁NB 5G股票基金", type: "境外 基金", category: "fund", currency: "TWD", symbolYahoo: "", tvSymbol: "", infoUrl: "https://www.moneydj.com/funddj/ya/yp010000.djhtm?a=ACNB01", order: 6 },
    "瀚亞": { price: 111.452, nightPrice: 111.452, prevClose: 116.905, name: "瀚亞科技基金", type: "境外 基金", category: "fund", currency: "USD", symbolYahoo: "", tvSymbol: "", infoUrl: "https://www.moneydj.com/funddj/ya/yp010001.djhtm?a=IOF02", order: 7 },
    "台達電": { price: 1640.00, nightPrice: 1633.20, prevClose: 1635.00, name: "台達電", type: "台股 個股", category: "tw_stock", currency: "TWD", symbolYahoo: "2308.TW", tvSymbol: "TWSE:2308", order: 8 },
    "聯發科": { price: 4205.00, nightPrice: 4187.60, prevClose: 4250.00, name: "聯發科", type: "台股 個股", category: "tw_stock", currency: "TWD", symbolYahoo: "2454.TW", tvSymbol: "TWSE:2454", order: 9 },
    "領袖": { price: 40.06, nightPrice: 39.89, prevClose: 42.48, name: "國泰台灣領袖50", type: "台股 ETF", category: "tw_etf", currency: "TWD", symbolYahoo: "00922.TW", tvSymbol: "TWSE:00922", order: 10 },
    "南亞科": { price: 436.00, nightPrice: 434.20, prevClose: 447.50, name: "南亞科", type: "台股 個股", category: "tw_stock", currency: "TWD", symbolYahoo: "2408.TW", tvSymbol: "TWSE:2408", order: 11 },
    "MU": { price: 878.84, nightPrice: 878.84, prevClose: 931.24, name: "美光科技 Micron", type: "美股 個股", category: "us", currency: "USD", symbolYahoo: "MU", tvSymbol: "NASDAQ:MU", order: 12 },
    "NVDA": { price: 214.13, nightPrice: 214.13, prevClose: 217.23, name: "輝達 NVIDIA", type: "美股 個股", category: "us", currency: "USD", symbolYahoo: "NVDA", tvSymbol: "NASDAQ:NVDA", order: 13 },
    "MRVL": { price: 227.83, nightPrice: 227.83, prevClose: 241.24, name: "邁威爾 Marvell", type: "美股 個股", category: "us", currency: "USD", symbolYahoo: "MRVL", tvSymbol: "NASDAQ:MRVL", order: 14 },
    "SpaceX": { price: 146.03, nightPrice: 146.03, prevClose: 148.62, name: "SpaceX", type: "美股 私募", category: "us", currency: "USD", symbolYahoo: "", tvSymbol: "", order: 15 },
    "SNDK": { price: 1299.30, nightPrice: 1299.30, prevClose: 1394.83, name: "SNDK", type: "美股 個股", category: "us", currency: "USD", symbolYahoo: "", tvSymbol: "NASDAQ:SNDK", order: 16 }
  };

  // 預設持股交易為空（登入後由 Firestore 雲端同步或由管理員匯入真實資產）
  const DEFAULT_DEMO_TRANSACTIONS = [];

  // Helper formatting functions
  function formatMoney(num, decimals = 0) {
    if (num === undefined || num === null || isNaN(num)) return '--';
    return Number(num).toLocaleString('zh-TW', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  function formatShares(num) {
    if (num === undefined || num === null || isNaN(num)) return '0';
    const n = Number(num);
    if (Number.isInteger(n)) return n.toLocaleString('zh-TW');
    return n.toLocaleString('zh-TW', { minimumFractionDigits: 1, maximumFractionDigits: 4 });
  }

  function formatPercent(num) {
    if (num === undefined || num === null || isNaN(num)) return '0.00%';
    const sign = num > 0 ? '+' : '';
    return `${sign}${Number(num).toFixed(2)}%`;
  }

  function getValClass(num) {
    if (!num || Math.abs(num) < 0.0001) return 'val-zero';
    return num > 0 ? 'val-up' : 'val-down';
  }

  function getBadgeClass(num) {
    if (!num || Math.abs(num) < 0.0001) return 'badge-neutral';
    return num > 0 ? 'badge-up' : 'badge-down';
  }

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function sha256(str) {
    const buf = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // 1. Data Initialization & Remote Cloud Store
  async function initData() {
    // 徹底清除過去版本殘留的展示資料快取，確保訪客模式完全乾淨
    try {
      localStorage.removeItem('fubon_portfolio_data');
    } catch (e) { }

    applyTheme();
    applyColorMode();
    applyDashboardTitle();
    applyAuthMode();
    setupRemoteAuthUI();
    setupEventListeners();

    if (window.cloudStore) {
      const configured = window.cloudStore.init();
      if (configured) {
        window.cloudStore.onAuthChange((user, role) => {
          handleRemoteAuthChange(user, role);
        });
        return;
      }
    }

    // Fallback Preview / Local Demo Mode (when Firebase is not configured yet)
    setupDemoMode();
  }

  function setupRemoteAuthUI() {
    const gateOverlay = document.getElementById('authGateOverlay');

    // Google Sign-In Buttons
    const handleGoogleLogin = async () => {
      try {
        await window.cloudStore?.signInWithGoogle();
      } catch (err) {
        console.error('Google 登入注意:', err);
      }
    };

    document.getElementById('btnGoogleSignIn')?.addEventListener('click', handleGoogleLogin);

    // Header 登入 / 註冊按鈕：開啟門禁卡片
    document.getElementById('btnHeaderSignIn')?.addEventListener('click', () => {
      if (gateOverlay) gateOverlay.style.display = 'flex';
    });

    // 關閉門禁或以訪客模式進入 (確保乾淨清空)
    const closeGate = () => {
      if (gateOverlay) gateOverlay.style.display = 'none';
      if (!window.cloudStore?.currentUser && !state.manualAdminUnlocked) {
        // 未登入訪客模式：清空所有交易與損益
        loadLocalOrEmbedded();
        recalculatePortfolio();
        updateUi();
      }
    };
    document.getElementById('btnGateClose')?.addEventListener('click', closeGate);
    document.getElementById('btnEnterAsGuest')?.addEventListener('click', closeGate);

    // 點擊「註冊（申請白名單）」展開/收合申請表單
    const btnToggleReg = document.getElementById('btnToggleRegisterForm');
    const boxReg = document.getElementById('authRegisterBox');
    const btnCancelReg = document.getElementById('btnCancelRegister');

    btnToggleReg?.addEventListener('click', () => {
      if (boxReg) {
        const isHidden = boxReg.style.display === 'none' || !boxReg.style.display;
        boxReg.style.display = isHidden ? 'block' : 'none';
        if (isHidden) {
          document.getElementById('reqGmailInput')?.focus();
        }
      }
    });

    btnCancelReg?.addEventListener('click', () => {
      if (boxReg) boxReg.style.display = 'none';
    });

    // 訪客提交白名單審核申請 (註冊)
    document.getElementById('formWhitelistRequest')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const emailInput = document.getElementById('reqGmailInput');
      const nameInput = document.getElementById('reqNameInput');
      const submitBtn = document.getElementById('btnSubmitWhitelistReq');
      const successNotice = document.getElementById('reqSuccessNotice');
      const permNotice = document.getElementById('reqPermNotice');
      const btnMailto = document.getElementById('btnMailtoAdmin');

      const email = (emailInput?.value || '').trim();
      const name = (nameInput?.value || '').trim();

      if (!email || !email.includes('@')) {
        alert('請輸入有效的 Gmail 信箱！');
        return;
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>⏳ 提送審核申請中...</span>';
      }

      try {
        const res = await window.cloudStore?.submitWhitelistRequest(email, name);
        if (res && res.permissionDenied) {
          if (successNotice) successNotice.style.display = 'none';
          if (permNotice) permNotice.style.display = 'block';
          if (btnMailto) {
            const subject = encodeURIComponent(`【投資儀表板】親友申請加入白名單 - ${email}`);
            const body = encodeURIComponent(`管理員 Daniel 您好，\n\n我是 ${name || '親友'}，申請將我的 Gmail 信箱【${email}】加入投資儀表板的授權白名單。\n\n感謝！`);
            btnMailto.href = `mailto:imsmallnew@gmail.com?subject=${subject}&body=${body}`;
          }
          alert(`⚠️ 由於 Firebase 雲端資料庫目前防護設定限制，請點擊下方「📧 點此一鍵寄信通知管理員 (Daniel) 審核」直接寄送 Email 申請！`);
          return;
        }

        if (permNotice) permNotice.style.display = 'none';
        if (successNotice) successNotice.style.display = 'block';
        if (emailInput) emailInput.value = '';
        if (nameInput) nameInput.value = '';
        showNotification('🎉 白名單申請已送出！請等候管理員 (Daniel) 驗證加到名單。', 'success');
      } catch (err) {
        alert('送出申請失敗：' + (err.message || err));
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span>🚀 送出審核申請</span>';
        }
      }
    });

    // 登出與帳號切換
    document.getElementById('btnRemoteSignOut')?.addEventListener('click', async () => {
      if (confirm('確定登出 Google 帳號？')) {
        state.manualAdminUnlocked = false;
        sessionStorage.removeItem('fubon_manual_admin');
        await window.cloudStore?.signOut();
      }
    });

    document.getElementById('btnGateSignOut')?.addEventListener('click', async () => {
      state.manualAdminUnlocked = false;
      sessionStorage.removeItem('fubon_manual_admin');
      await window.cloudStore?.signOut();
    });

    document.getElementById('btnSwitchAccount')?.addEventListener('click', async () => {
      state.manualAdminUnlocked = false;
      sessionStorage.removeItem('fubon_manual_admin');
      await window.cloudStore?.signOut();
      await window.cloudStore?.signInWithGoogle();
    });
  }

  function handleRemoteAuthChange(user, role) {
    const gateOverlay = document.getElementById('authGateOverlay');
    const gateError = document.getElementById('authGateError');
    const userMenuWrapper = document.getElementById('userMenuWrapper');
    const headerSignIn = document.getElementById('btnHeaderSignIn');
    const userAvatar = document.getElementById('userAvatarImg');
    const userPlaceholder = document.getElementById('userAvatarPlaceholder');
    const menuEmail = document.getElementById('menuUserEmail');
    const menuPid = document.getElementById('menuPortfolioId');
    const menuBtnAcl = document.getElementById('menuBtnManageAcl');

    if (gateError) gateError.style.display = 'none';

    // 1. 未登入且未手動解鎖管理員
    if (!user && !state.manualAdminUnlocked) {
      state.authMode = 'view';
      if (gateOverlay) gateOverlay.style.display = 'flex'; // 預設顯示登入/註冊畫面
      if (userMenuWrapper) userMenuWrapper.style.display = 'none';
      if (headerSignIn) headerSignIn.style.display = 'inline-flex';

      applyAuthMode();
      loadAndSubscribeCloudData();
      return;
    }

    // 2. 已登入或已解鎖
    if (gateOverlay) gateOverlay.style.display = 'none';
    if (headerSignIn) headerSignIn.style.display = 'none';
    if (userMenuWrapper) userMenuWrapper.style.display = 'inline-flex';

    if (user) {
      if (menuEmail) {
        menuEmail.textContent = user.displayName ? `${user.displayName} (${user.email})` : user.email;
      }
      if (user.photoURL && userAvatar) {
        userAvatar.src = user.photoURL;
        userAvatar.style.display = 'block';
        if (userPlaceholder) userPlaceholder.style.display = 'none';
      } else if (userPlaceholder) {
        const initial = (user.displayName || user.email || 'U').charAt(0).toUpperCase();
        userPlaceholder.textContent = initial;
        userPlaceholder.style.display = 'flex';
        if (userAvatar) userAvatar.style.display = 'none';
      }

      // 只有 Daniel (imsmallnew@gmail.com) 顯示「👥 授權名單」選項
      const isDaniel = (user.email || '').toLowerCase().trim() === 'imsmallnew@gmail.com';
      if (menuBtnAcl) {
        menuBtnAcl.style.display = isDaniel ? 'flex' : 'none';
      }

      // 訪客專屬空間捷徑與 Daniel 儀表板切換按鈕
      const menuBtnMy = document.getElementById('menuBtnMyPortfolio');
      const menuBtnDaniel = document.getElementById('menuBtnDanielPortfolio');
      const currentPid = window.cloudStore?.currentPortfolioId || 'main';
      const mySlug = (user.email || '').split('@')[0].toLowerCase().replace(/[^\w\u4e00-\u9fa5_-]/g, '');

      if (menuBtnMy) {
        if (!isDaniel && mySlug && currentPid !== mySlug) {
          menuBtnMy.style.display = 'flex';
          const textSpan = document.getElementById('menuMyPortfolioText');
          if (textSpan) textSpan.textContent = `🚀 前往我的專屬維護空間 (?id=${mySlug})`;
        } else {
          menuBtnMy.style.display = 'none';
        }
      }

      if (menuBtnDaniel) {
        menuBtnDaniel.style.display = (currentPid !== 'main') ? 'flex' : 'none';
      }
    }

    const pid = window.cloudStore?.currentPortfolioId || 'main';
    if (menuPid) {
      menuPid.textContent = pid;
    }

    if (state.manualAdminUnlocked || role === 'owner') {
      // 擁有者或管理員
      state.authMode = 'admin';
      if (role === 'owner' && user) {
        showNotification(`歡迎回來，管理員 ${user.displayName || user.email}！已啟用完整維護權限`, 'success');
      }
    } else if (role === 'viewer') {
      // 授權親友
      state.authMode = 'viewer';
      showNotification(`您已登入授權親友帳號，已為您解鎖資產配置細項！`, 'info');
    } else {
      // 其他已登入但未在白名單的使用者
      state.authMode = 'view';
      if (gateError) {
        gateError.style.display = 'block';
        if (gateOverlay) gateOverlay.style.display = 'flex';
      }
    }

    applyAuthMode();
    loadAndSubscribeCloudData();
  }

  async function loadAndSubscribeCloudData() {
    try {
      const pid = window.cloudStore?.currentPortfolioId || 'main';
      const pidLabel = document.getElementById('currentPortfolioLabel');
      if (pidLabel) pidLabel.textContent = pid;

      showNotification(`正在連線 Firestore 雲端資料庫 [${pid}]...`, 'info');
      const cloudData = await window.cloudStore.loadPortfolio();

      const banner = document.getElementById('newPortfolioBanner');
      const btnInit = document.getElementById('btnInitNewPortfolio');
      const bannerDesc = document.getElementById('newPortfolioBannerDesc');
      const bannerTitle = document.getElementById('newPortfolioBannerTitle');

      if (cloudData) {
        if (banner) banner.style.display = 'none';
        applyLoadedData(cloudData);
        showNotification(`已成功同步最新雲端資產資料 [${pid}]！`, 'success');
      } else {
        loadLocalOrEmbedded();
        recalculatePortfolio();
        updateUi();

        if (pid !== 'main') {
          // 訪問全新的自訂組合 (例如 ?id=alice)
          if (banner) banner.style.display = 'flex';
          if (bannerTitle) bannerTitle.textContent = '這是全新的專屬投資組合';

          if (window.cloudStore?.currentUser) {
            if (bannerDesc) bannerDesc.textContent = `此組合尚未建立。點擊右側按鈕即可立即建立並成為此組合的唯一擁有者！`;
          } else {
            if (bannerDesc) bannerDesc.textContent = `此組合尚未初始化。登入 Google 帳號後即可建立屬於您的專屬投資儀表板。`;
          }
          if (btnInit) {
            btnInit.style.display = 'inline-flex';
            btnInit.innerHTML = `<span>🚀 建立專屬投資組合</span>`;
          }
        } else {
          if (banner) banner.style.display = 'none';
          if (window.cloudStore.userRole === 'owner') {
            showNotification('雲端資料庫尚未建立，請點擊「☁️ 匯入 data.json」同步您的完整本機資料！', 'info');
          }
        }
      }


      // Realtime listener across all devices
      window.cloudStore.subscribePortfolio((updated) => {
        if (updated && updated.version !== state.version) {
          applyLoadedData(updated);
          showNotification('已自動同步其他裝置的最新修改！', 'info');
        }
      });
    } catch (err) {
      console.error('載入雲端資料失敗:', err);
      showNotification('載入雲端資料失敗，暫時顯示展示資料', 'error');
      loadLocalOrEmbedded();
      recalculatePortfolio();
      updateUi();
    }
  }

  function applyLoadedData(src) {
    state.usdRate = src.usdRate || 32.51;
    state.baselineRealizedPl = src.baselineRealizedPl !== undefined ? src.baselineRealizedPl : 67493.0;
    state.baselineDividendIncome = src.baselineDividendIncome !== undefined ? src.baselineDividendIncome : 10967.0;
    state.dashboardTitle = src.dashboardTitle || state.dashboardTitle;
    state.quotes = src.quotes || DEFAULT_QUOTES;
    state.transactions = src.transactions || [];
    state.realizedRecords = src.realizedRecords || [];
    state.dividendRecords = src.dividendRecords || [];
    state.fundReserves = src.fundReserves || state.fundReserves;
    state.lastUpdated = src.lastUpdated || new Date().toLocaleString('zh-TW');
    state.version = src.version || 1;

    // Merge default quotes for symbols missing metadata
    for (const [sym, q] of Object.entries(DEFAULT_QUOTES)) {
      if (!state.quotes[sym]) {
        state.quotes[sym] = { ...q };
      } else {
        if (!state.quotes[sym].category) state.quotes[sym].category = q.category;
        if (!state.quotes[sym].name) state.quotes[sym].name = q.name;
        if (!state.quotes[sym].tvSymbol && q.tvSymbol) state.quotes[sym].tvSymbol = q.tvSymbol;
        if (typeof state.quotes[sym].order !== 'number') state.quotes[sym].order = q.order;
        if (!state.quotes[sym].nightPrice) state.quotes[sym].nightPrice = state.quotes[sym].price;
      }
    }

    saveStateToLocal();
    applyDashboardTitle();
    normalizeAssetOrder();
    populateSymbolSelects();
    recalculatePortfolio();
    updateUi();
  }

  function setupDemoMode() {
    const authStatusText = document.getElementById('authStatusText');
    const authIcon = document.getElementById('authIcon');
    if (authStatusText) authStatusText.textContent = '展示預覽模式 (填入 firebase-config.js 啟用雲端)';
    if (authIcon) authIcon.textContent = '💡';

    loadLocalOrEmbedded();
    normalizeAssetOrder();
    populateSymbolSelects();
    recalculatePortfolio();
    updateUi();
    startAutoRefresh();
  }

  function loadLocalOrEmbedded() {
    state.quotes = { ...DEFAULT_QUOTES };
    state.usdRate = 32.51;
    state.baselineRealizedPl = 0.0;
    state.baselineDividendIncome = 0.0;
    state.transactions = [];
    state.realizedRecords = [];
    state.dividendRecords = [];
    state.fundReserves = {
      livingReserveTwd: 0,
      investCapitalTwd: 0,
      savingsInsuranceTwd: 0,
      usdInsurance: 0,
      usdSavings: 0,
      monthlyIncomeTwd: 0,
      annualIncomeTwd: 0,
      monthlyExpenseTwd: 0,
      annualExpenseTwd: 0,
      monthlyDcaTwd: 0,
      annualDcaTwd: 0,
      annualSurplusTwd: 0,
      note: ''
    };
    state.holdings = {};
    state.lastUpdated = '';
  }

  function saveStateToLocal() {
    if (!state.savedAt) state.savedAt = Date.now();
    localStorage.setItem('fubon_portfolio_data', JSON.stringify({
      dashboardTitle: state.dashboardTitle,
      usdRate: state.usdRate,
      baselineRealizedPl: state.baselineRealizedPl,
      baselineDividendIncome: state.baselineDividendIncome,
      quotes: state.quotes,
      transactions: state.transactions,
      realizedRecords: state.realizedRecords,
      dividendRecords: state.dividendRecords,
      fundReserves: state.fundReserves,
      lastUpdated: state.lastUpdated,
      savedAt: state.savedAt,
      version: state.version || 1
    }));
  }

  async function persistState(keysToSave = null) {
    state.savedAt = Date.now();
    saveStateToLocal();

    const payload = {};
    const allKeys = [
      "usdRate",
      "dashboardTitle",
      "baselineRealizedPl",
      "baselineDividendIncome",
      "quotes",
      "transactions",
      "realizedRecords",
      "dividendRecords",
      "fundReserves"
    ];
    const targetKeys = keysToSave || allKeys;
    for (const key of targetKeys) {
      if (state[key] !== undefined) {
        payload[key] = state[key];
      }
    }

    if (window.cloudStore && window.cloudStore.isConfigured) {
      if (window.cloudStore.userRole !== 'owner') {
        showNotification('您目前為檢視者身分，無法修改雲端資料庫', 'error');
        return false;
      }
      try {
        const res = await window.cloudStore.savePortfolio(payload);
        if (res && res.success) {
          state.version = res.version;
          return true;
        }
      } catch (err) {
        console.error('雲端儲存失敗:', err);
        showNotification('雲端儲存失敗：' + (err.message || err), 'error');
        return false;
      }
    }

    return true;
  }

  function normalizeAssetOrder() {
    const syms = Object.keys(state.quotes);
    syms.forEach((s, idx) => {
      if (typeof state.quotes[s].order !== 'number') {
        state.quotes[s].order = idx;
      }
    });
  }

  // 2. Auth Mode (View-Only vs Admin Edit Mode)
  function applyAuthMode() {
    document.documentElement.setAttribute('data-auth-mode', state.authMode);
    sessionStorage.setItem('fubon_auth_mode', state.authMode);

    const icon = document.getElementById('authIcon');
    const text = document.getElementById('authStatusText');
    const badge = document.getElementById('authRoleBadge');
    const menuAdminText = document.getElementById('menuAdminBtnText');

    if (badge) {
      badge.style.cursor = 'default';
      badge.removeAttribute('title');
    }

    if (state.authMode === 'admin') {
      if (icon) icon.textContent = '⚡';
      if (text) text.textContent = '管理員模式';
      if (menuAdminText) menuAdminText.textContent = '切換為訪客閱讀模式';
    } else {
      if (icon) icon.textContent = '👁️';
      if (text) text.textContent = '訪客模式';
      if (menuAdminText) menuAdminText.textContent = '輸入密碼解鎖管理員';
    }
  }

  function checkAdminOrPrompt(actionName = '此操作') {
    if (state.authMode === 'admin') return true;
    showNotification(`目前為閱讀模式，請輸入管理員密碼或登入擁有者 Google 帳號以進行${actionName}`, 'warning');
    openAdminModal();
    return false;
  }

  function openAdminModal() {
    const modal = document.getElementById('adminModalBackdrop');
    if (!modal) return;
    document.getElementById('adminPasswordInput').value = '';
    modal.classList.add('show');
  }

  function closeAdminModal() {
    const modal = document.getElementById('adminModalBackdrop');
    if (modal) modal.classList.remove('show');
  }

  async function handleAdminLoginSubmit(e) {
    e.preventDefault();
    const pw = (document.getElementById('adminPasswordInput').value || '').trim();
    const inputHash = await sha256(pw);

    // 支援 888、8888、daniel2026、admin 以及原預設 hash
    const isValid = (
      pw === '888' ||
      pw === '8888' ||
      pw === 'daniel2026' ||
      pw === 'admin' ||
      inputHash === state.adminPasswordHash
    );

    if (isValid) {
      state.authMode = 'admin';
      state.manualAdminUnlocked = true;
      sessionStorage.setItem('fubon_manual_admin', '1');
      applyAuthMode();
      closeAdminModal();
      showNotification('🎉 管理員登入成功！已解鎖所有編輯與新增權限', 'success');
      updateUi();
    } else {
      showNotification('密碼錯誤，請重新輸入（預設密碼：888 或 8888）', 'error');
    }
  }

  // 3. Portfolio Calculation Engine
  function recalculatePortfolio() {
    const holdings = {};
    for (const [sym, q] of Object.entries(state.quotes)) {
      holdings[sym] = {
        symbol: sym,
        name: q.name || sym,
        type: q.type || CATEGORY_LABELS[q.category] || '其他',
        category: q.category || 'tw_stock',
        currency: q.currency || 'TWD',
        currentPrice: q.price || 0,
        nightPrice: q.nightPrice || q.price || 0,
        prevClose: q.prevClose || q.price || 0,
        symbolYahoo: q.symbolYahoo || '',
        tvSymbol: q.tvSymbol || '',
        infoUrl: q.infoUrl || '',
        hidden: !!q.hidden,
        order: typeof q.order === 'number' ? q.order : 999,

        totalBoughtShares: 0,
        totalBoughtCost: 0,
        totalSoldShares: 0,
        totalSoldRevenue: 0,

        currentShares: 0,
        investedCost: 0,
        avgCost: 0,
        marketValueLocal: 0,
        marketValueTwd: 0,
        investedCostTwd: 0,
        unrealizedPlTwd: 0,
        roiPct: 0,
        weightPct: 0,
        txCount: 0
      };
    }

    // Process transactions
    const sortedTx = [...state.transactions].sort((a, b) => new Date(a.date) - new Date(b.date));

    for (const tx of sortedTx) {
      const sym = tx.symbol;
      if (!holdings[sym]) {
        holdings[sym] = {
          symbol: sym,
          name: tx.name || sym,
          type: '自訂標的',
          category: 'other',
          currency: tx.currency || 'TWD',
          currentPrice: tx.price || 0,
          nightPrice: tx.price || 0,
          prevClose: tx.price || 0,
          hidden: false,
          order: 999,
          totalBoughtShares: 0,
          totalBoughtCost: 0,
          totalSoldShares: 0,
          totalSoldRevenue: 0,
          currentShares: 0,
          investedCost: 0,
          avgCost: 0,
          marketValueLocal: 0,
          marketValueTwd: 0,
          investedCostTwd: 0,
          unrealizedPlTwd: 0,
          roiPct: 0,
          weightPct: 0,
          txCount: 0
        };
      }

      const h = holdings[sym];
      h.txCount += 1;
      const isSell = tx.action && tx.action.includes('賣');
      const shares = Math.abs(parseFloat(tx.shares) || 0);
      const amount = Math.abs(parseFloat(tx.total_amount) || 0);

      if (!isSell) {
        h.totalBoughtShares += shares;
        h.totalBoughtCost += amount;
        h.currentShares += shares;
        h.investedCost += amount;
      } else {
        h.totalSoldShares += shares;
        h.totalSoldRevenue += amount;
        const avgCostBefore = h.currentShares > 0 ? (h.investedCost / h.currentShares) : 0;
        const costBasisOfSold = shares * avgCostBefore;
        h.currentShares = Math.max(0, h.currentShares - shares);
        h.investedCost = Math.max(0, h.investedCost - costBasisOfSold);
      }
    }

    // Calculate TWD Market Values & P/L
    let totalMarketValueTwd = 0;
    let totalCostTwd = 0;

    for (const [sym, h] of Object.entries(holdings)) {
      const rate = h.currency === 'USD' ? state.usdRate : 1.0;

      h.avgCost = h.currentShares > 0.0001 ? (h.investedCost / h.currentShares) : 0;
      h.marketValueLocal = h.currentShares * h.currentPrice;
      h.marketValueTwd = h.marketValueLocal * rate;
      h.investedCostTwd = h.investedCost * rate;
      h.unrealizedPlTwd = h.marketValueTwd - h.investedCostTwd;
      h.roiPct = h.investedCostTwd > 0 ? ((h.unrealizedPlTwd / h.investedCostTwd) * 100) : 0;

      h.chgToday = h.currentPrice - h.prevClose;
      h.chgTodayPct = h.prevClose > 0 ? ((h.chgToday / h.prevClose) * 100) : 0;

      // Night Market Spread compared to Regular Market Price
      h.nightSpread = (h.nightPrice || h.currentPrice) - h.currentPrice;
      h.nightSpreadPct = h.currentPrice > 0 ? ((h.nightSpread / h.currentPrice) * 100) : 0;

      totalMarketValueTwd += h.marketValueTwd;
      totalCostTwd += h.investedCostTwd;
    }

    for (const h of Object.values(holdings)) {
      h.weightPct = totalMarketValueTwd > 0 ? ((h.marketValueTwd / totalMarketValueTwd) * 100) : 0;
    }

    // Realized P/L: Sum of realized records (or baseline 67,493)
    let totalRealizedPlTwd = state.baselineRealizedPl;
    if (state.realizedRecords && state.realizedRecords.length > 0) {
      const sumReal = state.realizedRecords.reduce((sum, r) => sum + (r.realizedPlTwd || 0), 0);
      if (sumReal > 0) totalRealizedPlTwd = sumReal;
    }

    // Dividends: Sum of dividend records (or baseline 10,967)
    let totalDividendTwd = state.baselineDividendIncome;
    if (state.dividendRecords && state.dividendRecords.length > 0) {
      const sumDiv = state.dividendRecords.reduce((sum, d) => {
        const amt = d.currency === 'USD' ? (d.amount * state.usdRate) : (d.amount || 0);
        return sum + amt;
      }, 0);
      if (sumDiv > 0) totalDividendTwd = sumDiv;
    }

    const totalUnrealizedPlTwd = totalMarketValueTwd - totalCostTwd;
    const totalCumulativeReturnTwd = totalUnrealizedPlTwd + totalRealizedPlTwd + totalDividendTwd;
    const totalCumulativeReturnPct = totalCostTwd > 0 ? ((totalCumulativeReturnTwd / totalCostTwd) * 100) : 0;

    state.holdings = holdings;
    state.portfolioSummary = {
      totalMarketValueTwd,
      totalCostTwd,
      totalUnrealizedPlTwd,
      totalRoiPct: totalCostTwd > 0 ? ((totalUnrealizedPlTwd / totalCostTwd) * 100) : 0,
      totalRealizedPlTwd,
      totalDividendIncomeTwd: totalDividendTwd,
      totalCumulativeReturnTwd,
      totalCumulativeReturnPct,
      activeHoldingCount: Object.values(holdings).filter(h => h.currentShares > 0.0001).length,
      totalHoldingCount: Object.keys(holdings).length
    };

    saveStateToLocal();
  }

  // 4. UI Update Orchestration
  function updateUi() {
    renderHeaderInfo();
    renderKpiCards();
    renderFundReserves();
    renderHoldingsTable();
    renderTransactionsTable();
    renderRealizedTable();
    renderDividendTable();
    renderAnalyticsCharts();
  }

  function renderHeaderInfo() {
    const titleEl = document.getElementById('dashboardTitle');
    if (titleEl && titleEl.contentEditable !== 'true') {
      titleEl.textContent = state.dashboardTitle;
    }

    const headerRate = document.getElementById('headerUsdRate');
    if (headerRate) headerRate.textContent = state.usdRate.toFixed(2);

    const timeEl = document.getElementById('lastUpdatedTime');
    if (timeEl) {
      if (state.lastUpdated) {
        // Extract time part (e.g. 17:03:25) for compact stable display
        const parts = state.lastUpdated.split(' ');
        const timePart = parts.length > 1 ? parts[1] : parts[0];
        timeEl.textContent = timePart;
        timeEl.title = `最後更新時間：${state.lastUpdated}`;
      } else {
        timeEl.textContent = '即時';
      }
    }

    const tabHoldingCountBadge = document.getElementById('tabHoldingCountBadge');
    if (tabHoldingCountBadge) tabHoldingCountBadge.textContent = state.portfolioSummary?.activeHoldingCount || 0;

    const tabTxCountBadge = document.getElementById('tabTxCountBadge');
    if (tabTxCountBadge) tabTxCountBadge.textContent = state.transactions.length;

    const tabRealCountBadge = document.getElementById('tabRealizedCountBadge');
    if (tabRealCountBadge) tabRealCountBadge.textContent = state.realizedRecords?.length || 0;

    const tabDivCountBadge = document.getElementById('tabDividendCountBadge');
    if (tabDivCountBadge) tabDivCountBadge.textContent = state.dividendRecords?.length || 0;
  }

  function renderKpiCards() {
    const s = state.portfolioSummary;
    if (!s) return;

    // Market Value
    const mvEl = document.getElementById('kpiTotalMarketValue');
    const mvUsdEl = document.getElementById('kpiTotalMarketValueUsd');
    if (mvEl) mvEl.textContent = `NT$ ${formatMoney(s.totalMarketValueTwd)}`;
    if (mvUsdEl) mvUsdEl.textContent = `約 $${formatMoney(s.totalMarketValueTwd / state.usdRate, 1)} USD`;

    const holdingCountEl = document.getElementById('kpiHoldingCount');
    if (holdingCountEl) holdingCountEl.textContent = s.activeHoldingCount;

    // Cost
    const costEl = document.getElementById('kpiTotalCost');
    const costUsdEl = document.getElementById('kpiTotalCostUsd');
    if (costEl) costEl.textContent = `NT$ ${formatMoney(s.totalCostTwd)}`;
    if (costUsdEl) costUsdEl.textContent = `折合 $${formatMoney(s.totalCostTwd / state.usdRate, 1)} USD`;

    const grossBoughtEl = document.getElementById('kpiGrossBought');
    if (grossBoughtEl) {
      const gross = state.transactions
        .filter(t => !t.action.includes('賣'))
        .reduce((sum, t) => sum + (t.currency === 'USD' ? t.total_amount * state.usdRate : t.total_amount), 0);
      grossBoughtEl.textContent = `NT$ ${formatMoney(gross)}`;
    }

    // Unrealized P/L
    const plEl = document.getElementById('kpiUnrealizedPL');
    const plUsdEl = document.getElementById('kpiUnrealizedPLUsd');
    const plBadge = document.getElementById('kpiUnrealizedBadge');
    const roiRate = document.getElementById('kpiRoiRate');

    if (plEl) {
      plEl.textContent = `NT$ ${formatMoney(s.totalUnrealizedPlTwd)}`;
      plEl.className = `kpi-value mono font-semibold ${getValClass(s.totalUnrealizedPlTwd)}`;
    }
    if (plUsdEl) plUsdEl.textContent = `折合 $${formatMoney(s.totalUnrealizedPlTwd / state.usdRate, 1)} USD`;
    if (plBadge) {
      plBadge.textContent = formatPercent(s.totalRoiPct);
      plBadge.className = `kpi-badge ${getBadgeClass(s.totalUnrealizedPlTwd)}`;
    }
    if (roiRate) {
      roiRate.textContent = formatPercent(s.totalRoiPct);
      roiRate.className = getValClass(s.totalRoiPct);
    }

    // Realized P/L (Aligned with CSV 67,493)
    const realEl = document.getElementById('kpiRealizedPL');
    if (realEl) {
      realEl.textContent = `NT$ ${formatMoney(s.totalRealizedPlTwd)}`;
      realEl.className = `kpi-value mono font-semibold ${getValClass(s.totalRealizedPlTwd)}`;
    }
    const realCountEl = document.getElementById('kpiRealizedCount');
    if (realCountEl) realCountEl.textContent = state.realizedRecords?.length || 0;

    // Dividend
    const divEl = document.getElementById('kpiDividendIncome');
    if (divEl) divEl.textContent = `NT$ ${formatMoney(s.totalDividendIncomeTwd)}`;

    // Total Return
    const crEl = document.getElementById('kpiTotalReturn');
    const crBadge = document.getElementById('kpiTotalReturnBadge');
    const crRate = document.getElementById('kpiTotalReturnRate');
    if (crEl) {
      crEl.textContent = `NT$ ${formatMoney(s.totalCumulativeReturnTwd)}`;
      crEl.className = `kpi-value mono ${getValClass(s.totalCumulativeReturnTwd)}`;
    }
    if (crBadge) {
      crBadge.textContent = formatPercent(s.totalCumulativeReturnPct);
      crBadge.className = `kpi-badge ${getBadgeClass(s.totalCumulativeReturnTwd)}`;
    }
    if (crRate) {
      crRate.textContent = formatPercent(s.totalCumulativeReturnPct);
      crRate.className = getValClass(s.totalCumulativeReturnPct);
    }
  }

  // -------------------------------------------------------------
  // -------------------------------------------------------------
  // Fund Reserves Handlers & Render
  // -------------------------------------------------------------
  function renderFundReserves() {
    const reserves = state.fundReserves || {
      livingReserveTwd: 117189,
      investCapitalTwd: 190000,
      savingsInsuranceTwd: 2930000,
      usdInsurance: 8458,
      monthlyDepositPrincipal: 1108932,
      usdSavings: 2848,
      monthlyIncomeTwd: 82255,
      annualIncomeTwd: 1229785,
      monthlyExpenseTwd: 43218,
      annualExpenseTwd: 518620,
      monthlyDcaTwd: 42757,
      annualDcaTwd: 513084,
      annualSurplusTwd: 198081,
      note: '對齊富邦試算資產配置規劃'
    };

    const living = Number(reserves.livingReserveTwd) || 0;
    const invest = Number(reserves.investCapitalTwd) || 0;
    const savingsInsTwd = Number(reserves.savingsInsuranceTwd) || 0;
    const usdIns = Number(reserves.usdInsurance) || 0;
    const monthlyDepositPrincipal = Number(reserves.monthlyDepositPrincipal ?? 1108932) || 0;
    const usdSav = Number(reserves.usdSavings) || 0;
    const rate = Number(state.usdRate) || 32.45;

    const usdSavInTwd = Math.round(usdSav * rate);
    const usdInsInTwd = Math.round(usdIns * rate);

    // 1. Cash Reserves Pool (現金水位儲備池)
    const totalCashReserves = living + invest + usdSavInTwd;

    // 2. Savings Insurance Assets (儲蓄保單與本金資產: 台幣保單 + 美元保單 + 月配本金)
    const totalInsuranceAssets = savingsInsTwd + usdInsInTwd + monthlyDepositPrincipal;

    // 3. Securities Investment Market Value (證券投資總市值: 即時)
    const s = state.portfolioSummary;
    const investMarketVal = s ? s.totalMarketValueTwd : 0;

    // 4. Total Net Worth (個人總淨資產: 現金池 + 儲蓄保單與本金 + 投資市值)
    const totalNetWorth = totalCashReserves + totalInsuranceAssets + investMarketVal;

    // Update DOM items
    const livingEl = document.getElementById('fundValLiving');
    if (livingEl) livingEl.textContent = `NT$ ${formatMoney(living)}`;

    const investEl = document.getElementById('fundValInvest');
    if (investEl) investEl.textContent = `NT$ ${formatMoney(invest)}`;

    const usdEl = document.getElementById('fundValUsd');
    if (usdEl) usdEl.textContent = `$${formatMoney(usdSav, 2)} USD`;

    const usdConvEl = document.getElementById('fundValUsdConverted');
    if (usdConvEl) usdConvEl.textContent = `折合約 NT$ ${formatMoney(usdSavInTwd)} (@ ${rate.toFixed(2)})`;

    const insuranceEl = document.getElementById('fundValSavingsInsurance');
    if (insuranceEl) insuranceEl.textContent = `NT$ ${formatMoney(totalInsuranceAssets)}`;

    const insDetailEl = document.getElementById('fundValInsuranceDetail');
    if (insDetailEl) insDetailEl.textContent = `含台幣保單 NT$ ${formatMoney(savingsInsTwd)} + 美元保單 $${formatMoney(usdIns)} + 月配本金 NT$ ${formatMoney(monthlyDepositPrincipal)}`;

    const mIncomeEl = document.getElementById('fundValMonthlyIncome');
    if (mIncomeEl) mIncomeEl.textContent = `月 NT$ ${formatMoney(reserves.monthlyIncomeTwd || 82255)}`;

    const mExpenseEl = document.getElementById('fundValMonthlyExpense');
    if (mExpenseEl) mExpenseEl.textContent = `支出 NT$ ${formatMoney(reserves.monthlyExpenseTwd || 43218)}`;

    const expDescEl = document.getElementById('fundValExpenseDesc');
    if (expDescEl) {
      const dca = reserves.monthlyDcaTwd || 42757;
      const surplus = reserves.annualSurplusTwd || 198081;
      expDescEl.textContent = `定期定額月扣 NT$ ${formatMoney(dca)} ｜ 年度淨結餘 NT$ ${formatMoney(surplus)}`;
    }

    // Top Summary Bar
    const totalReservesEl = document.getElementById('fundTotalReserves');
    if (totalReservesEl) totalReservesEl.textContent = `NT$ ${formatMoney(totalCashReserves)}`;

    const totalInsEl = document.getElementById('fundTotalInsurance');
    if (totalInsEl) totalInsEl.textContent = `NT$ ${formatMoney(totalInsuranceAssets)}`;

    const invMvEl = document.getElementById('fundInvestmentMarketValue');
    if (invMvEl) invMvEl.textContent = `NT$ ${formatMoney(investMarketVal)}`;

    const netWorthEl = document.getElementById('fundTotalNetWorth');
    if (netWorthEl) netWorthEl.textContent = `NT$ ${formatMoney(totalNetWorth)}`;

    // Analytics Tab Asset Overview Banner
    const analyticsNwEl = document.getElementById('analyticsNetWorthVal');
    if (analyticsNwEl) analyticsNwEl.textContent = `NT$ ${formatMoney(totalNetWorth)}`;

    const pillarSavingsVal = document.getElementById('pillarSavingsVal');
    const pillarSavingsPct = document.getElementById('pillarSavingsPct');
    const pillarSavingsBar = document.getElementById('pillarSavingsBar');
    if (pillarSavingsVal) pillarSavingsVal.textContent = `NT$ ${formatMoney(totalInsuranceAssets)}`;

    const pillarInvestVal = document.getElementById('pillarInvestVal');
    const pillarInvestPct = document.getElementById('pillarInvestPct');
    const pillarInvestBar = document.getElementById('pillarInvestBar');
    if (pillarInvestVal) pillarInvestVal.textContent = `NT$ ${formatMoney(investMarketVal)}`;

    const pillarCashVal = document.getElementById('pillarCashVal');
    const pillarCashPct = document.getElementById('pillarCashPct');
    const pillarCashBar = document.getElementById('pillarCashBar');
    if (pillarCashVal) pillarCashVal.textContent = `NT$ ${formatMoney(totalCashReserves)}`;

    if (totalNetWorth > 0) {
      const savPct = ((totalInsuranceAssets / totalNetWorth) * 100).toFixed(1);
      const invPct = ((investMarketVal / totalNetWorth) * 100).toFixed(1);
      const cshPct = ((totalCashReserves / totalNetWorth) * 100).toFixed(1);

      if (pillarSavingsPct) pillarSavingsPct.textContent = `${savPct}%`;
      if (pillarSavingsBar) pillarSavingsBar.style.width = `${savPct}%`;

      if (pillarInvestPct) pillarInvestPct.textContent = `${invPct}%`;
      if (pillarInvestBar) pillarInvestBar.style.width = `${invPct}%`;

      if (pillarCashPct) pillarCashPct.textContent = `${cshPct}%`;
      if (pillarCashBar) pillarCashBar.style.width = `${cshPct}%`;
    }
  }

  function openFundModal() {
    if (!checkAdminOrPrompt('編輯資金水位與資產儲備')) return;
    const modal = document.getElementById('fundModalBackdrop');
    if (!modal) return;

    const reserves = state.fundReserves || {
      livingReserveTwd: 117189,
      investCapitalTwd: 190000,
      savingsInsuranceTwd: 2930000,
      usdInsurance: 8458,
      monthlyDepositPrincipal: 1108932,
      usdSavings: 2848,
      monthlyIncomeTwd: 82255,
      annualIncomeTwd: 1229785,
      monthlyExpenseTwd: 43218,
      annualExpenseTwd: 518620,
      monthlyDcaTwd: 42757,
      annualDcaTwd: 513084,
      annualSurplusTwd: 198081,
      note: ''
    };

    const livingIn = document.getElementById('fundFormLiving');
    const investIn = document.getElementById('fundFormInvest');
    const savingsInsIn = document.getElementById('fundFormSavingsInsurance');
    const usdInsIn = document.getElementById('fundFormUsdInsurance');
    const mDepositIn = document.getElementById('fundFormMonthlyDeposit');
    const usdIn = document.getElementById('fundFormUsd');
    const mIncomeIn = document.getElementById('fundFormMonthlyIncome');
    const mExpenseIn = document.getElementById('fundFormMonthlyExpense');
    const mDcaIn = document.getElementById('fundFormMonthlyDca');
    const noteIn = document.getElementById('fundFormNote');

    if (livingIn) livingIn.value = reserves.livingReserveTwd ?? 117189;
    if (investIn) investIn.value = reserves.investCapitalTwd ?? 190000;
    if (savingsInsIn) savingsInsIn.value = reserves.savingsInsuranceTwd ?? 2930000;
    if (usdInsIn) usdInsIn.value = reserves.usdInsurance ?? 8458;
    if (mDepositIn) mDepositIn.value = reserves.monthlyDepositPrincipal ?? 1108932;
    if (usdIn) usdIn.value = reserves.usdSavings ?? 2848;
    if (mIncomeIn) mIncomeIn.value = reserves.monthlyIncomeTwd ?? 82255;
    if (mExpenseIn) mExpenseIn.value = reserves.monthlyExpenseTwd ?? 43218;
    if (mDcaIn) mDcaIn.value = reserves.monthlyDcaTwd ?? 42757;
    if (noteIn) noteIn.value = reserves.note || '';

    modal.classList.add('show');
  }

  function closeFundModal() {
    const modal = document.getElementById('fundModalBackdrop');
    if (modal) modal.classList.remove('show');
  }

  async function handleFundFormSubmit(e) {
    e.preventDefault();
    if (!checkAdminOrPrompt('儲存資產儲備與收支規劃')) return;

    const living = parseFloat(document.getElementById('fundFormLiving')?.value) || 0;
    const invest = parseFloat(document.getElementById('fundFormInvest')?.value) || 0;
    const savingsIns = parseFloat(document.getElementById('fundFormSavingsInsurance')?.value) || 0;
    const usdIns = parseFloat(document.getElementById('fundFormUsdInsurance')?.value) || 0;
    const mDeposit = parseFloat(document.getElementById('fundFormMonthlyDeposit')?.value) || 0;
    const usd = parseFloat(document.getElementById('fundFormUsd')?.value) || 0;
    const mIncome = parseFloat(document.getElementById('fundFormMonthlyIncome')?.value) || 0;
    const mExpense = parseFloat(document.getElementById('fundFormMonthlyExpense')?.value) || 0;
    const mDca = parseFloat(document.getElementById('fundFormMonthlyDca')?.value) || 0;
    const note = document.getElementById('fundFormNote')?.value.trim() || '';

    const aIncome = mIncome * 12 + 100000 + 13725; // 加上保單給付約11.3萬
    const aExpense = mExpense * 12;
    const aDca = mDca * 12;
    const aSurplus = aIncome - aExpense - aDca;

    state.fundReserves = {
      livingReserveTwd: living,
      investCapitalTwd: invest,
      savingsInsuranceTwd: savingsIns,
      usdInsurance: usdIns,
      monthlyDepositPrincipal: mDeposit,
      usdSavings: usd,
      monthlyIncomeTwd: mIncome,
      annualIncomeTwd: aIncome,
      monthlyExpenseTwd: mExpense,
      annualExpenseTwd: aExpense,
      monthlyDcaTwd: mDca,
      annualDcaTwd: aDca,
      annualSurplusTwd: aSurplus,
      note: note,
      updatedAt: new Date().toISOString().split('T')[0]
    };

    await persistState(['fundReserves']);
    renderFundReserves();
    closeFundModal();
    showNotification('資產儲備與收支規劃已成功儲存！', 'success');
  }

  // 5. Render Holdings Table (含夜盤現價、差額、TradingView、出清隱藏、拖動排序)
  function getVisibleHoldings() {
    let list = Object.values(state.holdings);

    if (state.hideZeroShares && !state.showHidden) {
      list = list.filter(h => h.currentShares > 0.0001);
    }

    if (!state.showHidden) {
      list = list.filter(h => !h.hidden);
    }

    if (state.holdingFilterCat !== 'all') {
      list = list.filter(h => h.category === state.holdingFilterCat);
    }

    if (state.holdingSearch) {
      const q = state.holdingSearch.toLowerCase().trim();
      list = list.filter(h =>
        h.symbol.toLowerCase().includes(q) ||
        (h.name && h.name.toLowerCase().includes(q)) ||
        (h.tvSymbol && h.tvSymbol.toLowerCase().includes(q))
      );
    }

    if (state.holdingSort === 'marketValue') {
      list.sort((a, b) => b.marketValueTwd - a.marketValueTwd);
    } else if (state.holdingSort === 'pl') {
      list.sort((a, b) => b.unrealizedPlTwd - a.unrealizedPlTwd);
    } else if (state.holdingSort === 'roi') {
      list.sort((a, b) => b.roiPct - a.roiPct);
    } else {
      list.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
    }

    return list;
  }

  function renderHoldingsTable() {
    const tbody = document.getElementById('holdingsTableBody');
    const tfoot = document.getElementById('holdingsTableFoot');
    if (!tbody) return;

    const list = getVisibleHoldings();
    const canDrag = state.holdingSort === 'custom';

    const hiddenInfo = document.getElementById('hiddenAssetsInfo');
    if (hiddenInfo) {
      const all = Object.values(state.holdings);
      const zeroCount = all.filter(h => h.currentShares <= 0.0001).length;
      const manualHiddenCount = all.filter(h => h.hidden).length;
      if (!state.showHidden && (zeroCount > 0 || manualHiddenCount > 0)) {
        hiddenInfo.textContent = `(已隱藏出清/隱藏標的 ${zeroCount + manualHiddenCount} 檔)`;
      } else {
        hiddenInfo.textContent = '';
      }
    }

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="14" class="text-center" style="padding: 36px; color: var(--text-tertiary);">無符合條件之持有標的</td></tr>`;
      if (tfoot) tfoot.innerHTML = '';
      return;
    }

    let rowsHtml = '';
    for (const h of list) {
      const sym = escapeHtml(h.symbol);
      const chgClass = getValClass(h.chgToday);
      const chgSign = h.chgToday > 0 ? '+' : '';
      const chgText = `${chgSign}${h.chgToday.toFixed(2)} (${chgSign}${h.chgTodayPct.toFixed(2)}%)`;
      const plClass = getValClass(h.unrealizedPlTwd);
      const isZeroShares = h.currentShares <= 0.0001;

      // Night price spread display (現價下方灰色顯示差額)
      const spread = h.nightSpread || 0;
      const spreadSign = spread > 0 ? '+' : '';
      const spreadText = `差額 ${spreadSign}${spread.toFixed(2)} (${spreadSign}${h.nightSpreadPct.toFixed(2)}%)`;

      rowsHtml += `
        <tr class="${isZeroShares ? 'row-zero-shares' : ''} ${h.hidden ? 'row-hidden' : ''}" data-symbol="${sym}" draggable="${canDrag}">
          <td class="col-drag" title="${canDrag ? '按住拖動上下調整排序' : '切換為「自訂拖動排序」後即可拖動'}">
            <span class="drag-handle">⋮⋮</span>
          </td>
          <td class="col-symbol">
            <div class="symbol-cell is-clickable" onclick="window.fubonApp.openTvModal('${sym}')" title="點擊查看 TradingView 即時走勢與指標">
              <span class="symbol-badge">${sym}</span>
              <div>
                <span class="symbol-name">${escapeHtml(h.name)}</span>
                ${h.tvSymbol ? `<span class="tv-mini-tag">📈 ${escapeHtml(h.tvSymbol)}</span>` : ''}
              </div>
            </div>
          </td>
          <td class="col-type">
            <span class="tag-badge tag-${h.category}">${escapeHtml(h.type)}</span>
          </td>
          <td class="col-shares text-right mono font-semibold">
            ${formatShares(h.currentShares)}
          </td>
          <td class="col-cost text-right mono">
            ${formatMoney(h.avgCost, 2)}
            <span class="price-sub">${h.currency}</span>
          </td>
          <td class="col-price text-right mono">
            <strong class="price-display" id="priceDisplay_${sym}">${formatMoney(h.currentPrice, 2)}</strong>
            <span class="price-sub">昨收 ${formatMoney(h.prevClose, 2)} ${h.currency}</span>
          </td>
          <td class="col-night-price text-right mono">
            <span class="night-price-val">${formatMoney(h.nightPrice || h.currentPrice, 2)}</span>
            <span class="night-spread-sub">${spreadText}</span>
          </td>
          <td class="col-chg text-right mono ${chgClass}">
            ${chgText}
          </td>
          <td class="col-invested text-right mono">
            ${formatMoney(h.investedCostTwd)}
            ${h.currency === 'USD' ? `<span class="price-sub">$${formatMoney(h.investedCost, 1)} USD</span>` : ''}
          </td>
          <td class="col-marketval text-right mono font-semibold">
            ${formatMoney(h.marketValueTwd)}
            ${h.currency === 'USD' ? `<span class="price-sub">$${formatMoney(h.marketValueLocal, 1)} USD</span>` : ''}
          </td>
          <td class="col-pl text-right mono ${plClass}">
            ${formatMoney(h.unrealizedPlTwd)}
          </td>
          <td class="col-roi text-right">
            <span class="kpi-badge ${getBadgeClass(h.unrealizedPlTwd)}">
              ${formatPercent(h.roiPct)}
            </span>
          </td>
          <td class="col-weight text-center">
            <div class="weight-bar-wrapper">
              <div class="weight-bar">
                <div class="weight-fill" style="width: ${Math.min(100, h.weightPct)}%"></div>
              </div>
              <span class="weight-text">${h.weightPct.toFixed(1)}%</span>
            </div>
          </td>
          <td class="col-actions text-center admin-only">
            <div class="row-actions">
              <button class="btn-table-action btn-buy-mini admin-only" onclick="window.fubonApp.openAddTxModalFor('${sym}', '單筆買進')" title="買進加碼">+買</button>
              <button class="btn-table-action btn-sell-mini admin-only" onclick="window.fubonApp.openAddTxModalFor('${sym}', '賣出')" title="減持賣出" ${isZeroShares ? 'disabled style="opacity:0.3;cursor:not-allowed;"' : ''}>-賣</button>
              <button class="btn-table-action" onclick="window.fubonApp.openTvModal('${sym}')" title="查看 TradingView 即時圖表">📈</button>
              <button class="btn-table-action admin-only" onclick="window.fubonApp.openEditQuoteModal('${sym}')" title="修改白盤/夜盤價格">✏️</button>
              <button class="btn-table-action admin-only" onclick="window.fubonApp.openAssetModal('${sym}')" title="編輯標的設定與名稱">⚙️</button>
            </div>
          </td>
        </tr>
      `;
    }
    tbody.innerHTML = rowsHtml;

    // Summary Foot Row (依據當前頁籤與過濾條件顯示之標的 list 動態加總)
    if (tfoot) {
      let filteredCostTwd = 0;
      let filteredMarketValueTwd = 0;
      let filteredUnrealizedPlTwd = 0;

      for (const h of list) {
        filteredCostTwd += (h.investedCostTwd || 0);
        filteredMarketValueTwd += (h.marketValueTwd || 0);
        filteredUnrealizedPlTwd += (h.unrealizedPlTwd || 0);
      }

      const filteredRoiPct = filteredCostTwd > 0 ? (filteredUnrealizedPlTwd / filteredCostTwd) * 100 : 0;
      const totalAllMv = state.portfolioSummary?.totalMarketValueTwd || 0;
      const filteredWeightPct = totalAllMv > 0 ? (filteredMarketValueTwd / totalAllMv) * 100 : 0;

      const catLabelMap = {
        all: '全部目前持有',
        tw_stock: '台股個股',
        tw_etf: '台股 ETF',
        us: '美股/ETF',
        fund: '基金/其他'
      };
      const catLabel = catLabelMap[state.holdingFilterCat] || '目前持有';

      tfoot.innerHTML = `
        <tr>
          <td></td>
          <td colspan="7" class="text-left"><strong>${catLabel}合計 (顯示 ${list.length} 檔)</strong></td>
          <td class="text-right mono">NT$ ${formatMoney(filteredCostTwd)}</td>
          <td class="text-right mono text-gradient-cyan">NT$ ${formatMoney(filteredMarketValueTwd)}</td>
          <td class="text-right mono ${getValClass(filteredUnrealizedPlTwd)}">NT$ ${formatMoney(filteredUnrealizedPlTwd)}</td>
          <td class="text-right">
            <span class="kpi-badge ${getBadgeClass(filteredUnrealizedPlTwd)}">${formatPercent(filteredRoiPct)}</span>
          </td>
          <td class="text-center mono">${filteredWeightPct.toFixed(1)}%</td>
          <td></td>
        </tr>
      `;
    }

    setupDragSort();
  }

  // Drag and Drop Table Rows Sorting
  function setupDragSort() {
    const tbody = document.getElementById('holdingsTableBody');
    if (!tbody || state.holdingSort !== 'custom') return;

    let draggedRow = null;

    tbody.querySelectorAll('tr[draggable="true"]').forEach(row => {
      row.addEventListener('dragstart', (e) => {
        if (!checkAdminOrPrompt('拖曳排序')) {
          e.preventDefault();
          return;
        }
        draggedRow = row;
        row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', row.dataset.symbol);
      });

      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (!draggedRow || draggedRow === row) return;

        const rect = row.getBoundingClientRect();
        const next = (e.clientY - rect.top) / (rect.bottom - rect.top) > 0.5;
        row.classList.remove('drag-over-top', 'drag-over-bottom');
        row.classList.add(next ? 'drag-over-bottom' : 'drag-over-top');
      });

      row.addEventListener('dragleave', () => {
        row.classList.remove('drag-over-top', 'drag-over-bottom');
      });

      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('drag-over-top', 'drag-over-bottom');
        if (!draggedRow || draggedRow === row) return;

        const sourceSym = draggedRow.dataset.symbol;
        const targetSym = row.dataset.symbol;
        const rect = row.getBoundingClientRect();
        const placeAfter = (e.clientY - rect.top) / (rect.bottom - rect.top) > 0.5;

        reorderAssets(sourceSym, targetSym, placeAfter);
      });

      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        tbody.querySelectorAll('tr').forEach(r => r.classList.remove('drag-over-top', 'drag-over-bottom'));
        draggedRow = null;
      });
    });
  }

  function reorderAssets(sourceSym, targetSym, placeAfter) {
    const ordered = Object.keys(state.quotes).sort((a, b) => (state.quotes[a].order ?? 999) - (state.quotes[b].order ?? 999));
    const srcIdx = ordered.indexOf(sourceSym);
    if (srcIdx === -1) return;
    ordered.splice(srcIdx, 1);

    let tgtIdx = ordered.indexOf(targetSym);
    if (tgtIdx === -1) return;
    if (placeAfter) tgtIdx++;
    ordered.splice(tgtIdx, 0, sourceSym);

    ordered.forEach((sym, idx) => {
      if (state.quotes[sym]) {
        state.quotes[sym].order = idx;
      }
    });

    saveStateToLocal();

    const localApiUrl = IS_FILE_MODE ? 'http://localhost:8088/api/save-all' : '/api/save-all';
    try {
      fetch(localApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quotes: state.quotes })
      }).catch(() => { });
    } catch (e) { }

    recalculatePortfolio();
    renderHoldingsTable();
    showNotification(`已儲存新標的排序！重新整理亦保持最新順序`, 'success');
  }

  // 6. Render Transactions Table (買賣交易清單)
  function renderTransactionsTable() {
    const tbody = document.getElementById('transactionsTableBody');
    const countEl = document.getElementById('txStatsCount');
    const paginationInfo = document.getElementById('paginationInfo');
    const pageCurrent = document.getElementById('pageCurrent');
    const btnPrev = document.getElementById('btnPagePrev');
    const btnNext = document.getElementById('btnPageNext');
    if (!tbody) return;

    let list = [...state.transactions];

    if (state.txFilterSymbol !== 'all') {
      list = list.filter(t => t.symbol === state.txFilterSymbol);
    }
    if (state.txFilterAction !== 'all') {
      list = list.filter(t => t.action === state.txFilterAction);
    }
    if (state.txSearch) {
      const q = state.txSearch.toLowerCase().trim();
      list = list.filter(t =>
        (t.date && t.date.includes(q)) ||
        (t.symbol && t.symbol.toLowerCase().includes(q)) ||
        (t.name && t.name.toLowerCase().includes(q)) ||
        (t.action && t.action.toLowerCase().includes(q)) ||
        (t.total_amount && String(t.total_amount).includes(q))
      );
    }

    const totalFiltered = list.length;
    if (countEl) countEl.textContent = `顯示 ${totalFiltered} / ${state.transactions.length} 筆交易`;

    list.sort((a, b) => new Date(b.date) - new Date(a.date));

    const totalPages = Math.max(1, Math.ceil(totalFiltered / state.txPerPage));
    if (state.txPage > totalPages) state.txPage = totalPages;
    const startIdx = (state.txPage - 1) * state.txPerPage;
    const endIdx = Math.min(startIdx + state.txPerPage, totalFiltered);
    const pagedList = list.slice(startIdx, endIdx);

    if (paginationInfo) {
      paginationInfo.textContent = totalFiltered > 0
        ? `顯示第 ${startIdx + 1} 到 ${endIdx} 筆，共 ${totalFiltered} 筆`
        : `共 0 筆`;
    }
    if (pageCurrent) pageCurrent.textContent = `${state.txPage} / ${totalPages}`;
    if (btnPrev) btnPrev.disabled = state.txPage <= 1;
    if (btnNext) btnNext.disabled = state.txPage >= totalPages;

    if (pagedList.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="text-center" style="padding: 36px; color: var(--text-tertiary);">無符合條件之買賣交易紀錄</td></tr>`;
      return;
    }

    let rowsHtml = '';
    for (const tx of pagedList) {
      let badgeClass = 'tx-buy';
      if (tx.action.includes('定期')) badgeClass = 'tx-regular';
      else if (tx.action.includes('賣')) badgeClass = 'tx-sell';

      const isSell = tx.action.includes('賣');

      rowsHtml += `
        <tr data-txid="${tx.id}">
          <td class="col-tx-date mono">${tx.date}</td>
          <td class="col-tx-symbol">
            <span class="symbol-badge">${escapeHtml(tx.symbol)}</span>
            <span class="symbol-name">${escapeHtml(tx.name || '')}</span>
          </td>
          <td class="col-tx-action">
            <span class="tx-badge ${badgeClass}">${escapeHtml(tx.action)}</span>
          </td>
          <td class="col-tx-shares text-right mono font-semibold">
            ${isSell ? '-' : '+'}${formatShares(tx.shares)}
          </td>
          <td class="col-tx-price text-right mono">
            ${formatMoney(tx.price, 2)}
          </td>
          <td class="col-tx-amount text-right mono ${isSell ? 'val-up' : ''}">
            ${isSell ? '+' : '-'}${formatMoney(tx.total_amount, 2)}
          </td>
          <td class="col-tx-curr text-center">
            <span class="tag-badge">${tx.currency || 'TWD'}</span>
          </td>
          <td class="col-tx-linkage">
            <span class="tx-linkage-tag">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
              已連動持股
            </span>
          </td>
          <td class="col-tx-actions text-center admin-only">
            <div class="row-actions admin-only">
              <button class="btn-table-action" onclick="window.fubonApp.openEditTxModal('${tx.id}')" title="編輯此筆交易">編輯</button>
              <button class="btn-table-action text-danger" onclick="window.fubonApp.openDeleteTxModal('${tx.id}')" title="刪除此筆交易">刪除</button>
            </div>
          </td>
        </tr>
      `;
    }
    tbody.innerHTML = rowsHtml;
  }

  // 7. Render Realized P/L Table (已實現損益紀錄 - 對齊富邦試算頁籤)
  function renderRealizedTable() {
    const tbody = document.getElementById('realizedTableBody');
    const tfoot = document.getElementById('realizedTableFoot');
    const sumEl = document.getElementById('realizedSummaryText');
    if (!tbody) return;

    const records = state.realizedRecords || [];
    let totalRealized = 0;

    if (records.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" class="text-center" style="padding: 36px; color: var(--text-tertiary);">目前尚無已實現結算紀錄</td></tr>`;
      if (tfoot) tfoot.innerHTML = '';
      return;
    }

    let rowsHtml = '';
    for (const r of records) {
      totalRealized += (r.realizedPlTwd || 0);
      const plClass = getValClass(r.realizedPlTwd);
      const sign = (r.realizedPlTwd || 0) > 0 ? '+' : '';

      rowsHtml += `
        <tr>
          <td class="mono">${r.date || '--'}</td>
          <td>
            <span class="symbol-badge">${escapeHtml(r.symbol)}</span>
            <span class="symbol-name">${escapeHtml(r.name || '')}</span>
          </td>
          <td class="text-right mono">${formatShares(r.shares)}</td>
          <td class="text-right mono">${formatMoney(r.sellPrice, 2)}</td>
          <td class="text-right mono">${formatMoney(r.buyPrice, 2)}</td>
          <td class="text-center"><span class="tag-badge">${r.currency || 'TWD'}</span></td>
          <td class="text-right mono font-semibold ${plClass}">${sign}NT$ ${formatMoney(r.realizedPlTwd)}</td>
          <td class="text-right"><span class="kpi-badge ${getBadgeClass(r.realizedPlTwd)}">${formatPercent(r.roiPct)}</span></td>
          <td style="font-size:0.8rem;color:var(--text-secondary);">${escapeHtml(r.note || '--')}</td>
          <td class="text-center admin-only">
            <button class="btn-table-action" onclick="window.fubonApp.editRealizedRecord('${r.id}')" title="編輯此筆結算紀錄">編輯</button>
            <button class="btn-table-action text-danger" onclick="window.fubonApp.deleteRealizedRecord('${r.id}')" title="刪除此筆結算紀錄">刪除</button>
          </td>
        </tr>
      `;
    }

    tbody.innerHTML = rowsHtml;
    if (sumEl) sumEl.textContent = `NT$ ${formatMoney(totalRealized)}`;

    if (tfoot) {
      tfoot.innerHTML = `
        <tr>
          <td colspan="6" class="text-left"><strong>已實現損益累計合計 (${records.length} 筆結算)</strong></td>
          <td class="text-right mono font-semibold val-up">NT$ ${formatMoney(totalRealized)}</td>
          <td colspan="3"></td>
        </tr>
      `;
    }
  }

  // 8. Render Dividend Table (配息收入表 - 對齊富邦試算頁籤)
  function renderDividendTable() {
    const tbody = document.getElementById('dividendTableBody');
    const tfoot = document.getElementById('dividendTableFoot');
    const sumEl = document.getElementById('dividendSummaryText');
    if (!tbody) return;

    const records = state.dividendRecords || [];
    let totalDividendTwd = 0;

    if (records.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" class="text-center" style="padding: 36px; color: var(--text-tertiary);">目前尚無配息收入紀錄</td></tr>`;
      if (tfoot) tfoot.innerHTML = '';
      return;
    }

    let rowsHtml = '';
    for (const d of records) {
      const amtTwd = d.currency === 'USD' ? (d.amount * state.usdRate) : (d.amount || 0);
      totalDividendTwd += amtTwd;

      rowsHtml += `
        <tr>
          <td class="mono">${d.date || '--'}</td>
          <td>
            <span class="symbol-badge">${escapeHtml(d.symbol)}</span>
            <span class="symbol-name">${escapeHtml(d.name || '')}</span>
          </td>
          <td><span class="tag-badge tag-tw_etf">${escapeHtml(d.type || '現金股利')}</span></td>
          <td class="text-right mono">${formatMoney(d.dps, 2)}</td>
          <td class="text-right mono">${formatShares(d.shares)}</td>
          <td class="text-right mono font-semibold val-up">${formatMoney(d.amount, 2)}</td>
          <td class="text-center"><span class="tag-badge">${d.currency || 'TWD'}</span></td>
          <td class="text-right mono font-semibold">NT$ ${formatMoney(amtTwd)}</td>
          <td style="font-size:0.8rem;color:var(--text-secondary);">${escapeHtml(d.note || '--')}</td>
          <td class="text-center admin-only">
            <button class="btn-table-action" onclick="window.fubonApp.editDividendRecord('${d.id}')" title="編輯此筆配息紀錄">編輯</button>
            <button class="btn-table-action text-danger" onclick="window.fubonApp.deleteDividendRecord('${d.id}')" title="刪除此筆配息紀錄">刪除</button>
          </td>
        </tr>
      `;
    }

    tbody.innerHTML = rowsHtml;
    if (sumEl) sumEl.textContent = `NT$ ${formatMoney(totalDividendTwd)}`;

    if (tfoot) {
      tfoot.innerHTML = `
        <tr>
          <td colspan="7" class="text-left"><strong>總配息收入累計合計 (${records.length} 筆發放)</strong></td>
          <td class="text-right mono font-semibold val-up">NT$ ${formatMoney(totalDividendTwd)}</td>
          <td colspan="2"></td>
        </tr>
      `;
    }
  }

  // 9. Visual Analytics Charts
  function renderAnalyticsCharts() {
    renderCategoryDonut();
    renderSymbolDonut();
    renderPLBarChart();
  }

  function renderCategoryDonut() {
    const svg = document.getElementById('categoryDonutSvg');
    const legend = document.getElementById('categoryLegend');
    const totalValEl = document.getElementById('donutTotalVal');
    if (!svg || !legend) return;

    const totalMv = state.portfolioSummary?.totalMarketValueTwd || 0;
    if (totalValEl) totalValEl.textContent = `NT$ ${formatMoney(totalMv / 10000, 1)}萬`;

    const catMap = {
      tw_stock: { name: '台股個股', val: 0, color: '#3b82f6' },
      tw_etf: { name: '台股 ETF', val: 0, color: '#10b981' },
      us: { name: '美股/ETF', val: 0, color: '#8b5cf6' },
      fund: { name: '基金/其他', val: 0, color: '#ec4899' }
    };

    for (const h of Object.values(state.holdings)) {
      const cat = catMap[h.category] ? h.category : 'fund';
      catMap[cat].val += h.marketValueTwd;
    }

    const segments = Object.values(catMap).filter(c => c.val > 0);
    drawDonutSvg(svg, segments, totalMv);

    legend.innerHTML = segments.map(s => {
      const pct = totalMv > 0 ? ((s.val / totalMv) * 100).toFixed(1) : 0;
      return `
        <div class="legend-item">
          <div class="legend-left">
            <span class="legend-dot" style="background:${s.color}"></span>
            <span>${s.name}</span>
          </div>
          <span class="legend-val">${pct}% (NT$ ${formatMoney(s.val)})</span>
        </div>
      `;
    }).join('');
  }

  function renderSymbolDonut() {
    const svg = document.getElementById('symbolDonutSvg');
    const legend = document.getElementById('symbolLegend');
    const topSymbolEl = document.getElementById('donutTopSymbol');
    if (!svg || !legend) return;

    const totalMv = state.portfolioSummary?.totalMarketValueTwd || 0;
    const sorted = Object.values(state.holdings)
      .filter(h => h.marketValueTwd > 0)
      .sort((a, b) => b.marketValueTwd - a.marketValueTwd);

    if (topSymbolEl && sorted.length > 0) {
      topSymbolEl.textContent = sorted[0].symbol;
    }

    const colors = ['#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#6366f1', '#14b8a6', '#64748b'];

    const segments = [];
    let othersVal = 0;
    sorted.forEach((h, idx) => {
      if (idx < 6) {
        segments.push({
          name: h.symbol,
          val: h.marketValueTwd,
          color: colors[idx % colors.length]
        });
      } else {
        othersVal += h.marketValueTwd;
      }
    });
    if (othersVal > 0) {
      segments.push({ name: '其他標的', val: othersVal, color: '#64748b' });
    }

    drawDonutSvg(svg, segments, totalMv);

    legend.innerHTML = segments.map(s => {
      const pct = totalMv > 0 ? ((s.val / totalMv) * 100).toFixed(1) : 0;
      return `
        <div class="legend-item">
          <div class="legend-left">
            <span class="legend-dot" style="background:${s.color}"></span>
            <span>${s.name}</span>
          </div>
          <span class="legend-val">${pct}%</span>
        </div>
      `;
    }).join('');
  }

  function drawDonutSvg(svg, segments, total) {
    if (total <= 0 || segments.length === 0) {
      svg.innerHTML = `<circle cx="110" cy="110" r="80" fill="none" stroke="var(--border-subtle)" stroke-width="24" />`;
      return;
    }

    const cx = 110, cy = 110, r = 80;
    const circumference = 2 * Math.PI * r;
    let accumulatedAngle = 0;
    let pathsHtml = '';

    for (const seg of segments) {
      const ratio = seg.val / total;
      const strokeDash = ratio * circumference;
      const offset = -accumulatedAngle * circumference;

      pathsHtml += `
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
          stroke="${seg.color}"
          stroke-width="24"
          stroke-dasharray="${strokeDash} ${circumference}"
          stroke-dashoffset="${offset}"
          transform="rotate(-90 ${cx} ${cy})"
          style="transition: stroke-dasharray 0.5s ease;"
        >
          <title>${seg.name}: ${((ratio) * 100).toFixed(1)}%</title>
        </circle>
      `;
      accumulatedAngle += ratio;
    }

    svg.innerHTML = pathsHtml;
  }

  function renderPLBarChart() {
    const container = document.getElementById('plBarChartContainer');
    if (!container) return;

    const active = Object.values(state.holdings)
      .filter(h => h.currentShares > 0.0001)
      .sort((a, b) => b.unrealizedPlTwd - a.unrealizedPlTwd);

    if (active.length === 0) {
      container.innerHTML = `<p class="text-center" style="color:var(--text-tertiary);padding:20px;">尚無持有庫存</p>`;
      return;
    }

    const maxPl = Math.max(...active.map(h => Math.abs(h.unrealizedPlTwd)), 1);

    let barsHtml = '';
    for (const h of active) {
      const pl = h.unrealizedPlTwd;
      const isPositive = pl >= 0;
      const widthPct = Math.min(50, (Math.abs(pl) / maxPl) * 50);
      const color = isPositive ? 'var(--stock-up)' : 'var(--stock-down)';
      const sign = isPositive ? '+' : '';

      barsHtml += `
        <div class="bar-item">
          <div class="bar-label" title="${escapeHtml(h.name)}">
            <strong>${escapeHtml(h.symbol)}</strong>
          </div>
          <div class="bar-track">
            <div class="bar-center-line"></div>
            ${isPositive ? `
              <div class="bar-fill" style="position: absolute; left: 50%; width: ${widthPct}%; background: ${color};"></div>
            ` : `
              <div class="bar-fill" style="position: absolute; right: 50%; width: ${widthPct}%; background: ${color};"></div>
            `}
          </div>
          <div class="bar-val ${getValClass(pl)}">
            ${sign}NT$ ${formatMoney(pl)}
            <span style="font-size:0.75rem;display:block;">${formatPercent(h.roiPct)}</span>
          </div>
        </div>
      `;
    }

    container.innerHTML = barsHtml;
  }

  // 10. Non-Blocking Real-Time Quotes Fetching (4.5s Safety Timeout)
  // 10. Robust Real-Time & Night Quotes Fetching
  async function refreshOnlineQuotes(showToast = true) {
    if (state.isRefreshing) return;
    state.isRefreshing = true;

    const btn = document.getElementById('btnRefreshQuotes');
    const btnText = document.getElementById('refreshBtnText');
    const statusText = document.getElementById('liveStatusText');
    const statusPill = document.getElementById('liveStatusPill');

    if (btn) {
      btn.classList.add('is-loading');
      btn.disabled = true;
    }
    if (btnText) btnText.textContent = '更新中...';
    if (statusPill) statusPill.classList.add('is-loading');
    if (statusText) statusText.textContent = '更新報價中...';

    let count = 0;
    const timeoutPromise = new Promise(resolve => setTimeout(() => resolve('timeout'), 8000));

    try {
      const fetchPromise = (async () => {
        // 1. Try Cloudflare Worker Quote Proxy if configured
        const workerUrl = window.REMOTE_ACCESS_CONFIG?.workerQuoteUrl;
        if (workerUrl && workerUrl.startsWith('http')) {
          try {
            const res = await fetch(workerUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ quotes: state.quotes, usdRate: state.usdRate })
            });
            if (res.ok) {
              const json = await res.json();
              if (json.success && json.quotes) {
                mergeServerQuotes(json.quotes);
                if (json.usdRate) state.usdRate = json.usdRate;
                return json.updatedCount || Object.keys(json.quotes).length;
              }
            }
          } catch (e) {
            console.warn('Worker quote fetch fallback:', e);
          }
        }

        // 2. Try local Python server endpoint (for local preview)
        const localEndpoints = [
          IS_FILE_MODE ? 'http://localhost:8088/api/quotes/refresh' : '/api/quotes/refresh'
        ];
        for (const ep of localEndpoints) {
          try {
            const res = await fetch(ep, { method: 'POST', mode: 'cors' });
            if (res.ok) {
              const json = await res.json();
              if (json.success && json.quotes) {
                mergeServerQuotes(json.quotes);
                if (json.usdRate) state.usdRate = json.usdRate;
                return json.updatedCount || Object.keys(json.quotes).length;
              }
            }
          } catch (e) { }
        }

        // 3. Direct browser fetching fallback
        return await fetchBrowserQuotesDirect();
      })();

      const result = await Promise.race([fetchPromise, timeoutPromise]);
      if (result !== 'timeout') {
        count = result || 0;
      }
    } catch (err) {
      console.warn('Quote refresh notice:', err);
    } finally {
      state.isRefreshing = false;
      if (btn) {
        btn.classList.remove('is-loading');
        btn.disabled = false;
      }
      if (btnText) btnText.textContent = '更新報價';
      if (statusPill) statusPill.classList.remove('is-loading');
      state.nextRefreshAt = state.autoRefreshSec > 0 ? Date.now() + (state.autoRefreshSec * 1000) : 0;
    }

    state.lastUpdated = new Date().toLocaleString('zh-TW', { hour12: false });
    recalculatePortfolio();
    updateUi();
    saveStateToLocal();
    if (count > 0 && window.cloudStore?.userRole === 'owner') {
      persistState(['quotes', 'usdRate']);
    }

    if (count > 0) {
      if (statusText) statusText.textContent = `TradingView行情 (${count}檔)`;
      document.querySelectorAll('.price-display').forEach(el => {
        el.classList.add('price-flash');
        setTimeout(() => el.classList.remove('price-flash'), 1200);
      });
      const ratePill = document.getElementById('ratePill');
      if (ratePill) {
        ratePill.classList.add('price-flash');
        setTimeout(() => ratePill.classList.remove('price-flash'), 1200);
      }
      if (showToast) showNotification(`即時與夜盤行情更新完成！已更新 ${count} 檔標的報價，美元即時匯率同步連動為 ${state.usdRate.toFixed(2)}`, 'success');
    } else {
      if (statusText) statusText.textContent = '已載入最新行情';
      if (showToast) showNotification(`已重新計算並顯示最新行情，美元匯率同步更新為 ${state.usdRate.toFixed(2)}`, 'info');
    }
  }

  function mergeServerQuotes(newQuotes) {
    for (const [sym, q] of Object.entries(newQuotes)) {
      if (state.quotes[sym] && q.price) {
        state.quotes[sym].price = q.price;
        if (q.prevClose) state.quotes[sym].prevClose = q.prevClose;
        if (q.nightPrice !== undefined) state.quotes[sym].nightPrice = q.nightPrice;
      }
    }
  }

  async function fetchBrowserQuotesDirect() {
    let updated = 0;
    const updatedSymbols = new Set();

    // 1. Fetch live USD/TWD Rate
    try {
      const tvFxRes = await fetch('https://scanner.tradingview.com/forex/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({
          symbols: { tickers: ['FX_IDC:USDTWD'] },
          columns: ['close', 'change']
        })
      });
      if (tvFxRes.ok) {
        const tvFxData = await tvFxRes.json();
        if (tvFxData.data && tvFxData.data.length > 0 && tvFxData.data[0].d && tvFxData.data[0].d[0]) {
          state.usdRate = Number(Number(tvFxData.data[0].d[0]).toFixed(2));
        }
      }
    } catch (e) {
      try {
        const rateRes = await fetch('https://open.er-api.com/v6/latest/USD', { cache: 'no-store' });
        if (rateRes.ok) {
          const rateJson = await rateRes.json();
          if (rateJson.rates && rateJson.rates.TWD) {
            state.usdRate = Number(rateJson.rates.TWD.toFixed(2));
          }
        }
      } catch (err) { }
    }

    // 2. Collect TradingView symbols
    const tvMap = {};
    const twTickers = [];
    const usTickers = [];

    for (const [sym, q] of Object.entries(state.quotes)) {
      const tv = (q.tvSymbol || '').trim();
      if (tv) {
        if (!tvMap[tv]) tvMap[tv] = [];
        tvMap[tv].push(sym);
        if (tv.startsWith('TWSE:') || tv.startsWith('TPEX:')) {
          twTickers.push(tv);
        } else if (['NASDAQ:', 'AMEX:', 'NYSE:', 'BATS:'].some(p => tv.startsWith(p))) {
          usTickers.push(tv);
        }
      }
    }

    // 3. Try TradingView Taiwan Scan
    if (twTickers.length > 0) {
      try {
        const twRes = await fetch('https://scanner.tradingview.com/taiwan/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          body: JSON.stringify({
            symbols: { tickers: twTickers },
            columns: ['close', 'change', 'change_abs', 'open', 'high', 'low', 'volume', 'description']
          })
        });
        if (twRes.ok) {
          const twData = await twRes.json();
          for (const item of (twData.data || [])) {
            const ticker = item.s;
            const cols = item.d || [];
            if (cols[0] !== null && cols[0] !== undefined) {
              const close = Number(cols[0]);
              const changeAbs = cols[2] !== null && cols[2] !== undefined ? Number(cols[2]) : 0;
              const prev = changeAbs ? Number((close - changeAbs).toFixed(2)) : close;
              for (const sym of (tvMap[ticker] || [])) {
                state.quotes[sym].price = close;
                state.quotes[sym].prevClose = prev;
                if (!state.quotes[sym].nightPrice) {
                  state.quotes[sym].nightPrice = close;
                }
                updatedSymbols.add(sym);
                updated++;
              }
            }
          }
        }
      } catch (e) {
        console.warn('TradingView Taiwan scan notice (will fallback to Yahoo):', e);
      }
    }

    // 4. Try TradingView America Scan
    if (usTickers.length > 0) {
      try {
        const usRes = await fetch('https://scanner.tradingview.com/america/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          body: JSON.stringify({
            symbols: { tickers: usTickers },
            columns: ['close', 'change', 'change_abs', 'open', 'high', 'low', 'volume', 'description', 'postmarket_close', 'premarket_close']
          })
        });
        if (usRes.ok) {
          const usData = await usRes.json();
          for (const item of (usData.data || [])) {
            const ticker = item.s;
            const cols = item.d || [];
            if (cols[0] !== null && cols[0] !== undefined) {
              const close = Number(cols[0]);
              const changeAbs = cols[2] !== null && cols[2] !== undefined ? Number(cols[2]) : 0;
              const prev = changeAbs ? Number((close - changeAbs).toFixed(2)) : close;
              const post = cols[9] !== null && cols[9] !== undefined ? Number(cols[9]) : null;
              const pre = cols[10] !== null && cols[10] !== undefined ? Number(cols[10]) : null;
              const night = (post || pre || close);

              for (const sym of (tvMap[ticker] || [])) {
                state.quotes[sym].price = close;
                state.quotes[sym].prevClose = prev;
                state.quotes[sym].nightPrice = night;
                updatedSymbols.add(sym);
                updated++;
              }
            }
          }
        }
      } catch (e) {
        console.warn('TradingView America scan notice (will fallback to Yahoo):', e);
      }
    }

    // 5. Yahoo Finance Fallback & Night Quotes for all available symbols
    const needYahoo = Object.keys(state.quotes).filter(k => {
      const q = state.quotes[k];
      return q && q.symbolYahoo && !updatedSymbols.has(k);
    });

    if (needYahoo.length > 0) {
      async function fetchProxyJson(targetUrl) {
        const proxies = [
          `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
          `https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`,
          `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`
        ];
        for (const p of proxies) {
          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 4000);
            const res = await fetch(p, { cache: 'no-store', signal: controller.signal });
            clearTimeout(timer);
            if (res.ok) {
              return await res.json();
            }
          } catch (err) { }
        }
        return null;
      }

      await Promise.allSettled(needYahoo.map(async sym => {
        const ticker = state.quotes[sym].symbolYahoo;
        try {
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
          const data = await fetchProxyJson(url);
          const meta = data?.chart?.result?.[0]?.meta;
          if (meta && meta.regularMarketPrice) {
            const currentPrice = Number(meta.regularMarketPrice);
            const prevClose = Number(meta.chartPreviousClose || meta.regularMarketPrice);
            const post = meta.postMarketPrice ? Number(meta.postMarketPrice) : null;
            const pre = meta.preMarketPrice ? Number(meta.preMarketPrice) : null;
            const nightPrice = post || pre || currentPrice;

            state.quotes[sym].price = currentPrice;
            state.quotes[sym].prevClose = prevClose;
            state.quotes[sym].nightPrice = nightPrice;
            updatedSymbols.add(sym);
            updated++;
          }
        } catch (e) {
          console.warn(`Yahoo proxy fetch notice for ${sym}:`, e);
        }
      }));
    }

    return updated;
  }

  function startAutoRefresh() {
    if (state.autoTimer) clearInterval(state.autoTimer);

    const sel = document.getElementById('autoRefreshSelect');
    if (sel) sel.value = String(state.autoRefreshSec);

    state.nextRefreshAt = state.autoRefreshSec > 0 ? Date.now() + (state.autoRefreshSec * 1000) : 0;

    state.autoTimer = setInterval(() => {
      const countdownEl = document.getElementById('autoRefreshCountdown');
      if (!state.autoRefreshSec || state.autoRefreshSec <= 0) {
        if (countdownEl) countdownEl.textContent = '';
        return;
      }

      const remaining = Math.max(0, Math.ceil((state.nextRefreshAt - Date.now()) / 1000));
      if (countdownEl) {
        const m = Math.floor(remaining / 60);
        const s = remaining % 60;
        countdownEl.textContent = m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
      }

      if (remaining <= 0 && !state.isRefreshing && !document.hidden) {
        refreshOnlineQuotes(false);
      }
    }, 1000);
  }

  // 11. TradingView Integration (SNDK fixed to NASDAQ-SNDK)
  function tvTheme() {
    return state.theme === 'light' ? 'light' : 'dark';
  }

  function tvPageUrl(tvSymbol) {
    if (!tvSymbol) return 'https://tw.tradingview.com/';
    const clean = tvSymbol.replace(':', '-');
    return `https://tw.tradingview.com/symbols/${clean}/`;
  }

  function mountTvWidget(container, scriptName, config) {
    if (!container) return;
    container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'tradingview-widget-container';
    wrap.style.height = '100%';
    wrap.style.width = '100%';

    const inner = document.createElement('div');
    inner.className = 'tradingview-widget-container__widget';
    inner.style.height = '100%';
    wrap.appendChild(inner);

    const s = document.createElement('script');
    s.type = 'text/javascript';
    s.async = true;
    s.src = `https://s3.tradingview.com/external-embedding/${scriptName}`;
    s.innerHTML = JSON.stringify(config);
    wrap.appendChild(s);

    container.appendChild(wrap);
  }

  function openTvModal(symbol) {
    const q = state.quotes[symbol];
    if (!q) return;

    if (!q.tvSymbol) {
      if (q.infoUrl) {
        window.open(q.infoUrl, '_blank', 'noopener');
        return;
      }
      showNotification(`${symbol} 尚未設定 TradingView 報價代碼，可在 ⚙️ 標的設定中填入（例如 TWSE:${symbol}）`, 'info');
      if (state.authMode === 'admin') openAssetModal(symbol);
      return;
    }

    const modal = document.getElementById('tvModalBackdrop');
    if (!modal) return;

    const titleEl = document.getElementById('tvModalTitle');
    const subEl = document.getElementById('tvModalSub');
    const extLink = document.getElementById('tvOpenExternalLink');
    const h = state.holdings[symbol] || {};

    if (titleEl) titleEl.textContent = `${symbol} ${q.name || ''}`;
    if (subEl) {
      subEl.innerHTML = `TradingView 代碼：<strong>${escapeHtml(q.tvSymbol)}</strong> ｜ 目前持有 ${formatShares(h.currentShares || 0)} 股 ｜ 未實現損益 <span class="${getValClass(h.unrealizedPlTwd)}">NT$ ${formatMoney(h.unrealizedPlTwd || 0)}</span>`;
    }
    if (extLink) {
      extLink.href = tvPageUrl(q.tvSymbol);
    }

    modal.classList.add('show');

    mountTvWidget(document.getElementById('tvSymbolInfoContainer'), 'embed-widget-symbol-info.js', {
      symbol: q.tvSymbol,
      width: '100%',
      locale: 'zh_TW',
      colorTheme: tvTheme(),
      isTransparent: true
    });

    mountTvWidget(document.getElementById('tvAdvancedChartContainer'), 'embed-widget-advanced-chart.js', {
      autosize: true,
      symbol: q.tvSymbol,
      interval: 'D',
      timezone: 'Asia/Taipei',
      theme: tvTheme(),
      style: '1',
      locale: 'zh_TW',
      allow_symbol_change: false,
      hide_side_toolbar: false,
      calendar: false,
      support_host: 'https://www.tradingview.com'
    });

    mountTvWidget(document.getElementById('tvTechnicalsContainer'), 'embed-widget-technical-analysis.js', {
      interval: '1D',
      width: '100%',
      height: '100%',
      isTransparent: true,
      symbol: q.tvSymbol,
      showIntervalTabs: true,
      displayMode: 'single',
      locale: 'zh_TW',
      colorTheme: tvTheme()
    });
  }

  function closeTvModal() {
    const modal = document.getElementById('tvModalBackdrop');
    if (modal) modal.classList.remove('show');
    ['tvSymbolInfoContainer', 'tvAdvancedChartContainer', 'tvTechnicalsContainer'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '';
    });
  }

  // 12. Target Asset Management (擴充新增/編輯/隱藏標的)
  function guessTvSymbol(code, category) {
    const c = (code || '').trim().toUpperCase();
    if (!c) return '';
    if (c === 'SNDK') return 'NASDAQ:SNDK';
    if (category === 'tw_stock' || category === 'tw_etf') return `TWSE:${c}`;
    if (category === 'us') return c;
    return '';
  }

  function openAssetModal(symbol = null) {
    if (!checkAdminOrPrompt('標的設定')) return;

    const modal = document.getElementById('assetModalBackdrop');
    const form = document.getElementById('assetForm');
    if (!modal || !form) return;
    form.reset();

    const isEdit = !!symbol && !!state.quotes[symbol];
    const q = isEdit ? state.quotes[symbol] : {};
    const h = isEdit ? state.holdings[symbol] : null;

    document.getElementById('assetModalTitle').textContent = isEdit ? `編輯標的：${symbol} (${q.name || ''})` : '新增投資標的';
    document.getElementById('assetOrigSymbol').value = isEdit ? symbol : '';
    document.getElementById('assetSymbol').value = isEdit ? symbol : '';
    document.getElementById('assetSymbol').readOnly = isEdit;
    document.getElementById('assetName').value = q.name || '';
    document.getElementById('assetCategory').value = q.category || 'tw_stock';
    document.getElementById('assetCurrency').value = q.currency || 'TWD';
    document.getElementById('assetPrice').value = isEdit ? (q.price ?? '') : '';
    document.getElementById('assetNightPrice').value = isEdit ? (q.nightPrice ?? q.price ?? '') : '';
    document.getElementById('assetPrev').value = isEdit ? (q.prevClose ?? '') : '';
    document.getElementById('assetTvSymbol').value = q.tvSymbol || '';
    document.getElementById('assetYahooSymbol').value = q.symbolYahoo || '';
    document.getElementById('assetHidden').checked = !!q.hidden;

    const delBtn = document.getElementById('btnAssetDelete');
    if (delBtn) delBtn.style.display = isEdit ? '' : 'none';

    const infoBox = document.getElementById('assetTxInfo');
    if (infoBox) {
      infoBox.textContent = isEdit
        ? `目前持有：${formatShares(h ? h.currentShares : 0)} 股 ｜ 累計交易筆數：${h ? h.txCount : 0} 筆`
        : '新增標的後即可在「買賣清單」中建立交易並自動計算持股與損益。';
    }

    modal.classList.add('show');
  }

  function closeAssetModal() {
    const modal = document.getElementById('assetModalBackdrop');
    if (modal) modal.classList.remove('show');
  }

  async function handleAssetFormSubmit(e) {
    e.preventDefault();
    if (!checkAdminOrPrompt('儲存標的')) return;

    const origSymbol = document.getElementById('assetOrigSymbol').value;
    const symbol = document.getElementById('assetSymbol').value.trim();
    const name = document.getElementById('assetName').value.trim();
    const category = document.getElementById('assetCategory').value;
    const currency = document.getElementById('assetCurrency').value;
    const price = parseFloat(document.getElementById('assetPrice').value) || 0;
    const nightPrice = parseFloat(document.getElementById('assetNightPrice').value) || price;
    const prev = parseFloat(document.getElementById('assetPrev').value) || price;
    const tvSymbol = document.getElementById('assetTvSymbol').value.trim().toUpperCase();
    const yahooSymbol = document.getElementById('assetYahooSymbol').value.trim();
    const isHidden = document.getElementById('assetHidden').checked;

    if (!symbol || !name) {
      showNotification('請填寫標的代號與名稱', 'error');
      return;
    }

    if (!origSymbol && state.quotes[symbol]) {
      showNotification(`標的代號 ${symbol} 已存在`, 'error');
      return;
    }

    const currentOrder = origSymbol && state.quotes[origSymbol]
      ? state.quotes[origSymbol].order
      : Object.keys(state.quotes).length;

    state.quotes[symbol] = {
      name,
      type: CATEGORY_LABELS[category] || '其他',
      category,
      currency,
      price: price > 0 ? price : (origSymbol ? state.quotes[origSymbol].price : 10),
      nightPrice: nightPrice > 0 ? nightPrice : price,
      prevClose: prev > 0 ? prev : (origSymbol ? state.quotes[origSymbol].prevClose : 10),
      tvSymbol,
      symbolYahoo: yahooSymbol,
      hidden: isHidden,
      order: currentOrder
    };

    state.transactions.forEach(t => {
      if (t.symbol === symbol) {
        t.name = name;
        t.currency = currency;
      }
    });

    closeAssetModal();
    populateSymbolSelects();
    recalculatePortfolio();
    updateUi();

    await persistState(['quotes', 'transactions']);

    showNotification(origSymbol ? `標的「${name}」已更新` : `已成功新增標的「${name} (${symbol})」`, 'success');
  }

  async function deleteAsset() {
    if (!checkAdminOrPrompt('刪除標的')) return;
    const symbol = document.getElementById('assetOrigSymbol').value;
    if (!symbol || !state.quotes[symbol]) return;

    const txCount = state.transactions.filter(t => t.symbol === symbol).length;
    const confirmMsg = txCount > 0
      ? `確定刪除標的「${symbol}」嗎？\n該標的包含 ${txCount} 筆交易紀錄，刪除後將一併移除且無法復原。\n(若不想顯示，建議勾選「隱藏此標的」即可)`
      : `確定刪除標的「${symbol}」嗎？`;

    if (!confirm(confirmMsg)) return;

    delete state.quotes[symbol];
    state.transactions = state.transactions.filter(t => t.symbol !== symbol);

    closeAssetModal();
    populateSymbolSelects();
    recalculatePortfolio();
    updateUi();

    await persistState(['quotes', 'transactions']);

    showNotification(`已刪除標的 ${symbol}`, 'info');
  }

  // 13. Dashboard Title Editing
  function startEditTitle() {
    if (!checkAdminOrPrompt('編輯名稱')) return;
    const el = document.getElementById('dashboardTitle');
    if (!el) return;
    el.contentEditable = 'true';
    el.classList.add('editing');
    el.focus();

    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function finishEditTitle(save = true) {
    const el = document.getElementById('dashboardTitle');
    if (!el || el.contentEditable !== 'true') return;
    el.contentEditable = 'false';
    el.classList.remove('editing');

    const text = el.textContent.trim();
    if (save && text) {
      state.dashboardTitle = text.slice(0, 40);
      localStorage.setItem('fubon_dashboard_title', state.dashboardTitle);
      applyDashboardTitle();
      persistState(['dashboardTitle']);
      showNotification('儀表板名稱已儲存', 'success');
    } else {
      applyDashboardTitle();
    }
  }

  function applyDashboardTitle() {
    const el = document.getElementById('dashboardTitle');
    if (el) el.textContent = state.dashboardTitle;
    document.title = `${state.dashboardTitle} | 即時行情 · 買賣連動`;
  }

  // 14. Transaction CRUD
  function populateSymbolSelects() {
    const filterSelect = document.getElementById('txFilterSymbol');
    const formSelect = document.getElementById('txFormSymbol');
    const divSelect = document.getElementById('divFormSymbol');

    const symbols = Object.keys(state.quotes);

    if (filterSelect) {
      let filterOpts = '<option value="all">所有標的</option>';
      for (const sym of symbols) {
        const q = state.quotes[sym];
        filterOpts += `<option value="${sym}">${sym} - ${q.name}</option>`;
      }
      filterSelect.innerHTML = filterOpts;
    }

    if (formSelect) {
      let formOpts = '<option value="" disabled selected>請選擇標的...</option>';
      for (const sym of symbols) {
        const q = state.quotes[sym];
        formOpts += `<option value="${sym}">${sym} (${q.name}) - ${q.currency}</option>`;
      }
      formSelect.innerHTML = formOpts;
    }

    if (divSelect) {
      let divOpts = '<option value="" disabled selected>請選擇標的...</option>';
      for (const sym of symbols) {
        const q = state.quotes[sym];
        divOpts += `<option value="${sym}">${sym} (${q.name}) - ${q.currency}</option>`;
      }
      divSelect.innerHTML = divOpts;
    }

    const realSelect = document.getElementById('realFormSymbol');
    if (realSelect) {
      let realOpts = '<option value="" disabled selected>請選擇標的...</option>';
      for (const sym of symbols) {
        const q = state.quotes[sym];
        realOpts += `<option value="${sym}">${sym} (${q.name}) - ${q.currency}</option>`;
      }
      realSelect.innerHTML = realOpts;
    }
  }

  function openAddTxModal(initialSymbol = null, initialAction = null) {
    if (!checkAdminOrPrompt('新增交易')) return;

    state.editingTxId = null;
    const modal = document.getElementById('txModalBackdrop');
    const title = document.getElementById('txModalTitle');
    const form = document.getElementById('txForm');
    if (!modal || !form) return;

    form.reset();
    document.getElementById('txFormId').value = '';
    title.textContent = '新增買賣交易';

    const today = new Date().toISOString().split('T')[0];
    document.getElementById('txFormDate').value = today;

    if (initialAction) document.getElementById('txFormAction').value = initialAction;

    if (initialSymbol) {
      document.getElementById('txFormSymbol').value = initialSymbol;
      updateFormQuoteHelper(initialSymbol);
    } else {
      const firstSym = Object.keys(state.quotes)[0];
      if (firstSym) {
        document.getElementById('txFormSymbol').value = firstSym;
        updateFormQuoteHelper(firstSym);
      }
    }

    modal.classList.add('show');
  }

  function openEditTxModal(txId) {
    if (!checkAdminOrPrompt('修改交易')) return;
    const tx = state.transactions.find(t => t.id === txId);
    if (!tx) return;

    state.editingTxId = txId;
    const modal = document.getElementById('txModalBackdrop');
    const title = document.getElementById('txModalTitle');
    if (!modal) return;

    title.textContent = '修改交易記錄';
    document.getElementById('txFormId').value = tx.id;
    document.getElementById('txFormDate').value = tx.date;
    document.getElementById('txFormAction').value = tx.action;
    document.getElementById('txFormSymbol').value = tx.symbol;
    document.getElementById('txFormShares').value = tx.shares;
    document.getElementById('txFormPrice').value = tx.price;
    document.getElementById('txFormTotal').value = tx.total_amount;
    document.getElementById('txFormNote').value = tx.note || '';

    updateFormQuoteHelper(tx.symbol);
    modal.classList.add('show');
  }

  function closeTxModal() {
    const modal = document.getElementById('txModalBackdrop');
    if (modal) modal.classList.remove('show');
    state.editingTxId = null;
  }

  function updateFormQuoteHelper(symbol) {
    const q = state.quotes[symbol];
    const h = state.holdings[symbol];
    if (!q) return;

    const priceEl = document.getElementById('helperCurrentPrice');
    const currEl = document.getElementById('helperCurrency');
    const sharesEl = document.getElementById('helperCurrentShares');
    const formCurrLabel = document.getElementById('formCurrLabel');

    if (priceEl) priceEl.textContent = formatMoney(q.price, 2);
    if (currEl) currEl.textContent = q.currency;
    if (sharesEl) sharesEl.textContent = formatShares(h ? h.currentShares : 0);
    if (formCurrLabel) formCurrLabel.textContent = q.currency;

    const action = document.getElementById('txFormAction').value;
    const hintEl = document.getElementById('sharesAvailableHint');
    if (hintEl) {
      if (action.includes('賣')) {
        hintEl.textContent = `⚠️ 目前最多可賣出 ${formatShares(h ? h.currentShares : 0)} 股`;
        hintEl.style.color = '#f59e0b';
      } else {
        hintEl.textContent = '';
      }
    }
  }

  async function handleTxFormSubmit(e) {
    e.preventDefault();
    if (!checkAdminOrPrompt('儲存交易')) return;

    const isEdit = !!state.editingTxId;
    const symbol = document.getElementById('txFormSymbol').value;
    const q = state.quotes[symbol] || {};

    const shares = parseFloat(document.getElementById('txFormShares').value);
    const price = parseFloat(document.getElementById('txFormPrice').value);
    const total = parseFloat(document.getElementById('txFormTotal').value);
    const action = document.getElementById('txFormAction').value;

    if (!symbol || isNaN(shares) || shares <= 0 || isNaN(price) || price <= 0 || isNaN(total) || total <= 0) {
      showNotification('請完整填寫有效股數、單價與金額', 'error');
      return;
    }

    const txData = {
      id: isEdit ? state.editingTxId : `tx_${Date.now()}`,
      date: document.getElementById('txFormDate').value,
      symbol: symbol,
      name: q.name || symbol,
      action: action,
      shares: shares,
      price: price,
      total_amount: total,
      currency: q.currency || 'TWD',
      note: document.getElementById('txFormNote').value.trim()
    };

    if (isEdit) {
      const idx = state.transactions.findIndex(t => t.id === state.editingTxId);
      if (idx !== -1) state.transactions[idx] = txData;
    } else {
      state.transactions.unshift(txData);

      // If user adds a sell transaction, also record the settlement into realizedRecords!
      if (action && action.includes('賣')) {
        const h = state.holdings[symbol];
        const avgCost = h && h.avgCost > 0 ? h.avgCost : price;
        const rate = (q.currency === 'USD') ? state.usdRate : 1.0;
        const plTwd = Math.round((price - avgCost) * shares * rate);
        const roiPct = avgCost > 0 ? Number((((price - avgCost) / avgCost) * 100).toFixed(2)) : 0;
        state.realizedRecords.unshift({
          id: `real_${Date.now()}`,
          date: txData.date,
          symbol: symbol,
          name: q.name || symbol,
          shares: shares,
          sellPrice: price,
          buyPrice: Number(avgCost.toFixed(2)),
          currency: q.currency || 'TWD',
          realizedPlTwd: plTwd,
          roiPct: roiPct,
          note: txData.note || `賣出結算 (${formatShares(shares)} 股)`
        });
      }
    }

    closeTxModal();
    recalculatePortfolio();
    updateUi();

    await persistState(['transactions', 'realizedRecords']);

    showNotification(
      isEdit ? `交易修改成功！持有股數已同步連動` : `新增交易成功！持有股數與成本已即刻連動更新`,
      'success'
    );
  }

  function openDeleteTxModal(txId) {
    if (!checkAdminOrPrompt('刪除交易')) return;
    const tx = state.transactions.find(t => t.id === txId);
    if (!tx) return;

    state.deleteTarget = { type: 'tx', id: txId };
    const modal = document.getElementById('deleteModalBackdrop');
    const preview = document.getElementById('deleteTxPreview');
    if (!modal || !preview) return;

    document.getElementById('deleteModalMsg').textContent = '您確定要刪除此筆交易嗎？';
    preview.innerHTML = `
      <div><strong>交易日期：</strong> ${tx.date}</div>
      <div><strong>標的名稱：</strong> ${tx.symbol} (${tx.name})</div>
      <div><strong>交易型態：</strong> ${tx.action}</div>
      <div><strong>成交股數：</strong> ${formatShares(tx.shares)} 股</div>
      <div><strong>總金額：</strong> ${formatMoney(tx.total_amount, 2)} ${tx.currency}</div>
    `;

    modal.classList.add('show');
  }

  function closeDeleteModal() {
    const modal = document.getElementById('deleteModalBackdrop');
    if (modal) modal.classList.remove('show');
    state.deleteTarget = null;
  }

  async function confirmDeleteAction() {
    if (!state.deleteTarget) return;

    if (state.deleteTarget.type === 'tx') {
      state.transactions = state.transactions.filter(t => t.id !== state.deleteTarget.id);
      await persistState(['transactions']);
      showNotification('交易紀錄已刪除，持有股數與損益已重新計算完成', 'info');
    } else if (state.deleteTarget.type === 'div') {
      state.dividendRecords = state.dividendRecords.filter(d => d.id !== state.deleteTarget.id);
      await persistState(['dividendRecords']);
      showNotification('配息紀錄已刪除', 'info');
    } else if (state.deleteTarget.type === 'real') {
      state.realizedRecords = state.realizedRecords.filter(r => r.id !== state.deleteTarget.id);
      await persistState(['realizedRecords']);
      showNotification('已實現結算紀錄已刪除', 'info');
    }

    closeDeleteModal();
    recalculatePortfolio();
    updateUi();
  }

  // 15. Realized & Dividend CRUD
  function openAddDividendModal() {
    if (!checkAdminOrPrompt('新增配息')) return;
    state.editingDivId = null;
    const modal = document.getElementById('dividendModalBackdrop');
    const form = document.getElementById('dividendForm');
    if (!modal || !form) return;
    form.reset();
    document.getElementById('dividendFormId').value = '';
    const title = document.getElementById('dividendModalTitle');
    if (title) title.textContent = '新增配息紀錄';
    document.getElementById('divFormDate').value = new Date().toISOString().split('T')[0];
    modal.classList.add('show');
  }

  function openEditDividendModal(id) {
    if (!checkAdminOrPrompt('編輯配息紀錄')) return;
    const d = state.dividendRecords.find(x => x.id === id);
    if (!d) return;
    state.editingDivId = id;
    const modal = document.getElementById('dividendModalBackdrop');
    if (!modal) return;
    const title = document.getElementById('dividendModalTitle');
    if (title) title.textContent = '編輯配息紀錄';
    document.getElementById('dividendFormId').value = d.id;
    document.getElementById('divFormDate').value = d.date || '';
    document.getElementById('divFormSymbol').value = d.symbol || '';
    document.getElementById('divFormType').value = d.type || '現金股利';
    document.getElementById('divFormDps').value = d.dps || '';
    document.getElementById('divFormShares').value = d.shares || '';
    document.getElementById('divFormAmount').value = d.amount || '';
    document.getElementById('divFormNote').value = d.note || '';
    const q = state.quotes[d.symbol];
    if (q) document.getElementById('divCurrLabel').textContent = q.currency || 'TWD';
    modal.classList.add('show');
  }

  function closeDividendModal() {
    const modal = document.getElementById('dividendModalBackdrop');
    if (modal) modal.classList.remove('show');
    state.editingDivId = null;
  }

  async function handleDividendFormSubmit(e) {
    e.preventDefault();
    if (!checkAdminOrPrompt('儲存配息')) return;

    const sym = document.getElementById('divFormSymbol').value;
    const q = state.quotes[sym] || {};
    const dps = parseFloat(document.getElementById('divFormDps').value) || 0;
    const shares = parseFloat(document.getElementById('divFormShares').value) || 0;
    const amount = parseFloat(document.getElementById('divFormAmount').value);

    if (!sym || isNaN(amount) || amount <= 0) {
      showNotification('請完整填寫標的與配息金額', 'error');
      return;
    }

    const divData = {
      id: state.editingDivId || `div_${Date.now()}`,
      date: document.getElementById('divFormDate').value,
      symbol: sym,
      name: q.name || sym,
      type: document.getElementById('divFormType').value,
      dps: dps,
      shares: shares,
      amount: amount,
      currency: q.currency || 'TWD',
      note: document.getElementById('divFormNote').value.trim()
    };

    if (state.editingDivId) {
      const idx = state.dividendRecords.findIndex(d => d.id === state.editingDivId);
      if (idx !== -1) state.dividendRecords[idx] = divData;
    } else {
      state.dividendRecords.unshift(divData);
    }

    closeDividendModal();
    recalculatePortfolio();
    updateUi();
    await persistState(['dividendRecords']);
    showNotification('配息紀錄已儲存！總配息收入已自動連動累計', 'success');
  }

  function deleteDividendRecord(id) {
    if (!checkAdminOrPrompt('刪除配息紀錄')) return;
    state.deleteTarget = { type: 'div', id: id };
    const d = state.dividendRecords.find(x => x.id === id);
    const modal = document.getElementById('deleteModalBackdrop');
    const preview = document.getElementById('deleteTxPreview');
    if (!modal || !preview) return;

    document.getElementById('deleteModalMsg').textContent = '您確定要刪除此筆配息紀錄嗎？';
    preview.innerHTML = `
      <div><strong>發放日期：</strong> ${d?.date}</div>
      <div><strong>標的名稱：</strong> ${d?.symbol} (${d?.name})</div>
      <div><strong>實領金額：</strong> ${formatMoney(d?.amount, 2)} ${d?.currency}</div>
    `;
    modal.classList.add('show');
  }

  // Realized Records Modal Handlers
  function openAddRealizedModal() {
    if (!checkAdminOrPrompt('新增已實現結算紀錄')) return;
    state.editingRealId = null;
    const modal = document.getElementById('realizedModalBackdrop');
    const form = document.getElementById('realizedForm');
    if (!modal || !form) return;
    form.reset();
    document.getElementById('realizedFormId').value = '';
    const title = document.getElementById('realizedModalTitle');
    if (title) title.textContent = '新增已實現結算紀錄';
    document.getElementById('realFormDate').value = new Date().toISOString().split('T')[0];
    updateRealizedHelper();
    modal.classList.add('show');
  }

  function openEditRealizedModal(id) {
    if (!checkAdminOrPrompt('編輯已實現結算紀錄')) return;
    const r = state.realizedRecords.find(x => x.id === id);
    if (!r) return;
    state.editingRealId = id;
    const modal = document.getElementById('realizedModalBackdrop');
    if (!modal) return;
    const title = document.getElementById('realizedModalTitle');
    if (title) title.textContent = '編輯已實現結算紀錄';
    document.getElementById('realizedFormId').value = r.id;
    document.getElementById('realFormDate').value = r.date || '';
    document.getElementById('realFormSymbol').value = r.symbol || '';
    document.getElementById('realFormShares').value = r.shares || '';
    document.getElementById('realFormSellPrice').value = r.sellPrice || '';
    document.getElementById('realFormBuyPrice').value = r.buyPrice || '';
    document.getElementById('realFormPlTwd').value = r.realizedPlTwd !== undefined ? r.realizedPlTwd : '';
    document.getElementById('realFormNote').value = r.note || '';
    const q = state.quotes[r.symbol];
    if (q) document.getElementById('realCurrLabel').textContent = q.currency || 'NT$';
    modal.classList.add('show');
  }

  function closeRealizedModal() {
    const modal = document.getElementById('realizedModalBackdrop');
    if (modal) modal.classList.remove('show');
    state.editingRealId = null;
  }

  function autoCalcRealizedPl() {
    const sym = document.getElementById('realFormSymbol')?.value;
    const shares = parseFloat(document.getElementById('realFormShares')?.value) || 0;
    const sellPrice = parseFloat(document.getElementById('realFormSellPrice')?.value) || 0;
    const buyPrice = parseFloat(document.getElementById('realFormBuyPrice')?.value) || 0;
    if (shares > 0 && sellPrice > 0 && buyPrice > 0) {
      const q = state.quotes[sym] || {};
      const rate = q.currency === 'USD' ? state.usdRate : 1.0;
      const plTwd = Math.round((sellPrice - buyPrice) * shares * rate);
      const plInput = document.getElementById('realFormPlTwd');
      if (plInput) plInput.value = plTwd;
    }
  }

  function updateRealizedHelper() {
    const sym = document.getElementById('realFormSymbol')?.value;
    if (!sym) return;
    const q = state.quotes[sym] || {};
    const h = state.holdings[sym];
    const currLabel = document.getElementById('realCurrLabel');
    if (currLabel) currLabel.textContent = q.currency || 'NT$';
    const buyPriceInput = document.getElementById('realFormBuyPrice');
    if (buyPriceInput && !buyPriceInput.value && h && h.avgCost > 0) {
      buyPriceInput.value = Number(h.avgCost.toFixed(2));
    }
    const sellPriceInput = document.getElementById('realFormSellPrice');
    if (sellPriceInput && !sellPriceInput.value && q.price > 0) {
      sellPriceInput.value = q.price;
    }
    autoCalcRealizedPl();
  }

  async function handleRealizedFormSubmit(e) {
    e.preventDefault();
    if (!checkAdminOrPrompt('儲存已實現結算紀錄')) return;

    const sym = document.getElementById('realFormSymbol').value;
    const q = state.quotes[sym] || {};
    const shares = parseFloat(document.getElementById('realFormShares').value);
    const sellPrice = parseFloat(document.getElementById('realFormSellPrice').value);
    const buyPrice = parseFloat(document.getElementById('realFormBuyPrice').value);
    const plTwd = parseFloat(document.getElementById('realFormPlTwd').value);

    if (!sym || isNaN(shares) || shares <= 0 || isNaN(sellPrice) || isNaN(buyPrice)) {
      showNotification('請完整填寫標的、股數與價格', 'error');
      return;
    }

    const roiPct = buyPrice > 0 ? Number((((sellPrice - buyPrice) / buyPrice) * 100).toFixed(2)) : 0;
    const realData = {
      id: state.editingRealId || `real_${Date.now()}`,
      date: document.getElementById('realFormDate').value,
      symbol: sym,
      name: q.name || sym,
      shares: shares,
      sellPrice: sellPrice,
      buyPrice: buyPrice,
      currency: q.currency || 'TWD',
      realizedPlTwd: isNaN(plTwd) ? Math.round((sellPrice - buyPrice) * shares * (q.currency === 'USD' ? state.usdRate : 1)) : plTwd,
      roiPct: roiPct,
      note: document.getElementById('realFormNote').value.trim()
    };

    if (state.editingRealId) {
      const idx = state.realizedRecords.findIndex(r => r.id === state.editingRealId);
      if (idx !== -1) state.realizedRecords[idx] = realData;
    } else {
      state.realizedRecords.unshift(realData);
    }

    closeRealizedModal();
    recalculatePortfolio();
    updateUi();
    await persistState(['realizedRecords']);
    showNotification('已實現結算紀錄已儲存！總結算損益已即刻連動更新', 'success');
  }

  function deleteRealizedRecord(id) {
    if (!checkAdminOrPrompt('刪除已實現損益紀錄')) return;
    state.deleteTarget = { type: 'real', id: id };
    const r = state.realizedRecords.find(x => x.id === id);
    const modal = document.getElementById('deleteModalBackdrop');
    const preview = document.getElementById('deleteTxPreview');
    if (!modal || !preview) return;

    document.getElementById('deleteModalMsg').textContent = '您確定要刪除此筆已實現損益紀錄嗎？';
    preview.innerHTML = `
      <div><strong>結算日期：</strong> ${r?.date}</div>
      <div><strong>標的名稱：</strong> ${r?.symbol} (${r?.name})</div>
      <div><strong>已實現損益：</strong> NT$ ${formatMoney(r?.realizedPlTwd)}</div>
    `;
    modal.classList.add('show');
  }

  // 16. Edit Quote Modal (白盤與夜盤現價)
  function openEditQuoteModal(symbol) {
    if (!checkAdminOrPrompt('修改價格')) return;
    const q = state.quotes[symbol];
    if (!q) return;

    const modal = document.getElementById('quoteModalBackdrop');
    if (!modal) return;

    document.getElementById('quoteSymbol').value = symbol;
    document.getElementById('quoteModalName').textContent = q.name;
    document.getElementById('quoteModalSymbol').textContent = symbol;
    document.getElementById('quoteModalCurr').textContent = q.currency;
    document.getElementById('quoteModalNightCurr').textContent = q.currency;
    document.getElementById('quoteModalPrevCurr').textContent = q.currency;
    document.getElementById('quoteModalPrice').value = q.price;
    document.getElementById('quoteModalNightPrice').value = q.nightPrice || q.price;
    document.getElementById('quoteModalPrev').value = q.prevClose;

    modal.classList.add('show');
  }

  function closeQuoteModal() {
    const modal = document.getElementById('quoteModalBackdrop');
    if (modal) modal.classList.remove('show');
  }

  async function handleQuoteFormSubmit(e) {
    e.preventDefault();
    if (!checkAdminOrPrompt('儲存價格')) return;

    const symbol = document.getElementById('quoteSymbol').value;
    const price = parseFloat(document.getElementById('quoteModalPrice').value);
    const nightPrice = parseFloat(document.getElementById('quoteModalNightPrice').value);
    const prev = parseFloat(document.getElementById('quoteModalPrev').value);

    if (!symbol || isNaN(price) || price <= 0) {
      showNotification('請輸入有效價格', 'error');
      return;
    }

    state.quotes[symbol].price = price;
    if (!isNaN(nightPrice) && nightPrice > 0) {
      state.quotes[symbol].nightPrice = nightPrice;
    } else {
      state.quotes[symbol].nightPrice = price;
    }
    if (!isNaN(prev) && prev > 0) {
      state.quotes[symbol].prevClose = prev;
    }

    closeQuoteModal();
    recalculatePortfolio();
    updateUi();
    await persistState(['quotes']);
    showNotification(`${symbol} 最新白盤與夜盤現價已更新`, 'success');
  }

  // 17. Settings Modal
  function openRateModal() {
    const modal = document.getElementById('rateModalBackdrop');
    if (modal) {
      document.getElementById('rateInput').value = state.usdRate;
      document.getElementById('baselineRealizedInput').value = state.baselineRealizedPl;
      document.getElementById('baselineDividendInput').value = state.baselineDividendIncome;
      document.getElementById('newAdminPassword').value = '';
      modal.classList.add('show');
    }
  }

  function closeRateModal() {
    const modal = document.getElementById('rateModalBackdrop');
    if (modal) modal.classList.remove('show');
  }

  async function handleRateFormSubmit(e) {
    e.preventDefault();
    if (!checkAdminOrPrompt('儲存設定')) return;

    const rate = parseFloat(document.getElementById('rateInput').value);
    const realized = parseFloat(document.getElementById('baselineRealizedInput').value);
    const dividend = parseFloat(document.getElementById('baselineDividendInput').value);
    const newPw = document.getElementById('newAdminPassword').value.trim();

    if (isNaN(rate) || rate <= 0) return;

    state.usdRate = rate;
    if (!isNaN(realized)) state.baselineRealizedPl = realized;
    if (!isNaN(dividend)) state.baselineDividendIncome = dividend;

    if (newPw) {
      state.adminPasswordHash = await sha256(newPw);
      localStorage.setItem('fubon_admin_pw_hash', state.adminPasswordHash);
      showNotification('管理員密碼已成功變更！', 'success');
    }

    closeRateModal();
    recalculatePortfolio();
    updateUi();
    await persistState(['usdRate', 'baselineRealizedPl', 'baselineDividendIncome']);
    showNotification(`已更新匯率與已實現損益/配息基數`, 'success');
  }

  // 18. CSV Import / Overwrite Feature (覆蓋與匯入更新)
  function handleCsvFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (!checkAdminOrPrompt('匯入 CSV 覆蓋資料')) {
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = function (evt) {
      try {
        const text = evt.target.result;
        parseAndApplyCsv(text);
        showNotification(`CSV 檔案「${file.name}」已成功解析並覆蓋連動！`, 'success');
      } catch (err) {
        console.error('CSV parse error:', err);
        showNotification('CSV 檔案解析失敗，請確認檔案格式正確', 'error');
      }
      e.target.value = '';
    };
    reader.readAsText(file, 'utf-8');
  }

  function parseAndApplyCsv(csvText) {
    const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length < 2) throw new Error('CSV 內容為空或無有效行');

    // Simple robust CSV line splitter
    const parseLine = (text) => {
      const result = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '"') {
          inQuotes = !inQuotes;
        } else if (c === ',' && !inQuotes) {
          result.push(cur.trim());
          cur = '';
        } else {
          cur += c;
        }
      }
      result.push(cur.trim());
      return result;
    };

    const header = parseLine(lines[0]);

    // Check if this is the multi-column investment matrix CSV (富邦試算(投資清單).csv)
    if (header.some(h => h.includes('0050(價格)'))) {
      const assetsMeta = [
        { sym: "0050", name: "元大台灣50", p: 1, q: 2, a: 3, curr: "TWD" },
        { sym: "2330", name: "台積電", p: 4, q: 5, a: 6, curr: "TWD" },
        { sym: "VOO", name: "Vanguard 標普500 ETF", p: 7, q: 8, a: 9, curr: "USD" },
        { sym: "00981A", name: "統一台灣高息動能/00981A", p: 10, q: 11, a: 12, curr: "TWD" },
        { sym: "00403A", name: "瀚亞/00403A", p: 13, q: 14, a: 15, curr: "TWD" },
        { sym: "00406A", name: "00406A", p: 16, q: 17, a: 18, curr: "TWD" },
        { sym: "路博邁", name: "路博邁NB 5G股票基金", p: 19, q: 20, a: 21, curr: "TWD" },
        { sym: "瀚亞", name: "瀚亞科技基金", p: 22, q: 23, a: 24, curr: "USD" },
        { sym: "台達電", name: "台達電", p: 25, q: 26, a: 27, curr: "TWD" },
        { sym: "聯發科", name: "聯發科", p: 28, q: 29, a: 30, curr: "TWD" },
        { sym: "領袖", name: "國泰台灣領袖50", p: 31, q: 32, a: 33, curr: "TWD" },
        { sym: "南亞科", name: "南亞科", p: 34, q: 35, a: 36, curr: "TWD" },
        { sym: "MU", name: "美光科技 Micron", p: 37, q: 38, a: 39, curr: "USD" },
        { sym: "NVDA", name: "輝達 NVIDIA", p: 40, q: 41, a: 42, curr: "USD" },
        { sym: "MRVL", name: "邁威爾 Marvell", p: 43, q: 44, a: 45, curr: "USD" },
        { sym: "SpaceX", name: "SpaceX", p: 46, q: 47, a: 48, curr: "USD" },
        { sym: "SNDK", name: "SNDK", p: 49, q: 50, a: 51, curr: "USD" }
      ];

      // Read baseline figures from row 2
      const row2 = parseLine(lines[1]);
      if (row2.length > 60) {
        const usdVal = parseFloat(row2[55]?.replace(/,/g, ''));
        if (!isNaN(usdVal) && usdVal > 0) state.usdRate = usdVal;
        const realVal = parseFloat(row2[60]?.replace(/,/g, ''));
        if (!isNaN(realVal)) state.baselineRealizedPl = realVal;
        const divVal = parseFloat(row2[61]?.replace(/,/g, ''));
        if (!isNaN(divVal)) state.baselineDividendIncome = divVal;
      }

      const newTxList = [];
      for (let i = 1; i < lines.length; i++) {
        const row = parseLine(lines[i]);
        if (!row[0] || !row[0].match(/^\d{4}-\d{2}-\d{2}$/)) continue;
        const date = row[0];
        const typeCol = row[52] || '';

        for (const a of assetsMeta) {
          const qVal = row[a.q]?.replace(/,/g, '') || '0';
          const aVal = row[a.a]?.replace(/,/g, '') || '0';
          const pVal = row[a.p]?.replace(/,/g, '') || '0';

          const q = parseFloat(qVal);
          const amt = parseFloat(aVal);
          const p = parseFloat(pVal);

          if (!isNaN(q) && (q !== 0 || amt !== 0)) {
            const isSell = q < 0 || typeCol.includes('賣');
            const action = isSell ? '賣出' : (typeCol.includes('定期') ? '定期定額' : '單筆買進');
            const absShares = Math.abs(q);
            const absAmt = Math.abs(amt);
            const actualPrice = p > 0 ? p : (absShares > 0 ? (absAmt / absShares) : 0);

            newTxList.push({
              id: `tx_${newTxList.length + 1}`,
              date: date,
              symbol: a.sym,
              name: a.name,
              action: action,
              shares: absShares,
              price: actualPrice,
              total_amount: absAmt,
              currency: a.curr,
              note: ''
            });
          }
        }
      }

      if (newTxList.length > 0) {
        state.transactions = newTxList;
      }
    } else {
      // Standard transaction ledger CSV format
      const newTxList = [];
      for (let i = 1; i < lines.length; i++) {
        const row = parseLine(lines[i]);
        if (row.length >= 6) {
          newTxList.push({
            id: row[0] || `tx_${i}`,
            date: row[1] || '',
            symbol: row[2] || '',
            name: row[3] || '',
            action: row[4] || '單筆買進',
            shares: parseFloat(row[5]?.replace(/,/g, '')) || 0,
            price: parseFloat(row[6]?.replace(/,/g, '')) || 0,
            total_amount: parseFloat(row[7]?.replace(/,/g, '')) || 0,
            currency: row[8] || 'TWD',
            note: row[9] || ''
          });
        }
      }
      if (newTxList.length > 0) state.transactions = newTxList;
    }

    recalculatePortfolio();
    updateUi();
  }

  // 19. CSV Export
  function exportCsv() {
    const headers = [
      '交易ID', '交易日期', '標的代號', '標的名稱', '交易型態', '成交股數', '成交單價', '成交總額', '幣別', '備註'
    ];

    const sorted = [...state.transactions].sort((a, b) => new Date(a.date) - new Date(b.date));

    let csvContent = '\uFEFF' + headers.join(',') + '\n';
    for (const t of sorted) {
      const row = [
        t.id,
        t.date,
        t.symbol,
        `"${(t.name || '').replace(/"/g, '""')}"`,
        t.action,
        t.shares,
        t.price,
        t.total_amount,
        t.currency,
        `"${(t.note || '').replace(/"/g, '""')}"`
      ];
      csvContent += row.join(',') + '\n';
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `富邦投資清單_最新連動資料_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showNotification('投資清單 CSV 匯出成功！', 'success');
  }

  // 20. Theme & Color Mode
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.theme);
    const icon = document.getElementById('themeIcon');
    if (icon) icon.textContent = state.theme === 'dark' ? '🌙' : '☀️';
    localStorage.setItem('fubon_theme', state.theme);
  }

  function toggleTheme() {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
    renderAnalyticsCharts();
  }

  function applyColorMode() {
    document.documentElement.setAttribute('data-color-mode', state.colorMode);
    const text = document.getElementById('colorModeText');
    if (text) text.textContent = state.colorMode === 'tw' ? '台股習慣 (紅漲綠跌)' : '國際習慣 (綠漲紅跌)';
    localStorage.setItem('fubon_color_mode', state.colorMode);
  }

  function toggleColorMode() {
    state.colorMode = state.colorMode === 'tw' ? 'us' : 'tw';
    applyColorMode();
    updateUi();
  }

  // 21. Toast Notification
  function showNotification(msg, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '⚠️';

    toast.innerHTML = `<span>${icon}</span><span>${escapeHtml(msg)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = '0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // 22. Event Listeners Setup
  function setupEventListeners() {
    // Tab switching
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const targetId = tab.dataset.tab;
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

        tab.classList.add('active');
        const targetPane = document.getElementById(targetId);
        if (targetPane) targetPane.classList.add('active');

        state.activeTab = targetId;
        if (targetId === 'tab-analytics') renderAnalyticsCharts();
        if (targetId === 'tab-realized') renderRealizedTable();
        if (targetId === 'tab-dividends') renderDividendTable();
      });
    });

    // Interactive KPI Cards linking to tabs
    document.getElementById('realizedCard')?.addEventListener('click', () => {
      document.querySelector('.nav-tab[data-tab="tab-realized"]')?.click();
    });
    document.getElementById('dividendCard')?.addEventListener('click', () => {
      document.querySelector('.nav-tab[data-tab="tab-dividends"]')?.click();
    });

    // Auth Button Toggle (View vs Admin)
    document.getElementById('btnAuthToggle')?.addEventListener('click', () => {
      if (state.authMode === 'admin') {
        if (confirm('確定登出管理員模式，切換為訪客檢視模式？')) {
          state.authMode = 'view';
          applyAuthMode();
          updateUi();
          showNotification('已切換為訪客檢視模式', 'info');
        }
      } else {
        openAdminModal();
      }
    });

    document.getElementById('btnAdminModalClose')?.addEventListener('click', closeAdminModal);
    document.getElementById('btnAdminModalCancel')?.addEventListener('click', closeAdminModal);
    document.getElementById('adminLoginForm')?.addEventListener('submit', handleAdminLoginSubmit);

    // Theme & Color Mode
    document.getElementById('btnToggleTheme')?.addEventListener('click', toggleTheme);
    document.getElementById('btnToggleColorMode')?.addEventListener('click', toggleColorMode);

    // Refresh Quotes
    document.getElementById('btnRefreshQuotes')?.addEventListener('click', () => refreshOnlineQuotes(true));

    // Auto Refresh Select
    document.getElementById('autoRefreshSelect')?.addEventListener('change', (e) => {
      state.autoRefreshSec = parseInt(e.target.value, 10) || 0;
      localStorage.setItem('fubon_auto_refresh', String(state.autoRefreshSec));
      startAutoRefresh();
      showNotification(state.autoRefreshSec > 0 ? `已設定每 ${state.autoRefreshSec} 秒自動更新行情` : '已關閉自動更新', 'info');
    });

    // Editable Title
    document.getElementById('btnEditTitle')?.addEventListener('click', startEditTitle);
    const titleEl = document.getElementById('dashboardTitle');
    titleEl?.addEventListener('dblclick', startEditTitle);
    titleEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finishEditTitle(true); }
      if (e.key === 'Escape') { e.preventDefault(); finishEditTitle(false); }
    });
    titleEl?.addEventListener('blur', () => finishEditTitle(true));

    // CSV Import / Export
    document.getElementById('btnExportCsv')?.addEventListener('click', () => {
      if (checkAdminOrPrompt('匯出 CSV')) exportCsv();
    });
    document.getElementById('btnImportCsvTrigger')?.addEventListener('click', () => {
      if (checkAdminOrPrompt('匯入 CSV')) {
        document.getElementById('csvFileInput')?.click();
      }
    });
    document.getElementById('csvFileInput')?.addEventListener('change', (e) => {
      if (!checkAdminOrPrompt('匯入 CSV')) {
        e.target.value = '';
        return;
      }
      handleCsvFileSelect(e);
    });

    // Cloud Seed / Import data.json
    setupCloudSeedListeners();

    // Manage ACL Viewers
    setupAclListeners();

    // Multi-Tenant Portfolio Switcher
    setupPortfolioSwitcherListeners();

    // Rate & Settings Modal
    document.getElementById('ratePill')?.addEventListener('click', () => {
      if (checkAdminOrPrompt('修改設定')) openRateModal();
    });
    document.getElementById('btnEditRate')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (checkAdminOrPrompt('修改設定')) openRateModal();
    });
    document.getElementById('btnRateModalClose')?.addEventListener('click', closeRateModal);
    document.getElementById('btnRateModalCancel')?.addEventListener('click', closeRateModal);
    document.getElementById('rateForm')?.addEventListener('submit', handleRateFormSubmit);

    // Holdings Category Filter Chips
    document.querySelectorAll('#holdingCategoryFilters .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#holdingCategoryFilters .chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        state.holdingFilterCat = chip.dataset.cat;
        renderHoldingsTable();
      });
    });

    // Hide zero-shares toggle
    const zeroToggle = document.getElementById('toggleHideZeroShares');
    if (zeroToggle) {
      zeroToggle.checked = state.hideZeroShares;
      zeroToggle.addEventListener('change', (e) => {
        state.hideZeroShares = e.target.checked;
        localStorage.setItem('fubon_hide_zero_shares', state.hideZeroShares ? '1' : '0');
        renderHoldingsTable();
      });
    }

    // Show manual hidden toggle
    const hiddenToggle = document.getElementById('toggleShowHidden');
    if (hiddenToggle) {
      hiddenToggle.checked = state.showHidden;
      hiddenToggle.addEventListener('change', (e) => {
        state.showHidden = e.target.checked;
        localStorage.setItem('fubon_show_hidden', state.showHidden ? '1' : '0');
        renderHoldingsTable();
      });
    }

    // Holding Sort Select
    const sortSelect = document.getElementById('holdingSortSelect');
    if (sortSelect) {
      sortSelect.value = state.holdingSort;
      sortSelect.addEventListener('change', (e) => {
        state.holdingSort = e.target.value;
        localStorage.setItem('fubon_holding_sort', state.holdingSort);
        renderHoldingsTable();
      });
    }

    // Holdings Search
    const hSearch = document.getElementById('holdingSearchInput');
    const hClear = document.getElementById('holdingSearchClear');
    if (hSearch) {
      hSearch.addEventListener('input', (e) => {
        state.holdingSearch = e.target.value;
        if (hClear) hClear.style.display = state.holdingSearch ? 'block' : 'none';
        renderHoldingsTable();
      });
    }
    if (hClear) {
      hClear.addEventListener('click', () => {
        hSearch.value = '';
        state.holdingSearch = '';
        hClear.style.display = 'none';
        renderHoldingsTable();
      });
    }

    // Target Asset Modal
    document.getElementById('btnAddAsset')?.addEventListener('click', () => openAssetModal(null));
    document.getElementById('btnAssetModalClose')?.addEventListener('click', closeAssetModal);
    document.getElementById('btnAssetModalCancel')?.addEventListener('click', closeAssetModal);
    document.getElementById('btnAssetDelete')?.addEventListener('click', deleteAsset);
    document.getElementById('assetForm')?.addEventListener('submit', handleAssetFormSubmit);
    document.getElementById('btnAutoGuessTv')?.addEventListener('click', () => {
      const code = document.getElementById('assetSymbol').value;
      const cat = document.getElementById('assetCategory').value;
      const guess = guessTvSymbol(code, cat);
      if (guess) {
        document.getElementById('assetTvSymbol').value = guess;
        showNotification(`已推薦代碼：${guess}`, 'info');
      } else {
        showNotification('基金或特殊標的請手動填寫 TradingView 代碼', 'info');
      }
    });

    // TradingView Modal
    document.getElementById('btnTvModalClose')?.addEventListener('click', closeTvModal);

    // Transactions Filters
    document.getElementById('txFilterSymbol')?.addEventListener('change', (e) => {
      state.txFilterSymbol = e.target.value;
      state.txPage = 1;
      renderTransactionsTable();
    });
    document.getElementById('txFilterAction')?.addEventListener('change', (e) => {
      state.txFilterAction = e.target.value;
      state.txPage = 1;
      renderTransactionsTable();
    });
    document.getElementById('txSearchInput')?.addEventListener('input', (e) => {
      state.txSearch = e.target.value;
      state.txPage = 1;
      renderTransactionsTable();
    });

    // Transactions Pagination
    document.getElementById('btnPagePrev')?.addEventListener('click', () => {
      if (state.txPage > 1) {
        state.txPage--;
        renderTransactionsTable();
      }
    });
    document.getElementById('btnPageNext')?.addEventListener('click', () => {
      state.txPage++;
      renderTransactionsTable();
    });

    // Add Transaction Modal
    document.getElementById('btnOpenAddModal')?.addEventListener('click', () => openAddTxModal());
    document.getElementById('btnTxAdd')?.addEventListener('click', () => openAddTxModal());
    document.getElementById('btnTxModalClose')?.addEventListener('click', closeTxModal);
    document.getElementById('btnTxModalCancel')?.addEventListener('click', closeTxModal);
    document.getElementById('txForm')?.addEventListener('submit', handleTxFormSubmit);

    // Auto-calculate Total in form
    const autoCalc = () => {
      const shares = parseFloat(document.getElementById('txFormShares').value) || 0;
      const price = parseFloat(document.getElementById('txFormPrice').value) || 0;
      if (shares > 0 && price > 0) {
        document.getElementById('txFormTotal').value = Number((shares * price).toFixed(2));
      }
    };
    document.getElementById('txFormShares')?.addEventListener('input', autoCalc);
    document.getElementById('txFormPrice')?.addEventListener('input', autoCalc);
    document.getElementById('btnAutoCalcTotal')?.addEventListener('click', autoCalc);

    document.getElementById('btnApplyCurrentPrice')?.addEventListener('click', () => {
      const sym = document.getElementById('txFormSymbol').value;
      if (sym && state.quotes[sym]) {
        document.getElementById('txFormPrice').value = state.quotes[sym].price;
        autoCalc();
      }
    });

    document.getElementById('txFormSymbol')?.addEventListener('change', (e) => {
      updateFormQuoteHelper(e.target.value);
    });
    document.getElementById('txFormAction')?.addEventListener('change', () => {
      const sym = document.getElementById('txFormSymbol').value;
      if (sym) updateFormQuoteHelper(sym);
    });

    // Fund Reserves Collapsible Toggle & Modal
    document.getElementById('btnToggleFundDetails')?.addEventListener('click', () => {
      const collapse = document.getElementById('fundDetailsCollapse');
      const text = document.getElementById('toggleFundText');
      const arrow = document.getElementById('toggleFundArrow');
      if (!collapse) return;
      const isHidden = collapse.style.display === 'none' || collapse.style.display === '';
      if (isHidden) {
        collapse.style.display = 'block';
        if (text) text.textContent = '收合明細';
        if (arrow) arrow.textContent = '▲';
      } else {
        collapse.style.display = 'none';
        if (text) text.textContent = '展開明細';
        if (arrow) arrow.textContent = '▼';
      }
    });

    document.getElementById('btnEditFundReserves')?.addEventListener('click', openFundModal);
    document.getElementById('btnFundModalClose')?.addEventListener('click', closeFundModal);
    document.getElementById('btnFundModalCancel')?.addEventListener('click', closeFundModal);
    document.getElementById('fundForm')?.addEventListener('submit', handleFundFormSubmit);

    // Dividend Modal
    document.getElementById('btnAddDividend')?.addEventListener('click', openAddDividendModal);
    document.getElementById('btnDividendModalClose')?.addEventListener('click', closeDividendModal);
    document.getElementById('btnDividendModalCancel')?.addEventListener('click', closeDividendModal);
    document.getElementById('dividendForm')?.addEventListener('submit', handleDividendFormSubmit);
    document.getElementById('divFormSymbol')?.addEventListener('change', (e) => {
      const q = state.quotes[e.target.value];
      const h = state.holdings[e.target.value];
      if (q) document.getElementById('divCurrLabel').textContent = q.currency;
      if (h) document.getElementById('divFormShares').value = h.currentShares;
    });

    // Realized Add Button & Modal
    document.getElementById('btnAddRealized')?.addEventListener('click', openAddRealizedModal);
    document.getElementById('btnRealizedModalClose')?.addEventListener('click', closeRealizedModal);
    document.getElementById('btnRealizedModalCancel')?.addEventListener('click', closeRealizedModal);
    document.getElementById('realizedForm')?.addEventListener('submit', handleRealizedFormSubmit);
    document.getElementById('realFormSymbol')?.addEventListener('change', updateRealizedHelper);
    document.getElementById('realFormShares')?.addEventListener('input', autoCalcRealizedPl);
    document.getElementById('realFormSellPrice')?.addEventListener('input', autoCalcRealizedPl);
    document.getElementById('realFormBuyPrice')?.addEventListener('input', autoCalcRealizedPl);

    // Edit Quote Modal
    document.getElementById('btnQuoteModalClose')?.addEventListener('click', closeQuoteModal);
    document.getElementById('btnQuoteModalCancel')?.addEventListener('click', closeQuoteModal);
    document.getElementById('quoteForm')?.addEventListener('submit', handleQuoteFormSubmit);

    // Delete Modal
    document.getElementById('btnDeleteModalClose')?.addEventListener('click', closeDeleteModal);
    document.getElementById('btnDeleteModalCancel')?.addEventListener('click', closeDeleteModal);
    document.getElementById('btnDeleteModalConfirm')?.addEventListener('click', confirmDeleteAction);

    // Backdrop clicks to close modals
    document.querySelectorAll('.modal-backdrop').forEach(bd => {
      bd.addEventListener('click', (e) => {
        if (e.target === bd) {
          if (bd.id === 'tvModalBackdrop') closeTvModal();
          else bd.classList.remove('show');
        }
      });
    });

    // ESC key closes modals
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeTvModal();
        document.querySelectorAll('.modal-backdrop.show').forEach(m => m.classList.remove('show'));
      }
    });
  }

  // 23. Cloud Seed & data.json Import Manager
  let stagedSeedData = null;

  function setupCloudSeedListeners() {
    const btnOpen = document.getElementById('btnCloudSeedData');
    const modal = document.getElementById('cloudSeedModalBackdrop');
    const btnClose = document.getElementById('btnCloudSeedClose');
    const btnCancel = document.getElementById('btnCloudSeedCancel');
    const btnSyncEmbedded = document.getElementById('btnSyncEmbeddedSeed');
    const btnChooseLocal = document.getElementById('btnChooseLocalJson');
    const fileInput = document.getElementById('cloudSeedFileInput');
    const fileNameSpan = document.getElementById('chosenFileName');
    const previewCard = document.getElementById('seedPreviewCard');
    const summaryText = document.getElementById('seedSummaryText');
    const btnConfirmUpload = document.getElementById('btnConfirmUploadJson');

    const openModal = () => {
      if (!checkAdminOrPrompt('同步雲端資料庫')) return;
      if (modal) modal.classList.add('show');
    };

    const closeModal = () => {
      if (modal) modal.classList.remove('show');
      stagedSeedData = null;
      if (fileInput) fileInput.value = '';
      if (fileNameSpan) fileNameSpan.textContent = '尚未選擇檔案';
      if (previewCard) previewCard.style.display = 'none';
      if (btnConfirmUpload) btnConfirmUpload.style.display = 'none';
    };

    btnOpen?.addEventListener('click', openModal);
    btnClose?.addEventListener('click', closeModal);
    btnCancel?.addEventListener('click', closeModal);

    // 手動選取本機 data.json 檔案
    btnChooseLocal?.addEventListener('click', () => {
      if (checkAdminOrPrompt('上傳資料庫')) fileInput?.click();
    });

    fileInput?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (fileNameSpan) fileNameSpan.textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;

      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const parsed = JSON.parse(evt.target.result);
          if (!parsed || typeof parsed !== 'object') {
            throw new Error('檔案格式不正確，非有效 JSON 物件');
          }

          stagedSeedData = parsed;
          const txCount = parsed.transactions?.length || 0;
          const realCount = parsed.realizedRecords?.length || 0;
          const divCount = parsed.dividendRecords?.length || 0;
          const quoteCount = Object.keys(parsed.quotes || {}).length;

          if (summaryText) {
            summaryText.innerHTML = `
              <div>• 買賣交易紀錄：<strong>${txCount}</strong> 筆</div>
              <div>• 已實現損益結算：<strong>${realCount}</strong> 筆</div>
              <div>• 配息收入明細：<strong>${divCount}</strong> 筆</div>
              <div>• 投資自訂標的：<strong>${quoteCount}</strong> 檔</div>
              <div>• 資產儲備池與保單：<strong>${parsed.fundReserves ? '已包含' : '未包含 (保留現有)'}</strong></div>
            `;
          }

          if (previewCard) previewCard.style.display = 'block';
          if (btnConfirmUpload) btnConfirmUpload.style.display = 'inline-block';
        } catch (err) {
          alert('解析 JSON 檔案失敗：' + (err.message || err));
          stagedSeedData = null;
          if (previewCard) previewCard.style.display = 'none';
          if (btnConfirmUpload) btnConfirmUpload.style.display = 'none';
        }
      };
      reader.readAsText(file);
    });

    // 確認上傳手動選取的 JSON
    btnConfirmUpload?.addEventListener('click', async () => {
      if (!stagedSeedData) return;
      if (!checkAdminOrPrompt('同步雲端資料庫')) return;
      if (window.cloudStore?.userRole !== 'owner') {
        alert('您的帳號非擁有者，無權限寫入 Firestore 雲端資料庫！');
        return;
      }

      if (!confirm('確定要將此 JSON 覆蓋同步寫入 Firebase 雲端嗎？')) return;

      try {
        btnConfirmUpload.disabled = true;
        btnConfirmUpload.textContent = '⏳ 上傳中...';
        showNotification('正在寫入 Firebase Firestore...', 'info');

        await window.cloudStore.savePortfolio(stagedSeedData);
        showNotification('🎉 已成功將本機 JSON 資料匯入至 Firebase 雲端！', 'success');
        applyLoadedData(stagedSeedData);
        closeModal();
      } catch (err) {
        console.error('上傳失敗:', err);
        alert('上傳至雲端失敗：' + (err.message || err));
      } finally {
        if (btnConfirmUpload) {
          btnConfirmUpload.disabled = false;
          btnConfirmUpload.textContent = '確認上傳此 JSON 至雲端';
        }
      }
    });
  }

  // 24. ACL Authorized Viewers Management
  function setupAclListeners() {
    const btnOpen = document.getElementById('btnManageAcl');
    const menuBtnAcl = document.getElementById('menuBtnManageAcl');
    const modal = document.getElementById('aclModalBackdrop');
    const btnClose = document.getElementById('btnAclModalClose');
    const btnCancel = document.getElementById('btnAclModalCancel');
    const btnSave = document.getElementById('btnSaveAclChanges');
    const btnAdd = document.getElementById('btnAddViewerEmail');
    const inputEmail = document.getElementById('inputNewViewerEmail');
    const listContainer = document.getElementById('aclViewerListContainer');
    const emptyNotice = document.getElementById('aclEmptyNotice');
    const ownerText = document.getElementById('aclOwnerEmailText');

    let currentViewers = [];

    function renderViewerList() {
      if (!listContainer) return;
      listContainer.innerHTML = '';
      if (currentViewers.length === 0) {
        if (emptyNotice) emptyNotice.style.display = 'block';
        return;
      }
      if (emptyNotice) emptyNotice.style.display = 'none';

      currentViewers.forEach((email, index) => {
        const item = document.createElement('div');
        item.style.cssText = 'display:flex; justify-content:space-between; align-items:center; background:var(--bg-surface-elevated); border:1px solid var(--border-subtle); border-radius:var(--radius-sm); padding:6px 10px; font-size:0.85rem;';
        item.innerHTML = `
          <div style="display:flex; align-items:center; gap:6px;">
            <span>🛡️</span>
            <span style="font-family:var(--font-mono);">${escapeHtml(email)}</span>
          </div>
          <button type="button" class="btn btn-secondary btn-xs text-danger" style="padding:2px 8px;" title="移除此授權 Email" data-idx="${index}">&times; 移除</button>
        `;
        item.querySelector('button')?.addEventListener('click', () => {
          currentViewers.splice(index, 1);
          renderViewerList();
        });
        listContainer.appendChild(item);
      });
    }

    const reqContainer = document.getElementById('aclPendingRequestsContainer');
    const reqCount = document.getElementById('aclPendingCount');
    const noReqNotice = document.getElementById('aclNoPendingNotice');
    const btnRefreshReq = document.getElementById('btnRefreshWhitelistRequests');

    async function loadAndRenderPendingRequests() {
      if (!reqContainer) return;
      reqContainer.innerHTML = '<div style="color:var(--text-tertiary); font-size:0.8rem;">讀取待審核名單中...</div>';
      try {
        const list = await window.cloudStore?.loadWhitelistRequests() || [];
        if (reqCount) reqCount.textContent = list.length;
        if (list.length === 0) {
          reqContainer.innerHTML = '';
          if (noReqNotice) noReqNotice.style.display = 'block';
          return;
        }
        if (noReqNotice) noReqNotice.style.display = 'none';
        reqContainer.innerHTML = '';

        list.forEach(req => {
          const item = document.createElement('div');
          item.style.cssText = 'display:flex; justify-content:space-between; align-items:center; background:var(--bg-surface); border:1px solid rgba(59,130,246,0.25); border-radius:var(--radius-sm); padding:6px 10px; font-size:0.83rem;';
          item.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:2px; overflow:hidden;">
              <div style="display:flex; align-items:center; gap:6px;">
                <span style="font-weight:600; color:var(--text-primary);">${escapeHtml(req.email)}</span>
                ${req.name ? `<span style="color:var(--text-secondary); font-size:0.75rem;">(${escapeHtml(req.name)})</span>` : ''}
              </div>
              <span style="color:var(--text-tertiary); font-size:0.72rem;">申請時間：${escapeHtml(req.requestedAtStr || '剛剛')}</span>
            </div>
            <div style="display:flex; gap:6px; flex-shrink:0;">
              <button type="button" class="btn btn-primary btn-xs btn-approve-req" style="padding:2px 8px;">✅ 批准</button>
              <button type="button" class="btn btn-secondary btn-xs btn-reject-req" style="padding:2px 6px;">✕ 忽略</button>
            </div>
          `;

          // 點擊批准
          item.querySelector('.btn-approve-req')?.addEventListener('click', async () => {
            try {
              item.style.opacity = '0.5';
              const updatedViewers = await window.cloudStore?.approveWhitelistRequest(req.id, req.email);
              currentViewers = updatedViewers || currentViewers;
              renderViewerList();
              await loadAndRenderPendingRequests();
              showNotification(`已批准 ${req.email} 加入授權白名單！`, 'success');
            } catch (e) {
              alert('批准失敗：' + (e.message || e));
            }
          });

          // 點擊忽略
          item.querySelector('.btn-reject-req')?.addEventListener('click', async () => {
            try {
              await window.cloudStore?.rejectWhitelistRequest(req.id);
              await loadAndRenderPendingRequests();
            } catch (e) {
              console.warn(e);
            }
          });

          reqContainer.appendChild(item);
        });
      } catch (err) {
        console.warn('載入待審核白名單注意:', err);
        if (reqContainer) reqContainer.innerHTML = '<div style="color:var(--text-tertiary); font-size:0.8rem;">目前無待審核申請</div>';
      }
    }

    btnRefreshReq?.addEventListener('click', loadAndRenderPendingRequests);

    const openModal = async () => {
      document.getElementById('userDropdownMenu')?.classList.remove('show');
      if (!checkAdminOrPrompt('管理授權名單')) return;
      if (modal) modal.classList.add('show');

      try {
        if (listContainer) listContainer.innerHTML = '<div style="color:var(--text-tertiary); font-size:0.85rem;">正在讀取雲端授權名單...</div>';
        const acl = await window.cloudStore?.loadAcl();
        if (ownerText && acl?.owner) {
          ownerText.textContent = acl.owner;
        }
        currentViewers = [...(acl?.viewers || [])];
        renderViewerList();
        loadAndRenderPendingRequests();
      } catch (err) {
        console.error('讀取授權名單失敗:', err);
        showNotification('讀取授權名單失敗：' + (err.message || err), 'error');
      }
    };

    const closeModal = () => {
      if (modal) modal.classList.remove('show');
      if (inputEmail) inputEmail.value = '';
    };

    btnOpen?.addEventListener('click', openModal);
    menuBtnAcl?.addEventListener('click', openModal);
    btnClose?.addEventListener('click', closeModal);
    btnCancel?.addEventListener('click', closeModal);

    // 新增 Email
    btnAdd?.addEventListener('click', () => {
      const email = (inputEmail?.value || '').trim().toLowerCase();
      if (!email) {
        alert('請輸入 Email！');
        return;
      }
      if (!email.includes('@') || !email.includes('.')) {
        alert('請輸入有效的 Google Email 信箱格式！');
        return;
      }
      if (currentViewers.includes(email)) {
        alert('此 Email 已在授權名單中！');
        return;
      }
      currentViewers.push(email);
      if (inputEmail) inputEmail.value = '';
      renderViewerList();
    });

    inputEmail?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        btnAdd?.click();
      }
    });

    // 儲存名單至雲端
    btnSave?.addEventListener('click', async () => {
      if (!checkAdminOrPrompt('儲存授權名單')) return;
      try {
        btnSave.disabled = true;
        btnSave.textContent = '⏳ 儲存中...';
        await window.cloudStore?.saveAcl(currentViewers);
        showNotification(`🎉 授權親友名單已成功儲存至雲端 (共 ${currentViewers.length} 位)！`, 'success');
        closeModal();
      } catch (err) {
        console.error('儲存授權名單失敗:', err);
        alert('儲存失敗：' + (err.message || err));
      } finally {
        if (btnSave) {
          btnSave.disabled = false;
          btnSave.textContent = '儲存名單至雲端';
        }
      }
    });
  }

  // 25. Multi-Tenant Portfolio Switcher & Creation
  function setupPortfolioSwitcherListeners() {
    const btnSwitch = document.getElementById('btnSwitchPortfolio');
    const menuBtnSwitch = document.getElementById('menuBtnSwitchPortfolio');
    const modal = document.getElementById('switchPortfolioModalBackdrop');
    const btnClose = document.getElementById('btnSwitchPortfolioClose');
    const btnCancel = document.getElementById('btnSwitchPortfolioCancel');
    const form = document.getElementById('switchPortfolioForm');
    const inputId = document.getElementById('inputCustomPortfolioId');
    const quickList = document.getElementById('quickPortfolioList');
    const btnInit = document.getElementById('btnInitNewPortfolio');

    // Header User Avatar Dropdown
    const btnUserMenu = document.getElementById('btnUserMenu');
    const userDropdown = document.getElementById('userDropdownMenu');
    const menuBtnSignOut = document.getElementById('menuBtnSignOut');
    const headerSignIn = document.getElementById('btnHeaderSignIn');

    // 切換選單顯示/關閉
    btnUserMenu?.addEventListener('click', (e) => {
      e.stopPropagation();
      userDropdown?.classList.toggle('show');
      btnUserMenu.classList.toggle('active');
    });

    // 點擊選單外部關閉
    document.addEventListener('click', (e) => {
      if (userDropdown && !userDropdown.contains(e.target) && !btnUserMenu?.contains(e.target)) {
        userDropdown.classList.remove('show');
        btnUserMenu?.classList.remove('active');
      }
    });

    // 登出按鈕
    menuBtnSignOut?.addEventListener('click', async () => {
      userDropdown?.classList.remove('show');
      btnUserMenu?.classList.remove('active');
      if (confirm('確定要登出 Google 帳號嗎？')) {
        await window.cloudStore?.signOut();
        showNotification('已成功登出 Google 帳號', 'info');
      }
    });

    // 前往訪客專屬空間維護
    document.getElementById('menuBtnMyPortfolio')?.addEventListener('click', () => {
      userDropdown?.classList.remove('show');
      btnUserMenu?.classList.remove('active');
      const email = window.cloudStore?.currentUser?.email || '';
      const mySlug = email.split('@')[0].toLowerCase().replace(/[^\w\u4e00-\u9fa5_-]/g, '');
      if (mySlug) {
        window.fubonApp.switchToPortfolio(mySlug);
      }
    });

    // 前往 Daniel 核心儀表板
    document.getElementById('menuBtnDanielPortfolio')?.addEventListener('click', () => {
      userDropdown?.classList.remove('show');
      btnUserMenu?.classList.remove('active');
      window.fubonApp.switchToPortfolio('main');
    });

    // 頂部登入按鈕
    headerSignIn?.addEventListener('click', async () => {
      try {
        await window.cloudStore?.signInWithGoogle();
      } catch (err) {
        console.error("登入錯誤:", err);
      }
    });

    // 頭像選單：輸入密碼解鎖管理員
    const menuBtnAdminPassword = document.getElementById('menuBtnAdminPassword');
    menuBtnAdminPassword?.addEventListener('click', () => {
      userDropdown?.classList.remove('show');
      btnUserMenu?.classList.remove('active');
      if (state.authMode === 'admin') {
        if (confirm('確定切換為訪客檢視模式？')) {
          state.authMode = 'view';
          applyAuthMode();
          updateUi();
          showNotification('已切換為訪客檢視模式', 'info');
        }
      } else {
        openAdminModal();
      }
    });



    const renderQuickList = () => {
      if (!quickList) return;
      const currentPid = window.cloudStore?.currentPortfolioId || 'main';
      const userPortfolios = window.cloudStore?.listUserPortfolios?.() || [
        { id: 'main', name: '👑 Daniel 核心投資儀表板 (預設)' }
      ];

      // 從 localStorage 讀取近期造訪清單
      let recent = [];
      try {
        recent = JSON.parse(localStorage.getItem('fubon_recent_portfolios') || '[]');
      } catch (e) { }

      const combined = [...userPortfolios];
      recent.forEach(rId => {
        if (!combined.some(item => item.id.toLowerCase() === rId.toLowerCase())) {
          combined.push({ id: rId, name: `📌 近期造訪：${rId}` });
        }
      });

      quickList.innerHTML = combined.map(item => {
        const isCurrent = item.id.toLowerCase() === currentPid.toLowerCase();
        return `
          <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-surface); border:1px solid ${isCurrent ? 'var(--primary)' : 'var(--border-subtle)'}; border-radius:var(--radius-sm); padding:6px 10px; font-size:0.85rem;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-weight:600; color:${isCurrent ? 'var(--primary)' : 'var(--text-primary)'};">${escapeHtml(item.name || item.id)}</span>
              <span class="mono" style="color:var(--text-tertiary); font-size:0.75rem;">(?id=${escapeHtml(item.id)})</span>
            </div>
            ${isCurrent ?
            `<span class="tag-badge" style="background:var(--primary-subtle); color:var(--primary);">目前使用中</span>` :
            `<button type="button" class="btn btn-secondary btn-xs" style="padding:2px 8px;" onclick="window.fubonApp.switchToPortfolio('${escapeHtml(item.id)}')">前往切換</button>`
          }
          </div>
        `;
      }).join('');
    };

    const openModal = () => {
      document.getElementById('userDropdownMenu')?.classList.remove('show');
      btnUserMenu?.classList.remove('active');
      renderQuickList();
      if (inputId) {
        inputId.value = window.cloudStore?.currentPortfolioId === 'main' ? '' : (window.cloudStore?.currentPortfolioId || '');
      }
      if (modal) modal.classList.add('show');
    };

    const closeModal = () => {
      if (modal) modal.classList.remove('show');
    };

    btnSwitch?.addEventListener('click', openModal);
    menuBtnSwitch?.addEventListener('click', openModal);
    btnClose?.addEventListener('click', closeModal);
    btnCancel?.addEventListener('click', closeModal);

    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      const targetId = (inputId?.value || '').trim().toLowerCase();
      if (!targetId) return;

      if (!/^[\w\u4e00-\u9fa5_-]{1,30}$/.test(targetId)) {
        alert('投資組合 ID 僅限 1~30 個英文字母、數字、中文、底線或連字號！');
        return;
      }

      window.fubonApp.switchToPortfolio(targetId);
    });

    // 處理全新 Portfolio 的建立按鈕
    btnInit?.addEventListener('click', async () => {
      const pid = window.cloudStore?.currentPortfolioId || 'main';
      if (!window.cloudStore?.currentUser) {
        await window.cloudStore?.signInWithGoogle();
        return;
      }

      if (pid === 'main') {
        showNotification('Daniel 主儀表板請使用「匯入 data.json」進行初始化', 'info');
        return;
      }

      if (!confirm(`確定要建立專屬投資組合【${pid}】嗎？\n\n建立後，您（${window.cloudStore.currentUser.email}）將成為唯一擁有者，只有您可以進行編輯與儲存！`)) {
        return;
      }

      try {
        btnInit.disabled = true;
        btnInit.innerHTML = `<span>⏳ 正在建立中...</span>`;
        showNotification(`正在為您建立【${pid}】專屬資料庫...`, 'info');

        const initialNewPortfolio = {
          version: 1,
          owner: window.cloudStore.currentUser.email,
          dashboardTitle: `${pid.toUpperCase()} 投資儀表板`,
          quotes: JSON.parse(JSON.stringify(SAMPLE_DEMO_HOLDINGS.quotes)),
          transactions: JSON.parse(JSON.stringify(SAMPLE_DEMO_HOLDINGS.transactions)),
          realizedRecords: [],
          dividendRecords: [],
          fundReserves: {
            taiwanInsurance: 0,
            bankSavings: 0,
            foreignReservesUsd: 0,
            note: '可在資產設定中記錄您的個人儲備金'
          },
          usdRate: 32.5,
          baselineRealizedPl: 0
        };

        await window.cloudStore.savePortfolio(initialNewPortfolio);
        showNotification(`🎉 恭喜！專屬儀表板【${pid}】已成功建立！`, 'success');

        const banner = document.getElementById('newPortfolioBanner');
        if (banner) banner.style.display = 'none';

        applyLoadedData(initialNewPortfolio);
        state.authMode = 'admin';
        applyAuthMode();
        updateUi();
      } catch (err) {
        console.error('建立組合失敗:', err);
        alert('建立組合失敗：' + (err.message || err));
      } finally {
        if (btnInit) {
          btnInit.disabled = false;
          btnInit.innerHTML = '<span>🚀 建立專屬投資組合</span>';
        }
      }
    });
  }

  // Expose global methods for inline HTML onclick handlers
  window.fubonApp = {
    openAddTxModalFor: (sym, action) => openAddTxModal(sym, action),
    openEditTxModal: (id) => openEditTxModal(id),
    openDeleteTxModal: (id) => openDeleteTxModal(id),
    openEditQuoteModal: (sym) => openEditQuoteModal(sym),
    openAssetModal: (sym) => openAssetModal(sym),
    openTvModal: (sym) => openTvModal(sym),
    openAddDividendModal: () => openAddDividendModal(),
    editDividendRecord: (id) => openEditDividendModal(id),
    deleteDividendRecord: (id) => deleteDividendRecord(id),
    openAddRealizedModal: () => openAddRealizedModal(),
    editRealizedRecord: (id) => openEditRealizedModal(id),
    deleteRealizedRecord: (id) => deleteRealizedRecord(id),
    switchToPortfolio: (pid) => {
      const clean = (pid || 'main').trim().toLowerCase();
      try {
        let recent = JSON.parse(localStorage.getItem('fubon_recent_portfolios') || '[]');
        recent = recent.filter(r => r.toLowerCase() !== clean);
        recent.unshift(clean);
        if (recent.length > 5) recent = recent.slice(0, 5);
        localStorage.setItem('fubon_recent_portfolios', JSON.stringify(recent));
      } catch (e) { }

      const url = new URL(window.location.href);
      if (clean === 'main') {
        url.searchParams.delete('id');
      } else {
        url.searchParams.set('id', clean);
      }
      window.location.href = url.toString();
    }
  };

  // Start app
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initData);
  } else {
    initData();
  }
})();
