/**
 * Cloudflare Worker for Fubon Portfolio Dashboard
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

      const { results, usdRate } = await fetchOnlineQuotes(quotesDict, currentUsdRate);

      return new Response(JSON.stringify({
        success: true,
        updatedCount: Object.keys(results).length,
        quotes: results,
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

    return new Response(JSON.stringify({ status: "ok", service: "Fubon Quotes Proxy Worker" }), {
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
          columns: ["close", "change", "change_abs", "open", "high", "low", "volume", "description", "postmarket_close", "premarket_close"]
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
            const postP = cols[9] !== null ? cols[9] : null;
            const preP = cols[10] !== null ? cols[10] : null;
            const nightP = parseFloat(postP || preP || close);

            if (ticker === "NYSE:TSM" && (postP || preP) && close > 0) {
              tsmNightChangePct = (parseFloat(postP || preP) - close) / close;
            }

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

  // 若台指夜盤無變動，但 TSM 在美股盤後有大幅度變化，連動台積電與大型半導體夜盤
  if (txNightChangePct === 0.0 && tsmNightChangePct !== null && Math.abs(tsmNightChangePct) > 0.001) {
    for (const sym of ["2330", "0050"]) {
      if (results[sym]) {
        const p = results[sym].price;
        results[sym].nightPrice = Math.round(p * (1.0 + tsmNightChangePct) * 10) / 10;
      }
    }
  }

  return { results, usdRate };
}
