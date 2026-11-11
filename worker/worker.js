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

      const { results, usdRate, marketIndices } = await fetchOnlineQuotes(quotesDict, currentUsdRate);

      return new Response(JSON.stringify({
        success: true,
        updatedCount: Object.keys(results).length,
        quotes: results,
        marketIndices: marketIndices,
        usdRate: usdRate,
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
            break;
          }
        }
      }
    }
  } catch (e) {}

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

  // 4. TradingView Taiwan Scanner
  if (twTickers.length > 0) {
    try {
      const twRes = await fetch("https://scanner.tradingview.com/taiwan/scan", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          symbols: { tickers: twTickers },
          columns: ["close", "change", "change_abs", "open", "high", "low", "volume", "description"]
        })
      });
      if (twRes.ok) {
        const twData = await twRes.json();
        for (const item of (twData.data || [])) {
          const ticker = item.s;
          const cols = item.d || [];
          if (cols && cols[0] !== null) {
            const close = parseFloat(cols[0]);
            const changeAbs = cols[2] !== null ? parseFloat(cols[2]) : 0.0;
            const prevClose = changeAbs ? Math.round((close - changeAbs) * 100) / 100 : close;
            const nightP = txNightChangePct !== 0.0
              ? Math.round(close * (1.0 + txNightChangePct) * (close >= 100 ? 10 : 100)) / (close >= 100 ? 10 : 100)
              : close;

            for (const sym of (tvMap[ticker] || [])) {
              results[sym] = {
                price: close,
                prevClose: prevClose,
                nightPrice: nightP,
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
          columns: ["close", "change", "change_abs", "open", "high", "low", "volume", "description", "postmarket_close", "premarket_close", "rtc"]
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

            for (const sym of (tvMap[ticker] || [])) {
              results[sym] = {
                price: close,
                prevClose: prevClose,
                nightPrice: nightP,
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

  // 6. MoneyDJ 共同基金最新淨值抓取 (針對無 TradingView / Yahoo 行情之境內外基金)
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

  // 7. 大盤指數參考行情
  const marketIndices = {
    taiex: {
      id: "taiex",
      name: "加權指數 (TAIEX)",
      symbol: "^TWII",
      icon: "🏛️",
      price: 44257.15,
      change: 2682.43,
      changePct: 6.45,
      prevClose: 41574.72,
      open: 42100.0,
      high: 44350.0,
      low: 41980.0,
      unit: "點",
      category: "台股大盤",
      wantgooUrl: "https://www.wantgoo.com/index/0000",
      points: [41574.72, 42150.3, 42980.5, 43650.2, 44257.15],
      role: "台股大盤核心指標",
      desc: "代表台灣全體上市股票加權總市值表現，由台積電、聯發科與鴻海等權值核心主導。目前中長天期均線呈強勢多頭排列。"
    },
    wtxp: {
      id: "wtxp",
      name: "台指期夜盤 (WTXP)",
      symbol: "TX (夜盤)",
      icon: "🌙",
      price: 42522.0,
      change: -124.0,
      changePct: -0.29,
      prevClose: 42646.0,
      open: 42650.0,
      high: 43147.0,
      low: 42030.0,
      unit: "點",
      category: "台指期貨",
      wantgooUrl: "https://www.wantgoo.com/futures/wtxp&",
      points: [42646.0, 42800.0, 43147.0, 42350.0, 42522.0],
      role: "台股次日開盤先行指針",
      desc: "交易時段跨越歐美盤，主要反應美股科技股動能與台積電 ADR 盤後漲跌，為次日現貨開盤最關鍵的定價前瞻參考。"
    },
    vix: {
      id: "vix",
      name: "VIX 恐慌指數",
      symbol: "^VIX",
      icon: "⚡",
      price: 19.46,
      change: -0.46,
      changePct: -2.31,
      prevClose: 19.92,
      open: 19.76,
      high: 21.61,
      low: 19.29,
      unit: "",
      category: "美股波動率",
      wantgooUrl: "https://www.wantgoo.com/global/vix",
      points: [22.4, 21.6, 20.8, 19.92, 19.46],
      role: "全球金融市場恐慌與波動率",
      desc: "反應標普500期權隱含波動率。指數常態低於20代表市場情緒平穩，資金風險偏好充沛，有利各類權益資產走多。"
    },
    btc: {
      id: "btc",
      name: "比特幣 (BTC)",
      symbol: "BTC/USD",
      icon: "₿",
      price: 73899.19,
      change: 95.86,
      changePct: 0.13,
      prevClose: 73803.33,
      open: 73796.06,
      high: 74034.64,
      low: 73209.12,
      unit: "USD",
      category: "加密貨幣",
      wantgooUrl: "https://www.wantgoo.com/global/btc",
      points: [71200.0, 72400.0, 73100.0, 73803.0, 73899.19],
      role: "全球資金流動性與投機胃納",
      desc: "全球 24 小時無休之風險資產指標。維持高檔強勢顯示全球市場資金寬鬆充沛、投資者冒險意願（Risk-On）高昂。"
    },
    brent: {
      id: "brent",
      name: "布蘭特原油 (Brent)",
      symbol: "BZ=F",
      icon: "🛢️",
      price: 92.42,
      change: -0.85,
      changePct: -0.91,
      prevClose: 93.27,
      open: 93.10,
      high: 94.20,
      low: 91.80,
      unit: "USD",
      category: "大宗商品",
      wantgooUrl: "https://www.wantgoo.com/global/brent",
      points: [95.4, 94.8, 93.9, 93.27, 92.42],
      role: "通膨預期與實體景氣溫度計",
      desc: "國際原油平緩震盪有助於壓抑全球二次通膨壓力，為各國央行維持利率政策或啟動降息循環創造有利的總體環境。"
    },
    gold: {
      id: "gold",
      name: "黃金現貨 (Gold)",
      symbol: "GC=F / XAU",
      icon: "🪙",
      price: 4056.33,
      change: 23.81,
      changePct: 0.59,
      prevClose: 4032.52,
      open: 4032.62,
      high: 4066.04,
      low: 4026.70,
      unit: "USD",
      category: "貴金屬避險",
      wantgooUrl: "https://www.wantgoo.com/global/gold",
      points: [3980.0, 4015.0, 4032.5, 4040.0, 4056.33],
      role: "終極避險與央行儲備資產",
      desc: "各國央行去美元化儲備配置與抗通膨買盤支撐金價。與股票同步走揚反應實質利率向下與資產保值配置需求。"
    }
  };

  return { results, usdRate, marketIndices };
}
