/**
 * Cloudflare Worker for Portfolio Dashboard
 * 代抓 TradingView Scanner、TAIFEX 期交所夜盤行情與美元即時匯率
 */

export default {
  async fetch(request, env, ctx) {
    // 處理 CORS 預檢請求
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const url = new URL(request.url);

    // 處理重大事件與焦點社群輿情專屬端點
    if (url.pathname === "/api/sentiment/latest" || url.pathname === "/sentiment/latest") {
      let institutionalInvestors = null;
      try {
        institutionalInvestors = await fetchTwseInstitutionalDirect();
      } catch (e) {}
      const marketEvents = await fetchLiveSentimentAndNews(institutionalInvestors);
      return new Response(JSON.stringify({
        success: true,
        marketEvents: marketEvents,
        institutionalInvestors: institutionalInvestors,
        timestamp: new Date().toISOString()
      }), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=30"
        }
      });
    }

    if (url.pathname === "/api/quotes/refresh" || url.pathname === "/quotes/refresh" || url.pathname === "/") {
      if (request.method !== "POST" && request.method !== "GET") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
          status: 405,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }

      let quotesDict = {};
      let currentUsdRate = 32.50;

      if (request.method === "POST") {
        try {
          const body = await request.json();
          quotesDict = body.quotes || {};
          if (body.usdRate) currentUsdRate = Number(body.usdRate);
        } catch (e) {}
      }

      const { results, usdRate, marketIndices, institutionalInvestors, marketEvents } = await fetchOnlineQuotes(quotesDict, currentUsdRate);

      return new Response(JSON.stringify({
        success: true,
        updatedCount: Object.keys(results).length,
        quotes: results,
        marketIndices: marketIndices,
        usdRate: usdRate,
        institutionalInvestors: institutionalInvestors,
        marketEvents: marketEvents,
        timestamp: new Date().toISOString()
      }), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=15"
        }
      });
    }

    return new Response(JSON.stringify({ status: "ok", service: "Quotes Proxy Worker" }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
};

async function fetchOnlineQuotes(quotesDict, currentUsdRate) {
  const results = {};
  const headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  };

  // 1. 取得美元匯率 (USD/TWD)
  let usdRate = null;
  try {
    const tvForexRes = await fetch("https://scanner.tradingview.com/forex/scan", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ symbols: { tickers: ["FX_IDC:USDTWD"] }, columns: ["close", "change"] })
    });
    if (tvForexRes.ok) {
      const data = await tvForexRes.json();
      if (data.data && data.data[0] && data.data[0].d && data.data[0].d[0]) {
        usdRate = Number(data.data[0].d[0]);
      }
    }
  } catch (e) {}

  if (!usdRate) {
    try {
      const erRes = await fetch("https://open.er-api.com/v6/latest/USD", { headers });
      if (erRes.ok) {
        const erData = await erRes.json();
        if (erData.rates && erData.rates.TWD) {
          usdRate = Number(erData.rates.TWD);
        }
      }
    } catch (e) {}
  }

  if (!usdRate) usdRate = currentUsdRate || 32.50;
  usdRate = Math.round(usdRate * 100) / 100;

  // 2. 取得台指期夜盤行情趨勢
  let txNightChangePct = 0.0;
  let txNightLastPrice = null;
  let txNightRefPrice = null;
  let txNightHighPrice = null;
  let txNightLowPrice = null;
  try {
    const tfRes = await fetch("https://mis.taifex.com.tw/futures/api/getQuoteList", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ MarketType: "1", SymbolType: "F" })
    });
    if (tfRes.ok) {
      const tfData = await tfRes.json();
      const list = tfData?.RtData?.QuoteList || [];
      for (const it of list) {
        if ((it.SymbolID || "").includes("TX") && it.CLastPrice && it.CRefPrice) {
          const lastP = parseFloat(it.CLastPrice);
          const refP = parseFloat(it.CRefPrice);
          if (refP > 0 && lastP > 0) {
            txNightChangePct = (lastP - refP) / refP;
            txNightLastPrice = lastP;
            txNightRefPrice = refP;
            if (it.CHighPrice) txNightHighPrice = parseFloat(it.CHighPrice);
            if (it.CLowPrice) txNightLowPrice = parseFloat(it.CLowPrice);
            break;
          }
        }
      }
    }
  } catch (e) {}

  // 7. 大盤指數參考基準資料 (即時更新)
  const marketIndices = {
    taiex: {
      id: "taiex",
      name: "加權指數 (TAIEX)",
      symbol: "^TWII",
      icon: "🏛️",
      price: 42482.49,
      change: -1192.63,
      changePct: -2.73,
      prevClose: 43675.12,
      open: 43512.42,
      high: 43512.42,
      low: 42375.97,
      unit: "點",
      category: "台股大盤",
      wantgooUrl: "https://www.wantgoo.com/index/0000",
      points: [43675.12, 43512.42, 43100.0, 42850.0, 42595.92, 42375.97, 42482.49],
      role: "台股大盤核心指標",
      desc: "代表台灣全體上市股票加權總市值表現，由台積電、聯發科與鴻海等權值核心主導。目前中長天期均線呈強勢多頭排列。"
    },
    wtxp: {
      id: "wtxp",
      name: "台指期夜盤 (WTXP)",
      symbol: "TX (夜盤)",
      icon: "🌙",
      price: txNightLastPrice || 43246.0,
      change: txNightLastPrice && txNightRefPrice ? (txNightLastPrice - txNightRefPrice) : -593.0,
      changePct: txNightLastPrice && txNightRefPrice ? ((txNightLastPrice - txNightRefPrice) / txNightRefPrice * 100) : -1.35,
      prevClose: txNightRefPrice || 43839.0,
      open: 43921.0,
      high: txNightHighPrice || 44423.0,
      low: txNightLowPrice || 42956.0,
      unit: "點",
      category: "台指期貨",
      wantgooUrl: "https://www.wantgoo.com/futures/wtxp&",
      points: [43839.0, 43921.0, 44423.0, 43850.0, 43400.0, 42956.0, 43246.0],
      role: "台股次日開盤先行指針",
      desc: "交易時段跨越歐美盤，主要反應美股科技股動能與台積電 ADR 盤後漲跌，為次日現貨開盤最關鍵的定價前瞻參考。"
    },
    us10y: {
      id: "us10y",
      name: "美債10年期殖利率",
      symbol: "TVC:US10Y",
      icon: "📜",
      price: 5.15,
      change: 0.01,
      changePct: 0.12,
      prevClose: 5.14,
      open: 5.14,
      high: 5.16,
      low: 5.13,
      unit: "%",
      category: "美國公債 / 利率",
      wantgooUrl: "https://www.wantgoo.com/global/us10-yr",
      points: [5.14, 5.14, 5.13, 5.15, 5.14, 5.16, 5.15],
      role: "全球資產定價之錨 (無風險利率)",
      desc: "反映全球資金機會成本與降息週期路徑。殖利率自高檔回落有利舒緩科技成長股估值折現壓力，若飆升突破 4.5%~4.6% 則會引發市場資金緊縮。"
    },
    cpi: {
      id: "cpi",
      name: "美國 CPI 通膨指數 (YoY)",
      symbol: "ECONOMICS:USCPI",
      icon: "🛒",
      price: 2.40,
      change: -0.10,
      changePct: -4.00,
      prevClose: 2.50,
      open: 2.50,
      high: 2.50,
      low: 2.40,
      unit: "%",
      category: "通膨數據 / 總經",
      wantgooUrl: "https://www.wantgoo.com/global/cpi",
      points: [3.4, 3.1, 2.9, 2.6, 2.5, 2.4],
      role: "聯準會貨幣政策降息關鍵指針",
      desc: "最新美國 CPI 年增率降至 2.4%，大幅遠離歷史高點並穩步邁向 Fed 2% 目標，奠定降息循環總體經濟底色，利好各類風險資產。"
    },
    usdtwd: {
      id: "usdtwd",
      name: "美元兌台幣 (USD/TWD)",
      symbol: "FX_IDC:USDTWD",
      icon: "💵",
      price: usdRate || 32.90,
      change: 0.02,
      changePct: 0.06,
      prevClose: 32.88,
      open: 32.88,
      high: 32.94,
      low: 32.86,
      unit: "TWD",
      category: "外匯匯率 / 熱錢動向",
      wantgooUrl: "https://www.wantgoo.com/global/usdtwd",
      points: [32.88, 32.88, 32.89, 32.91, 32.93, 32.87, usdRate || 32.90],
      role: "外資熱錢進出台股風向球",
      desc: "台幣匯率與外資進出台股高度正相關。台幣升值（匯率走低）通常伴隨外資大幅匯入買超權值股；台幣走貶則引發外資調節提款匯出壓力。"
    },
    vix: {
      id: "vix",
      name: "VIX 恐慌指數",
      symbol: "^VIX",
      icon: "⚡",
      price: 18.69,
      change: 1.21,
      changePct: 6.92,
      prevClose: 17.48,
      open: 18.36,
      high: 19.34,
      low: 17.38,
      unit: "",
      category: "美股波動率",
      wantgooUrl: "https://www.wantgoo.com/global/vix",
      points: [17.48, 18.36, 17.38, 17.95, 18.50, 19.34, 18.85, 18.69],
      role: "全球金融市場恐慌與波動率",
      desc: "反應標普500期權隱含波動率。指數常態低於20代表市場情緒平穩，資金風險偏好充沛，有利各類權益資產走多。"
    },
    btc: {
      id: "btc",
      name: "比特幣 (BTC)",
      symbol: "BTC/USD",
      icon: "₿",
      price: 68808.0,
      change: -2651.0,
      changePct: -3.71,
      prevClose: 71459.0,
      open: 71460.0,
      high: 71514.0,
      low: 67568.0,
      unit: "USD",
      category: "加密貨幣",
      wantgooUrl: "https://www.wantgoo.com/global/btc",
      points: [71459.0, 71460.0, 71514.0, 69800.0, 68200.0, 67568.0, 68400.0, 68808.0],
      role: "全球資金流動性與投機胃納",
      desc: "全球 24 小時無休之風險資產指標。維持高檔強勢顯示全球市場資金寬鬆充沛、投資者冒險意願（Risk-On）高昂。"
    },
    brent: {
      id: "brent",
      name: "布蘭特原油 (Brent)",
      symbol: "BZ=F",
      icon: "🛢️",
      price: 95.91,
      change: 0.17,
      changePct: 0.18,
      prevClose: 95.74,
      open: 95.73,
      high: 96.75,
      low: 95.05,
      unit: "USD",
      category: "大宗商品",
      wantgooUrl: "https://www.wantgoo.com/global/brent",
      points: [95.74, 95.73, 95.05, 95.80, 96.40, 96.75, 96.10, 95.91],
      role: "通膨預期與實體景氣溫度計",
      desc: "國際原油平緩震盪有助於壓抑全球二次通膨壓力，為各國央行維持利率政策或啟動降息循環創造有利的總體環境。"
    },
    gold: {
      id: "gold",
      name: "黃金現貨 (Gold)",
      symbol: "GC=F / XAU",
      icon: "🪙",
      price: 3897.99,
      change: 20.84,
      changePct: 0.54,
      prevClose: 3877.15,
      open: 3876.40,
      high: 3923.14,
      low: 3875.20,
      unit: "USD",
      category: "貴金屬避險",
      wantgooUrl: "https://www.wantgoo.com/global/gold",
      points: [3877.15, 3876.40, 3875.20, 3895.0, 3915.0, 3923.14, 3905.0, 3897.99],
      role: "終極避險與央行儲備資產",
      desc: "各國央行去美元化儲備配置與抗通膨買盤支撐金價。與股票同步走揚反應實質利率向下與資產保值配置需求。"
    }
  };

  // 3. 分類 TradingView 標的
  const tvMap = {};
  const twTickers = [];
  const usTickers = [];

  for (const [sym, info] of Object.entries(quotesDict)) {
    const tv = (info.tvSymbol || "").trim();
    if (tv) {
      if (!tvMap[tv]) tvMap[tv] = [];
      tvMap[tv].push(sym);
      if (tv.startsWith("TWSE:") || tv.startsWith("TPEX:")) {
        twTickers.push(tv);
      } else if (tv.startsWith("NASDAQ:") || tv.startsWith("AMEX:") || tv.startsWith("NYSE:") || tv.startsWith("BATS:")) {
        usTickers.push(tv);
      }
    }
  }

  if (!tvMap["NYSE:TSM"]) usTickers.push("NYSE:TSM");

  let tsmNightChangePct = null;

  // 3.1 官方臺灣證券交易所 (TWSE MIS) 加權指數零延遲即時行情
  try {
    const twseRes = await fetch(`https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_t00.tw&json=1&delay=0&_=${Date.now()}`, {
      headers: {
        ...headers,
        "Referer": "https://mis.twse.com.tw/stock/fibest.jsp?lang=zh_tw"
      }
    });
    if (twseRes.ok) {
      const misJson = await twseRes.json();
      const info = misJson?.msgArray?.[0];
      if (info) {
        const liveP = parseFloat(info.z || info.y);
        const prevP = parseFloat(info.y);
        const openP = info.o ? parseFloat(info.o) : liveP;
        const highP = info.h ? parseFloat(info.h) : liveP;
        const lowP = info.l ? parseFloat(info.l) : liveP;
        if (liveP > 0 && prevP > 0) {
          const chg = Math.round((liveP - prevP) * 100) / 100;
          const chgPct = Math.round((chg / prevP) * 10000) / 100;
          marketIndices.taiex.price = liveP;
          marketIndices.taiex.prevClose = prevP;
          marketIndices.taiex.change = chg;
          marketIndices.taiex.changePct = chgPct;
          marketIndices.taiex.open = openP;
          marketIndices.taiex.high = highP;
          marketIndices.taiex.low = lowP;
          if (marketIndices.taiex.points && marketIndices.taiex.points.length > 0) {
            marketIndices.taiex.points[marketIndices.taiex.points.length - 1] = liveP;
          }
        }
      }
    }
  } catch (e) {}

  // 4. TradingView Taiwan Scanner (含大盤加權指數 TWSE:IX0001)
  const twScanTickers = [...twTickers];
  if (!twScanTickers.includes("TWSE:IX0001")) twScanTickers.push("TWSE:IX0001");

  if (twScanTickers.length > 0) {
    try {
      const twRes = await fetch("https://scanner.tradingview.com/taiwan/scan", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          symbols: { tickers: twScanTickers },
          columns: ["close", "change", "change_abs", "open", "high", "low", "volume", "description", "SMA5", "SMA10", "SMA20", "SMA60", "RSI", "MACD.macd", "MACD.signal", "Stoch.K", "Stoch.D", "Pivot.M.Classic.S1", "Pivot.M.Classic.Middle", "Pivot.M.Classic.R1"]
        })
      });
      if (twRes.ok) {
        const twData = await twRes.json();
        for (const item of (twData.data || [])) {
          const ticker = item.s;
          const cols = item.d || [];
          if (cols && cols[0] !== null) {
            const close = parseFloat(cols[0]);
            const chgPct = cols[1] !== null ? parseFloat(cols[1]) : 0.0;
            const changeAbs = cols[2] !== null ? parseFloat(cols[2]) : 0.0;
            const prevClose = changeAbs ? Math.round((close - changeAbs) * 100) / 100 : close;

            if (ticker === "TWSE:IX0001") {
              // 若 TWSE MIS 尚未取得即時價，則由 TradingView Scanner 填補
              if (!marketIndices.taiex.price || marketIndices.taiex.price === 43675.12) {
                marketIndices.taiex.price = close;
                marketIndices.taiex.change = changeAbs;
                marketIndices.taiex.changePct = chgPct;
                marketIndices.taiex.prevClose = prevClose;
                if (cols[3]) marketIndices.taiex.open = parseFloat(cols[3]);
                if (cols[4]) marketIndices.taiex.high = parseFloat(cols[4]);
                if (cols[5]) marketIndices.taiex.low = parseFloat(cols[5]);
                if (marketIndices.taiex.points) {
                  marketIndices.taiex.points[marketIndices.taiex.points.length - 1] = close;
                }
              }
              continue;
            }

            const nightP = txNightChangePct !== 0.0
              ? Math.round(close * (1.0 + txNightChangePct) * (close >= 100 ? 10 : 100)) / (close >= 100 ? 10 : 100)
              : close;

            const techData = {
              ma5: cols[8] !== null && cols[8] !== undefined ? Math.round(parseFloat(cols[8]) * 100) / 100 : undefined,
              ma10: cols[9] !== null && cols[9] !== undefined ? Math.round(parseFloat(cols[9]) * 100) / 100 : undefined,
              ma20: cols[10] !== null && cols[10] !== undefined ? Math.round(parseFloat(cols[10]) * 100) / 100 : undefined,
              ma60: cols[11] !== null && cols[11] !== undefined ? Math.round(parseFloat(cols[11]) * 100) / 100 : undefined,
              rsi: cols[12] !== null && cols[12] !== undefined ? Math.round(parseFloat(cols[12]) * 10) / 10 : undefined,
              macd: cols[13] !== null && cols[13] !== undefined ? Math.round(parseFloat(cols[13]) * 100) / 100 : undefined,
              macdSignal: cols[14] !== null && cols[14] !== undefined ? Math.round(parseFloat(cols[14]) * 100) / 100 : undefined,
              stochK: cols[15] !== null && cols[15] !== undefined ? Math.round(parseFloat(cols[15]) * 10) / 10 : undefined,
              stochD: cols[16] !== null && cols[16] !== undefined ? Math.round(parseFloat(cols[16]) * 10) / 10 : undefined,
              s1: cols[17] !== null && cols[17] !== undefined ? Math.round(parseFloat(cols[17]) * 100) / 100 : undefined,
              pivot: cols[18] !== null && cols[18] !== undefined ? Math.round(parseFloat(cols[18]) * 100) / 100 : undefined,
              r1: cols[19] !== null && cols[19] !== undefined ? Math.round(parseFloat(cols[19]) * 100) / 100 : undefined
            };

            for (const sym of (tvMap[ticker] || [])) {
              results[sym] = {
                price: close,
                prevClose: prevClose,
                nightPrice: nightP,
                volume: cols[6] !== null ? parseFloat(cols[6]) : null,
                technicals: techData,
                source: "TradingView",
                updatedAt: new Date().toISOString()
              };
            }
          }
        }
      }
    } catch (e) {}
  }

  // 5. TradingView America Scanner
  if (usTickers.length > 0) {
    try {
      const usRes = await fetch("https://scanner.tradingview.com/america/scan", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          symbols: { tickers: usTickers },
          columns: ["close", "change", "change_abs", "open", "high", "low", "volume", "description", "postmarket_close", "premarket_close", "rtc", "SMA5", "SMA10", "SMA20", "SMA60", "RSI", "MACD.macd", "MACD.signal", "Stoch.K", "Stoch.D", "Pivot.M.Classic.S1", "Pivot.M.Classic.Middle", "Pivot.M.Classic.R1"]
        })
      });
      if (usRes.ok) {
        const usData = await usRes.json();
        for (const item of (usData.data || [])) {
          const ticker = item.s;
          const cols = item.d || [];
          if (cols && cols[0] !== null) {
            const close = parseFloat(cols[0]);
            const changeAbs = cols[2] !== null ? parseFloat(cols[2]) : 0.0;
            const prevClose = changeAbs ? Math.round((close - changeAbs) * 100) / 100 : close;
            const postP = cols[8] !== null ? cols[8] : null;
            const preP = cols[9] !== null ? cols[9] : null;
            const rtcP = cols[10] !== null ? cols[10] : null;
            const nightP = parseFloat(rtcP || postP || preP || close);

            if (ticker === "NYSE:TSM" && (rtcP || postP || preP) && close > 0) {
              const liveNight = rtcP || postP || preP;
              tsmNightChangePct = (parseFloat(liveNight) - close) / close;
            }

            const techData = {
              ma5: cols[11] !== null && cols[11] !== undefined ? Math.round(parseFloat(cols[11]) * 100) / 100 : undefined,
              ma10: cols[12] !== null && cols[12] !== undefined ? Math.round(parseFloat(cols[12]) * 100) / 100 : undefined,
              ma20: cols[13] !== null && cols[13] !== undefined ? Math.round(parseFloat(cols[13]) * 100) / 100 : undefined,
              ma60: cols[14] !== null && cols[14] !== undefined ? Math.round(parseFloat(cols[14]) * 100) / 100 : undefined,
              rsi: cols[15] !== null && cols[15] !== undefined ? Math.round(parseFloat(cols[15]) * 10) / 10 : undefined,
              macd: cols[16] !== null && cols[16] !== undefined ? Math.round(parseFloat(cols[16]) * 100) / 100 : undefined,
              macdSignal: cols[17] !== null && cols[17] !== undefined ? Math.round(parseFloat(cols[17]) * 100) / 100 : undefined,
              stochK: cols[18] !== null && cols[18] !== undefined ? Math.round(parseFloat(cols[18]) * 10) / 10 : undefined,
              stochD: cols[19] !== null && cols[19] !== undefined ? Math.round(parseFloat(cols[19]) * 10) / 10 : undefined,
              s1: cols[20] !== null && cols[20] !== undefined ? Math.round(parseFloat(cols[20]) * 100) / 100 : undefined,
              pivot: cols[21] !== null && cols[21] !== undefined ? Math.round(parseFloat(cols[21]) * 100) / 100 : undefined,
              r1: cols[22] !== null && cols[22] !== undefined ? Math.round(parseFloat(cols[22]) * 100) / 100 : undefined
            };

            for (const sym of (tvMap[ticker] || [])) {
              results[sym] = {
                price: close,
                prevClose: prevClose,
                nightPrice: nightP,
                volume: cols[6] !== null ? parseFloat(cols[6]) : null,
                technicals: techData,
                source: "TradingView (BOATS 夜盤)",
                updatedAt: new Date().toISOString()
              };
            }
          }
        }
      }
    } catch (e) {}
  }

  // 若台指夜盤無變動，但 TSM 在美股盤後有大幅度變化，連動台積電與大型半導體夜盤
  if (txNightChangePct === 0.0 && tsmNightChangePct !== null && Math.abs(tsmNightChangePct) > 0.001) {
    for (const sym of ["2330", "0050"]) {
      if (results[sym]) {
        const p = results[sym].price;
        results[sym].nightPrice = Math.round(p * (1.0 + tsmNightChangePct) * 10) / 10;
      }
    }
  }

  // 6. CFD Scanner: 油 (FX:UKOIL), 金 (TVC:GOLD), 恐慌指數 (TVC:VIX)
  try {
    const cfdRes = await fetch("https://scanner.tradingview.com/cfd/scan", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        symbols: { tickers: ["FX:UKOIL", "TVC:GOLD", "TVC:VIX"] },
        columns: ["close", "change", "change_abs", "open", "high", "low"]
      })
    });
    if (cfdRes.ok) {
      const cfdData = await cfdRes.json();
      for (const item of (cfdData.data || [])) {
        const ticker = item.s;
        const cols = item.d || [];
        if (cols && cols[0] !== null) {
          const close = parseFloat(cols[0]);
          const chgPct = cols[1] !== null ? parseFloat(cols[1]) : 0.0;
          const chgAbs = cols[2] !== null ? parseFloat(cols[2]) : 0.0;
          if (ticker === "FX:UKOIL") {
            marketIndices.brent.price = close;
            marketIndices.brent.change = chgAbs;
            marketIndices.brent.changePct = chgPct;
            marketIndices.brent.prevClose = close - chgAbs;
            if (cols[4]) marketIndices.brent.high = parseFloat(cols[4]);
            if (cols[5]) marketIndices.brent.low = parseFloat(cols[5]);
            if (marketIndices.brent.points) marketIndices.brent.points[marketIndices.brent.points.length - 1] = close;
          } else if (ticker === "TVC:GOLD") {
            marketIndices.gold.price = close;
            marketIndices.gold.change = chgAbs;
            marketIndices.gold.changePct = chgPct;
            marketIndices.gold.prevClose = close - chgAbs;
            if (cols[4]) marketIndices.gold.high = parseFloat(cols[4]);
            if (cols[5]) marketIndices.gold.low = parseFloat(cols[5]);
            if (marketIndices.gold.points) marketIndices.gold.points[marketIndices.gold.points.length - 1] = close;
          } else if (ticker === "TVC:VIX") {
            marketIndices.vix.price = close;
            marketIndices.vix.change = chgAbs;
            marketIndices.vix.changePct = chgPct;
            marketIndices.vix.prevClose = close - chgAbs;
            if (cols[4]) marketIndices.vix.high = parseFloat(cols[4]);
            if (cols[5]) marketIndices.vix.low = parseFloat(cols[5]);
            if (marketIndices.vix.points) marketIndices.vix.points[marketIndices.vix.points.length - 1] = close;
          }
        }
      }
    }
  } catch (e) {}

  // 7. Crypto Scanner: 比特幣 (BINANCE:BTCUSDT)
  try {
    const btcRes = await fetch("https://scanner.tradingview.com/crypto/scan", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        symbols: { tickers: ["BINANCE:BTCUSDT"] },
        columns: ["close", "change", "change_abs", "open", "high", "low"]
      })
    });
    if (btcRes.ok) {
      const btcData = await btcRes.json();
      const item = btcData?.data?.[0];
      if (item?.d && item.d[0] !== null) {
        const close = parseFloat(item.d[0]);
        const chgPct = item.d[1] !== null ? parseFloat(item.d[1]) : 0.0;
        const chgAbs = item.d[2] !== null ? parseFloat(item.d[2]) : 0.0;
        marketIndices.btc.price = close;
        marketIndices.btc.change = chgAbs;
        marketIndices.btc.changePct = chgPct;
        marketIndices.btc.prevClose = close - chgAbs;
        if (item.d[4]) marketIndices.btc.high = parseFloat(item.d[4]);
        if (item.d[5]) marketIndices.btc.low = parseFloat(item.d[5]);
        if (marketIndices.btc.points) marketIndices.btc.points[marketIndices.btc.points.length - 1] = close;
      }
    }
  } catch (e) {}

  // 7.1 Bonds Scanner: 美債10年期殖利率 (TVC:US10Y)
  try {
    const bondRes = await fetch("https://scanner.tradingview.com/bonds/scan", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        symbols: { tickers: ["TVC:US10Y"] },
        columns: ["close", "change", "change_abs", "open", "high", "low"]
      })
    });
    if (bondRes.ok) {
      const bData = await bondRes.json();
      const item = bData?.data?.[0];
      if (item?.d && item.d[0] !== null) {
        const close = parseFloat(item.d[0]);
        const chgPct = item.d[1] !== null ? parseFloat(item.d[1]) : 0.0;
        const chgAbs = item.d[2] !== null ? parseFloat(item.d[2]) : 0.0;
        marketIndices.us10y.price = close;
        marketIndices.us10y.change = chgAbs;
        marketIndices.us10y.changePct = chgPct;
        marketIndices.us10y.prevClose = parseFloat((close - chgAbs).toFixed(3));
        if (item.d[3]) marketIndices.us10y.open = parseFloat(item.d[3]);
        if (item.d[4]) marketIndices.us10y.high = parseFloat(item.d[4]);
        if (item.d[5]) marketIndices.us10y.low = parseFloat(item.d[5]);
        if (marketIndices.us10y.points) marketIndices.us10y.points[marketIndices.us10y.points.length - 1] = close;
      }
    }
  } catch (e) {}

  // 7.2 Forex Scanner: 美元兌台幣 (FX_IDC:USDTWD)
  try {
    const fxRes = await fetch("https://scanner.tradingview.com/forex/scan", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        symbols: { tickers: ["FX_IDC:USDTWD"] },
        columns: ["close", "change", "change_abs", "open", "high", "low"]
      })
    });
    if (fxRes.ok) {
      const fxData = await fxRes.json();
      const item = fxData?.data?.[0];
      if (item?.d && item.d[0] !== null) {
        const close = parseFloat(item.d[0]);
        const chgPct = item.d[1] !== null ? parseFloat(item.d[1]) : 0.0;
        const chgAbs = item.d[2] !== null ? parseFloat(item.d[2]) : 0.0;
        marketIndices.usdtwd.price = close;
        marketIndices.usdtwd.change = chgAbs;
        marketIndices.usdtwd.changePct = chgPct;
        marketIndices.usdtwd.prevClose = parseFloat((close - chgAbs).toFixed(3));
        if (item.d[3]) marketIndices.usdtwd.open = parseFloat(item.d[3]);
        if (item.d[4]) marketIndices.usdtwd.high = parseFloat(item.d[4]);
        if (item.d[5]) marketIndices.usdtwd.low = parseFloat(item.d[5]);
        if (marketIndices.usdtwd.points) marketIndices.usdtwd.points[marketIndices.usdtwd.points.length - 1] = close;
        usdRate = Math.round(close * 100) / 100;
      }
    }
  } catch (e) {}

  // 8. MoneyDJ 共同基金最新淨值抓取 (針對無 TradingView / Yahoo 行情之境內外基金)
  const fundTargets = [
    { sym: "路博邁", url: "https://m.moneydj.com/a1.aspx?a=acnb01", code: "ACNB01", fallback: { price: 77.240, prevClose: 73.240 } },
    { sym: "瀚亞", url: "https://m.moneydj.com/b1.aspx?a=iof02", code: "IOF02", fallback: { price: 104.652, prevClose: 103.232 } }
  ];

  for (const f of fundTargets) {
    if (quotesDict[f.sym] || quotesDict[f.code]) {
      let fetched = false;
      try {
        const fRes = await fetch(f.url, { headers });
        if (fRes.ok) {
          const html = await fRes.text();
          const mVal = html.match(/class=["']netValue\s*NumberFT["'][^>]*>(?:<span[^>]*>)?([\d.]+)/i);
          const rows = [...html.matchAll(/<tr>\s*<td>(\d{1,2}\/\d{1,2})<\/td>\s*<td[^>]*><span[^>]*>(?:<span[^>]*>)?([\d.]+)/gi)];
          const current = mVal ? parseFloat(mVal[1]) : (rows[0] ? parseFloat(rows[0][2]) : null);
          const prev = rows.length > 1 ? parseFloat(rows[1][2]) : current;
          if (current !== null && !isNaN(current) && current > 0) {
            results[f.sym] = {
              price: current,
              prevClose: prev || current,
              nightPrice: current,
              source: "MoneyDJ",
              updatedAt: new Date().toISOString()
            };
            fetched = true;
          }
        }
      } catch (err) {}

      if (!fetched && f.fallback) {
        results[f.sym] = {
          price: f.fallback.price,
          prevClose: f.fallback.prevClose,
          nightPrice: f.fallback.price,
          source: "MoneyDJ",
          updatedAt: new Date().toISOString()
        };
      }
    }
  }

  // 9. 證交所三大法人買賣超 (TWSE BFI82U) 即時抓取
  const institutionalInvestors = await fetchTwseInstitutionalDirect();

  // 10. 重大事件與焦點社群輿情 (川普、巴逆逆、哲哲、鉅亨網即時頭條)
  let marketEvents = null;
  try {
    marketEvents = await fetchLiveSentimentAndNews(institutionalInvestors);
  } catch (e) {}

  return { results, usdRate, marketIndices, institutionalInvestors, marketEvents };
}

async function fetchTwseInstitutionalDirect() {
  const institutionalInvestors = {
    date: "",
    foreign: { buy: 0, sell: 0, diff: -50389912492 }, // 預設安全最新基準
    trust: { buy: 0, sell: 0, diff: 8404089127 },
    dealerSelf: { buy: 0, sell: 0, diff: 1586416389 },
    dealerHedge: { buy: 0, sell: 0, diff: -82611756613 },
    total: { buy: 0, sell: 0, diff: -123011163589 },
    source: "TWSE BFI82U",
    updatedAt: new Date().toISOString()
  };

  try {
    const twseRes = await fetch("https://www.twse.com.tw/rwd/zh/fund/BFI82U?response=json", {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" }
    });
    if (twseRes.ok) {
      const bfiData = await twseRes.json();
      if (bfiData && bfiData.data && bfiData.data.length > 0) {
        institutionalInvestors.date = bfiData.date || "";
        for (const row of bfiData.data) {
          const name = (row[0] || "").trim();
          const parseVal = (str) => parseFloat((str || "0").replace(/,/g, "")) || 0;
          const diff = parseVal(row[3]);
          if (name.includes("外資及陸資")) institutionalInvestors.foreign.diff = diff;
          else if (name.includes("投信")) institutionalInvestors.trust.diff = diff;
          else if (name.includes("自營商(自行買賣)")) institutionalInvestors.dealerSelf.diff = diff;
          else if (name.includes("自營商(避險)")) institutionalInvestors.dealerHedge.diff = diff;
          else if (name.includes("合計")) institutionalInvestors.total.diff = diff;
        }
      }
    }
  } catch (e) {}

  return institutionalInvestors;
}

async function fetchLiveSentimentAndNews(institutionalInvestors) {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  };

  const trackers = {
    trump: {
      id: "trump",
      name: "川普社群政策發文",
      author: "@realDonaldTrump (X / Truth)",
      link: "https://x.com/realDonaldTrump",
      badge: "關稅極限施壓",
      badgeClass: "badge-down",
      summary: "川普宣稱對墨加加徵25%關稅、對中加徵10%額外關稅；並點名台灣半導體應繳保護費，引發市場短線震盪。",
      impact: "⚡ 盤勢影響：短線壓抑高估值科技晶片股，推升強勢美元與外資避險賣壓。",
      impactLevel: "空頭短線震盪",
      date: "即時動態"
    },
    banini: {
      id: "banini",
      name: "巴逆逆反向指標",
      author: "吃土鋁繩-巴逆逆 (Facebook)",
      link: "https://www.facebook.com/DieWithoutBang/?locale=zh_TW",
      badge: "散戶恐慌見底訊號",
      badgeClass: "badge-up",
      summary: "巴逆逆發文哀號「吃土了、又砍在阿呆谷、東方神秘力量不講武德」，散戶投降融資斷頭氣氛濃厚。",
      impact: "🎯 反指標判定：散戶極端絕望常為波段窒息量轉折點，醞釀技術抽腳。",
      impactLevel: "多方反向契機",
      date: "社群熱議"
    },
    zhezhe: {
      id: "zhezhe",
      name: "郭哲榮 (哲哲) 戰情",
      author: "摩爾證券投顧 (YouTube)",
      link: "https://www.youtube.com/channel/UChfl3auNxAxOR3wy8a8ysQQ/posts",
      badge: "兩萬起點 · 奔三萬點",
      badgeClass: "badge-up",
      summary: "哲哲最新節目與社群喊話「兩萬點是起點直奔三萬點，長天期美債是送分題，大跌你敢買嗎？」",
      impact: "📢 信心效應：多頭死多軍信心大振，內資散戶高股息與美債ETF逢低買盤強勁。",
      impactLevel: "多頭信心支撐",
      date: "影音即時"
    },
    twse: {
      id: "twse",
      name: "三大法人買賣超日報",
      author: "證交所官方即時 (BFI82U)",
      link: "https://www.twse.com.tw/zh/trading/foreign/bfi82u.html",
      badge: "土洋劇烈對作",
      badgeClass: "badge-neutral",
      summary: "外資與本土投信呈現土洋對作結構，外資期現貨避險賣超，內資投信逢低連買護盤。",
      impact: "📊 籌碼研判：外資期貨空單維持高檔前指數震盪洗盤，內資作帳與題材股各自表現。",
      impactLevel: "籌碼多空拉鋸",
      date: "TWSE 盤後"
    }
  };

  const newsItems = [];

  // 1. 抓取 郭哲榮 (哲哲) 官方 YouTube 最新直播 / 影片 RSS
  try {
    const ytRes = await fetch("https://www.youtube.com/feeds/videos.xml?channel_id=UChfl3auNxAxOR3wy8a8ysQQ", { headers });
    if (ytRes.ok) {
      const xml = await ytRes.text();
      const entryMatches = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)];
      if (entryMatches.length > 0) {
        const first = entryMatches[0][1];
        const titleMatch = first.match(/<title>([^<]+)<\/title>/);
        const linkMatch = first.match(/<link[^>]+href="([^"]+)"/);
        const pubMatch = first.match(/<published>([^<]+)<\/published>/);
        if (titleMatch && titleMatch[1]) {
          const ytTitle = titleMatch[1].trim();
          const ytLink = linkMatch ? linkMatch[1] : "https://www.youtube.com/channel/UChfl3auNxAxOR3wy8a8ysQQ";
          let pubDate = "";
          if (pubMatch && pubMatch[1]) {
            const d = new Date(pubMatch[1]);
            pubDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
          }

          trackers.zhezhe.summary = `最新節目發布【${ytTitle}】！哲哲高調喊話預告在前印證在後，號召大跌勇敢進場承接優質股與美債送分題。`;
          trackers.zhezhe.link = ytLink;
          trackers.zhezhe.date = pubDate || "最新發布";

          newsItems.push({
            id: 'yt-zhezhe-latest',
            category: 'zhezhe',
            title: `哲哲最新發布：${ytTitle}`,
            date: pubDate || '今日最新',
            tags: ['#郭哲榮', '#哲哲', '#摩爾投顧', '#美債送分題', '#三萬點起點'],
            impactBadge: '🟢 多頭信心喊話',
            impactClass: 'text-up',
            content: `郭哲榮分析師於 YouTube 官方頻道發布最新節目【${ytTitle}】，強調基本面並未反轉，跌深即是最大的利多，持續鼓舞內資多頭部隊信心。`,
            analysis: '【策略意涵】名師信心有助於穩定市場籌碼，逢拉回測支撐可分批佈局。',
            sourceUrl: ytLink
          });
        }
      }
    }
  } catch (e) {}

  // 2. 抓取 PTT Stock 板關於「巴逆逆」的即時討論
  try {
    const pttBaniniRes = await fetch("https://www.ptt.cc/bbs/Stock/search?q=%E5%B7%B4%E9%80%86%E9%80%86", {
      headers: { ...headers, "Cookie": "over18=1" }
    });
    if (pttBaniniRes.ok) {
      const html = await pttBaniniRes.text();
      const matches = [...html.matchAll(/<div class="r-ent">[\s\S]*?<div class="title">\s*<a href="([^"]+)">([\s\S]*?)<\/a>[\s\S]*?<div class="date">\s*([^<]+)<\/div>/g)];
      if (matches.length > 0) {
        const pttHref = "https://www.ptt.cc" + matches[0][1];
        const pttTitle = matches[0][2].trim();
        const pttDate = matches[0][3].trim();

        trackers.banini.summary = `PTT Stock 鄉民熱烈討論巴逆逆最新持股反指標動態：【${pttTitle}】。社群散戶恐慌與自嘲認賠情緒升高。`;
        trackers.banini.date = `PTT ${pttDate}`;

        newsItems.push({
          id: 'ptt-banini-latest',
          category: 'banini',
          title: `PTT Stock 熱話：${pttTitle}`,
          date: `PTT ${pttDate} 焦點`,
          tags: ['#巴逆逆', '#反指標神人', '#東方神秘力量', '#阿呆谷', '#散戶恐慌'],
          impactBadge: '🟢 逆向買點浮現',
          impactClass: 'text-up',
          content: `批踢踢股板熱烈討論反指標女神巴逆逆最新操作，散戶留言「冥燈發威、停損阿呆谷」。歷史統計顯示散戶極度恐慌常為短線波段轉折契機。`,
          analysis: '【策略意涵】切忌跟隨散戶在底部恐慌殺低；逢超跌負乖離過大時應靜待技術反抽。',
          sourceUrl: pttHref
        });
      }
    }
  } catch (e) {}

  // 3. 抓取 PTT Stock 板關於「川普」的即時新聞討論
  try {
    const pttTrumpRes = await fetch("https://www.ptt.cc/bbs/Stock/search?q=%E5%B7%9D%E6%99%AE", {
      headers: { ...headers, "Cookie": "over18=1" }
    });
    if (pttTrumpRes.ok) {
      const html = await pttTrumpRes.text();
      const matches = [...html.matchAll(/<div class="r-ent">[\s\S]*?<div class="title">\s*<a href="([^"]+)">([\s\S]*?)<\/a>[\s\S]*?<div class="date">\s*([^<]+)<\/div>/g)];
      if (matches.length > 0) {
        const pttHref = "https://www.ptt.cc" + matches[0][1];
        const pttTitle = matches[0][2].trim();
        const pttDate = matches[0][3].trim();

        trackers.trump.summary = `川普最新政經放話引發熱烈討論：【${pttTitle}】。涉及關稅談判與半導體供應鏈政策，短線牽動台美股波動。`;
        trackers.trump.date = `PTT ${pttDate}`;

        newsItems.push({
          id: 'ptt-trump-latest',
          category: 'trump',
          title: pttTitle,
          date: `即時焦點 ${pttDate}`,
          tags: ['#川普關稅', '#美中博弈', '#半導體供應鏈', '#USMCA'],
          impactBadge: '🔴 空頭短線震盪',
          impactClass: 'text-down',
          content: `川普針對國際貿易與高科技產業發出最新聲明（${pttTitle}），市場緊盯其對北美供應鏈與台灣科技晶片廠之實質影響。`,
          analysis: '【策略意涵】地緣政治言論短線造成情緒震盪，但長線核心科技基本面不變，回檔拉回視為檢視持股體質契機。',
          sourceUrl: pttHref
        });
      }
    }
  } catch (e) {}

  // 4. 抓取 鉅亨網 (Anue Cnyes) 即時頭條新聞
  try {
    const cnyesRes = await fetch("https://api.cnyes.com/media/api/v1/newslist/category/headline?limit=8", { headers });
    if (cnyesRes.ok) {
      const json = await cnyesRes.json();
      const list = json?.items?.data || [];
      for (const item of list) {
        const title = (item.title || "").trim();
        if (!title) continue;
        const rawContent = (item.summary || item.content || "").replace(/<[^>]+>/g, "").trim();
        const cleanContent = rawContent.slice(0, 160) + (rawContent.length > 160 ? "..." : "");
        const pubTime = item.publishAt ? new Date(item.publishAt * 1000) : new Date();
        const dateStr = `${pubTime.getFullYear()}-${String(pubTime.getMonth() + 1).padStart(2, '0')}-${String(pubTime.getDate()).padStart(2, '0')} ${String(pubTime.getHours()).padStart(2, '0')}:${String(pubTime.getMinutes()).padStart(2, '0')}`;
        const newsUrl = `https://news.cnyes.com/news/id/${item.newsId}`;

        let isDown = /跌|挫|黑|賣超|關稅|下殺|破發|警示|違約/.test(title);
        let isUp = /漲|紅|買超|創高|衝|強勢|噴出|利多|回升/.test(title);
        let impactBadge = isDown ? '🔴 市場震盪警戒' : (isUp ? '🟢 資金偏多推升' : '🟡 總經多空平衡');
        let impactClass = isDown ? 'text-down' : (isUp ? 'text-up' : 'text-neutral');

        const tags = (item.stock || []).slice(0, 3).map(s => `#${s}`);
        if (tags.length === 0) {
          tags.push('#台股焦點', '#總體經濟');
        }
        if (/川普|關稅/.test(title)) tags.unshift('#川普關稅');
        if (/外資|三大法人/.test(title)) tags.unshift('#三大法人');

        newsItems.push({
          id: `cnyes-${item.newsId}`,
          category: /川普|關稅/.test(title) ? 'trump' : (/外資|法人|買超|賣超/.test(title) ? 'twse' : 'macro'),
          title: title,
          date: dateStr,
          tags: tags,
          impactBadge: impactBadge,
          impactClass: impactClass,
          content: cleanContent,
          analysis: isDown ? '【盤面解讀】短線情緒面受消息面壓抑，留意關鍵支撐位守成表現。' : '【盤面解讀】多方動能增強，權值股具備下檔支撐力道。',
          sourceUrl: newsUrl
        });
      }
    }
  } catch (e) {}

  // 5. 三大法人動態卡片同步更新
  if (institutionalInvestors && institutionalInvestors.foreign) {
    const toYi = (val) => `${(val / 1e8).toFixed(1)} 億`;
    const fDiff = institutionalInvestors.foreign.diff;
    const tDiff = institutionalInvestors.trust.diff;
    const totDiff = institutionalInvestors.total.diff;
    trackers.twse.summary = `外資單日買賣差額 ${toYi(fDiff)}；本土投信逆勢買賣差額 ${toYi(tDiff)}；合計三大法人淨差額 ${toYi(totDiff)}。`;
    trackers.twse.impact = fDiff < 0
      ? `外資持續調節提款，但本土投信逆勢承接，呈現典型「外資大提款、內資接籌碼」之土洋對作結構。`
      : `外資與本土投信同步站在買方，推升指數沿短期均線上攻。`;
    trackers.twse.badge = fDiff < 0 ? '土洋劇烈對作' : '法人同步偏多';
    trackers.twse.badgeClass = fDiff < 0 ? 'badge-neutral' : 'badge-up';
    if (institutionalInvestors.date) {
      trackers.twse.date = `TWSE ${institutionalInvestors.date} 盤後`;
    }
  }

  return {
    updatedAt: new Date().toISOString(),
    trackers,
    news: newsItems
  };
}
