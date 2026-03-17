// ===== Polymarket API 設定 =====
const GAMMA_API = "https://gamma-api.polymarket.com";
const DATA_API  = "https://data-api.polymarket.com";
const CORS_PROXY = "https://corsproxy.io/?";
const WHALE_THRESHOLD = 5000;

// ===== 帶超時的 fetch =====
function fetchWithTimeout(url, ms = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

// ===== localStorage 快取（5 分鐘）=====
const CACHE_TTL = 5 * 60 * 1000;

function cacheGet(key) {
  try {
    const item = JSON.parse(localStorage.getItem("pm_" + key) || "null");
    if (item && Date.now() - item.ts < CACHE_TTL) return item.data;
  } catch (_) {}
  return null;
}

function cacheSet(key, data) {
  try {
    localStorage.setItem("pm_" + key, JSON.stringify({ ts: Date.now(), data }));
  } catch (_) {}
}

// ===== 並行多 Proxy，用最快回應的 =====
const PROXY_LIST = [
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
];

async function apiFetch(url, cacheKey) {
  // 先查快取
  if (cacheKey) {
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
  }

  // 先嘗試直接請求
  try {
    const res = await fetchWithTimeout(url, 4000);
    if (res.ok) {
      const data = await res.json();
      if (cacheKey) cacheSet(cacheKey, data);
      return data;
    }
  } catch (_) {}

  // 所有 Proxy 並行發出，取最快成功的
  const data = await new Promise((resolve, reject) => {
    let done = false;
    let fails = 0;

    PROXY_LIST.forEach(async (makeProxy) => {
      try {
        const res = await fetchWithTimeout(makeProxy(url), 8000);
        if (res.ok && !done) {
          const text = await res.text();
          const parsed = JSON.parse(text);
          done = true;
          resolve(parsed);
        } else {
          fails++;
          if (fails === PROXY_LIST.length && !done) reject(new Error("All proxies failed"));
        }
      } catch (_) {
        fails++;
        if (fails === PROXY_LIST.length && !done) reject(new Error("All proxies failed"));
      }
    });
  });

  if (cacheKey) cacheSet(cacheKey, data);
  return data;
}

// ===== API 狀態顯示 =====
function setApiStatus(state, text) {
  const dot  = document.querySelector(".status-dot");
  const label = document.getElementById("api-status-text");
  if (!dot || !label) return;
  dot.className = "status-dot " + state;
  label.textContent = text;
}

// ===== 格式化工具 =====
function fmtUSD(val) {
  const n = parseFloat(val) || 0;
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000)     return "$" + (n / 1_000).toFixed(1) + "K";
  return "$" + n.toFixed(2);
}

function fmtPct(val) {
  return (parseFloat(val) * 100).toFixed(0);
}

function timeAgo(ts) {
  const diff = Date.now() - (ts * 1000 || ts);
  const s = Math.floor(diff / 1000);
  if (s < 60)  return "just now";
  if (s < 3600) return Math.floor(s / 60) + " min ago";
  if (s < 86400) return Math.floor(s / 3600) + " hr ago";
  return Math.floor(s / 86400) + " days ago";
}

const AVATAR_COLORS = [
  "#6366f1","#8b5cf6","#ec4899","#f59e0b",
  "#22c55e","#06b6d4","#ef4444","#3b82f6","#10b981","#f97316",
];

function walletColor(addr) {
  let hash = 0;
  for (let i = 0; i < (addr || "").length; i++) hash = addr.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function walletInitials(pseudonym, addr) {
  if (pseudonym) return pseudonym.slice(0, 2).toUpperCase();
  return (addr || "??").slice(2, 4).toUpperCase();
}

// ===== 取得 Polymarket 事件列表（含所有選項）=====
async function fetchEvents() {
  const url = `${GAMMA_API}/events?active=true&closed=false&limit=50&order=volume24hr&ascending=false`;
  const data = await apiFetch(url, "events_top50");
  return Array.isArray(data) ? data : (data?.data || []);
}

// ===== 取得最近交易（Data API /trades，完全公開）=====
async function fetchTrades() {
  const url = `${DATA_API}/trades?limit=30&takerOnly=true`;
  const data = await apiFetch(url, "trades_recent");
  if (Array.isArray(data) && data.length > 0) return data;
  throw new Error("Trades empty");
}

// ===== 取得事件（包含所有選項）=====
async function fetchEvent(eventId) {
  // ① 先嘗試 /events/{id} 拿完整事件
  try {
    const ev = await apiFetch(`${GAMMA_API}/events/${eventId}`, `event_${eventId}`);
    const mks = ev?.markets || ev?.data?.markets || [];
    if (mks.length > 0) return ev;
  } catch (_) {}

  // ② 備援：用 eventId 過濾 /markets 拿同事件所有市場
  const raw = await apiFetch(
    `${GAMMA_API}/markets?eventId=${eventId}&limit=50&active=true`,
    `event_markets_${eventId}`
  );
  const mks = Array.isArray(raw) ? raw : (raw?.data || []);
  if (mks.length === 0) throw new Error("Event not found");
  return {
    title:   mks[0]?.eventTitle || mks[0]?.groupItemTitle || mks[0]?.question,
    slug:    mks[0]?.eventSlug  || mks[0]?.slug || "",
    markets: mks,
  };
}

// ===== 取得市場價格歷史（CLOB API）=====
async function fetchPriceHistory(tokenId, interval = "1w") {
  const url = `https://clob.polymarket.com/prices-history?market=${tokenId}&interval=${interval}&fidelity=60`;
  return apiFetch(url);
}

// ===== 產生 SVG 價格走勢圖 =====
function renderSparkline(history, width = 400, height = 80) {
  if (!history || history.length < 2) return "";
  const prices = history.map((h) => h.p);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 0.01;
  const points = prices.map((p, i) => {
    const x = (i / (prices.length - 1)) * width;
    const y = height - ((p - min) / range) * (height - 8) - 4;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const lastPrice = prices[prices.length - 1];
  const firstPrice = prices[0];
  const isUp = lastPrice >= firstPrice;
  const color = isUp ? "#22c55e" : "#ef4444";
  const fillColor = isUp ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)";
  const lastX = parseFloat(points[points.length - 1].split(",")[0]);
  const lastY = parseFloat(points[points.length - 1].split(",")[1]);

  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.3"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <polyline
        points="${points.join(" ")}"
        fill="none"
        stroke="${color}"
        stroke-width="2"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
      <polygon
        points="${points.join(" ")} ${width},${height} 0,${height}"
        fill="url(#chartFill)"
      />
      <circle cx="${lastX}" cy="${lastY}" r="3.5" fill="${color}"/>
    </svg>
  `;
}

// ===== 渲染市場列表（接受 events 陣列）=====
function renderMarkets(events) {
  const container = document.getElementById("markets-list");
  container.innerHTML = "";

  // 直接用 JS inline style 強制 3 欄 grid（最高優先）
  container.style.display = "grid";
  container.style.gridTemplateColumns = "repeat(3, 1fr)";
  container.style.gap = "10px";

  if (!events || events.length === 0) {
    container.innerHTML = `<div class="empty-state" style="grid-column:1/-1">No active markets found.</div>`;
    return;
  }

  events.forEach((ev) => {
    const card = document.createElement("div");
    card.className = "market-card";
    // 防止 grid item 被內容撐開
    card.style.minWidth = "0";
    card.style.overflow = "hidden";
    const markets = ev.markets || [];

    if (markets.length > 1) {
      renderEventCard(card, ev);
    } else {
      const m = markets[0] || ev;
      renderBinaryCard(card, m, ev);
    }

    container.appendChild(card);
  });
}

// ===== 多選項事件卡片（接受完整 event 物件）=====
function renderEventCard(card, ev) {
  const markets = [...(ev.markets || [])].sort((a, b) => {
    const pa = parseOutcomePrices(a.outcomePrices)[0];
    const pb = parseOutcomePrices(b.outcomePrices)[0];
    return pb - pa;
  });

  const icon    = ev.image || ev.icon || markets[0]?.image || getSportFallbackIcon(ev) || "";
  const title   = ev.title || ev.question || markets[0]?.question || "";
  const vol24h  = fmtUSD(parseFloat(ev.volume24hr  || 0) || markets.reduce((s, m) => s + parseFloat(m.volume24hr || 0), 0));
  const oi      = fmtUSD(parseFloat(ev.liquidity   || 0) || markets.reduce((s, m) => s + parseFloat(m.liquidity  || 0), 0));
  const endDate = (ev.endDate || markets[0]?.endDate)
    ? new Date(ev.endDate || markets[0].endDate).toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" })
    : "TBD";

  const preview = markets.slice(0, 4);
  const extra   = markets.length - 4;

  const outcomeRows = preview.map((m) => {
    const prices = parseOutcomePrices(m.outcomePrices);
    const pct    = Math.round(prices[0] * 100);
    const label  = m.groupItemTitle || m.outcomes?.[0] || m.question || "—";
    return `
      <div class="event-preview-row">
        <span class="event-preview-label">${label}</span>
        <div class="event-preview-bar-wrap">
          <div class="event-preview-bar" style="width:${pct}%"></div>
        </div>
        <span class="event-preview-pct ${pct >= 50 ? "green" : ""}">${pct}%</span>
      </div>`;
  }).join("");

  const evId      = String(ev.id || "");
  const isTrend   = trendingIds.has(evId);
  const isStarred = wlHas(evId);
  const sportFb   = getSportFallbackIcon(ev);
  const svgFb     = "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2244%22 height=%2244%22><rect width=%2244%22 height=%2244%22 rx=%2210%22 fill=%22%231e1e2a%22/><text x=%2222%22 y=%2228%22 text-anchor=%22middle%22 fill=%22%236366f1%22 font-size=%2218%22>P</text></svg>";
  const fallback1 = sportFb ? `this.onerror=function(){this.src='${svgFb}'};this.src='${sportFb}'` : `this.src='${svgFb}'`;

  card.innerHTML = `
    <div class="market-header">
      <img class="market-icon" src="${icon}" alt=""
        onerror="${fallback1}"/>
      <div class="market-info">
        <div class="market-question">
          ${isTrend ? `<span class="trending-badge">🔥 Hot</span> ` : ""}${title}
        </div>
        <div class="market-meta">
          <span class="platform-tag">Polymarket</span>
          <span class="market-end-date">Ends ${endDate}</span>
          <span class="outcomes-count-badge">${markets.length} outcomes</span>
        </div>
      </div>
      <button class="card-star-btn ${isStarred ? "starred" : ""}" data-ev-id="${evId}" title="Add to Watchlist">★</button>
    </div>
    <div class="event-preview-outcomes">
      ${outcomeRows}
      ${extra > 0 ? `<div class="event-preview-more">+${extra} more outcomes</div>` : ""}
    </div>
    <div class="market-stats">
      <div class="stat-item"><div class="stat-label">24h Volume</div><div class="stat-value">${vol24h}</div></div>
      <div class="stat-item"><div class="stat-label">Liquidity</div><div class="stat-value">${oi}</div></div>
    </div>`;

  card.querySelector(".card-star-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    const added = wlToggle(evId);
    e.currentTarget.classList.toggle("starred", added);
    showToast(added ? "Added to Watchlist ★" : "Removed from Watchlist");
  });

  card.addEventListener("click", () => {
    openEventDetailModal(ev, markets, markets[0], vol24h, oi, endDate, icon);
  });
}

// ===== 單一 Yes/No 市場卡片 =====
function renderBinaryCard(card, m, parentEvent) {
  const yesPriceRaw = parseOutcomePrices(m.outcomePrices)[0];
  const yesPct  = Math.round(yesPriceRaw * 100);
  const noPct   = 100 - yesPct;
  const vol24h  = fmtUSD(parseFloat(parentEvent?.volume24hr || m.volume24hr) || 0);
  const oi      = fmtUSD(parseFloat(parentEvent?.liquidity  || m.liquidity)  || 0);
  const endDate = (parentEvent?.endDate || m.endDate)
    ? new Date(parentEvent?.endDate || m.endDate).toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" })
    : "TBD";
  const icon    = parentEvent?.image || m.image || m.icon || getSportFallbackIcon(parentEvent || m) || "";
  const isYes   = yesPct >= 50;

  const evId      = String(parentEvent?.id || m.id || "");
  const isTrend   = trendingIds.has(evId);
  const isStarred = wlHas(evId);
  const sportFb2  = getSportFallbackIcon(parentEvent || m);
  const svgFb2    = "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2244%22 height=%2244%22><rect width=%2244%22 height=%2244%22 rx=%2210%22 fill=%22%231e1e2a%22/><text x=%2222%22 y=%2228%22 text-anchor=%22middle%22 fill=%22%236366f1%22 font-size=%2218%22>P</text></svg>";
  const fallback2 = sportFb2 ? `this.onerror=function(){this.src='${svgFb2}'};this.src='${sportFb2}'` : `this.src='${svgFb2}'`;

  card.innerHTML = `
    <div class="market-header">
      <img class="market-icon" src="${icon}" alt=""
        onerror="${fallback2}"/>
      <div class="market-info">
        <div class="market-question">
          ${isTrend ? `<span class="trending-badge">🔥 Hot</span> ` : ""}${m.question}
        </div>
        <div class="market-meta">
          <span class="platform-tag">Polymarket</span>
          <span class="market-end-date">Ends ${endDate}</span>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
        <div style="text-align:right">
          <div class="stat-label">YES</div>
          <div class="stat-value ${isYes ? "green" : "red"}">${yesPct}¢</div>
        </div>
        <button class="card-star-btn ${isStarred ? "starred" : ""}" data-ev-id="${evId}" title="Add to Watchlist">★</button>
      </div>
    </div>
    <div class="yes-no-bar">
      <div class="bar-yes" style="width:${yesPct}%"></div>
      <div class="bar-no"  style="width:${noPct}%"></div>
    </div>
    <div class="market-stats">
      <div class="stat-item"><div class="stat-label">24h Volume</div><div class="stat-value">${vol24h}</div></div>
      <div class="stat-item"><div class="stat-label">Liquidity</div><div class="stat-value">${oi}</div></div>
    </div>
    <div class="market-actions">
      <button class="btn-trade yes-btn" onclick="event.stopPropagation(); openBuyModal(event, ${JSON.stringify(m.question).replace(/"/g,"&quot;")}, 'Yes', ${yesPct})">
        Buy YES &nbsp;<strong>${yesPct}¢</strong>
      </button>
      <button class="btn-trade no-btn" onclick="event.stopPropagation(); openBuyModal(event, ${JSON.stringify(m.question).replace(/"/g,"&quot;")}, 'No', ${noPct})">
        Buy NO &nbsp;<strong>${noPct}¢</strong>
      </button>
    </div>`;

  card.querySelector(".card-star-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    const added = wlToggle(evId);
    e.currentTarget.classList.toggle("starred", added);
    showToast(added ? "Added to Watchlist ★" : "Removed from Watchlist");
  });

  card.addEventListener("click", () => {
    const mWithSlug = { ...m, eventSlug: parentEvent?.slug || m.eventSlug };
    openBinaryDetailModal(mWithSlug, yesPct, noPct, vol24h, oi, endDate, icon);
  });
}

// ===== 渲染最近交易 =====
function renderTrades(trades) {
  const container = document.getElementById("trades-list");
  container.innerHTML = "";

  if (!trades || trades.length === 0) {
    container.innerHTML = `<div style="padding:16px 18px;color:var(--text-muted);font-size:13px">No recent trades.</div>`;
    return;
  }

  trades.forEach((t) => {
    // 支援兩種 API 欄位命名
    const pseudonym = t.pseudonym || t.name || "";
    const wallet    = t.proxyWallet || t.maker || t.address || "";
    const side      = (t.side || t.outcome || "Yes");
    const sideLabel = side.toLowerCase().includes("yes") || side === "BUY" ? "Yes" : "No";
    const action    = (t.type || "Buy").toLowerCase().includes("sell") ? "sold" : "bought";
    const price     = parseFloat(t.price || 0);
    const size      = parseFloat(t.size  || t.shares || 0);
    const amount    = parseFloat(t.amount || (price * size)) || 0;
    const ts        = t.timestamp || t.createdAt || Date.now() / 1000;
    const title     = t.title || t.market || t.question || "";
    const isWhale   = amount >= WHALE_THRESHOLD;

    const color     = walletColor(wallet);
    const initials  = walletInitials(pseudonym, wallet);
    const displayName = pseudonym || (wallet ? wallet.slice(0, 6) + "..." + wallet.slice(-4) : "Trader");
    const actionClass = action === "bought" ? "buy" : "sell";
    const sideClass   = sideLabel === "Yes" ? "yes-tag" : "no-tag";

    const item = document.createElement("div");
    item.className = "trade-item" + (isWhale ? " trade-whale" : "");

    item.innerHTML = `
      ${isWhale ? `<div class="whale-bar"></div>` : ""}
      <div class="trade-avatar-placeholder" style="background:linear-gradient(135deg,${color},${color}99)">
        ${initials}
      </div>
      <div class="trade-content">
        <div class="trade-trader">
          ${isWhale ? `<span class="whale-badge">🐳 WHALE</span>` : ""}
          ${displayName}
        </div>
        <div class="trade-action">
          <span class="${actionClass}">${action}</span>
          ${size > 0 ? size.toFixed(2) + " shares " : ""}
          <span class="${sideClass}">${sideLabel}</span>
          at ${(price * 100).toFixed(1)}¢
          <span class="${isWhale ? "whale-amount" : ""}">($${amount.toFixed(2)})</span>
        </div>
        <div class="trade-market">${title}</div>
        <div class="trade-time">${timeAgo(ts)}</div>
      </div>
      <div class="trade-arrow">›</div>
    `;

    item.addEventListener("click", () => showTraderProfile({ trader: displayName, avatarText: initials, action, shares: size.toFixed(2), side: sideLabel, market: title, price: (price * 100).toFixed(1) + "¢", amount: "$" + amount.toFixed(2), time: timeAgo(ts), color }));
    container.appendChild(item);

    if (isWhale) triggerWhaleAlert({ trader: displayName, action, side: sideLabel, amount: "$" + amount.toFixed(2), market: title, color, avatarText: initials });
  });
}

// ===== 新聞渲染 =====
const NEWS_DATA = [
  { headline: "Bitcoin Surges Past $85,000 as Institutional Demand Drives Market Rally", source: "CoinDesk", time: "10 min ago", url: "https://news.google.com/search?q=Bitcoin+surges+85000" },
  { headline: "Federal Reserve Officials Signal Patience on Rate Cuts Amid Inflation Concerns", source: "Reuters", time: "25 min ago", url: "https://news.google.com/search?q=Federal+Reserve+rate+cuts+2025" },
  { headline: "Ethereum ETF Sees Record $420M Inflows in Single Trading Session", source: "Bloomberg", time: "1 hr ago", url: "https://news.google.com/search?q=Ethereum+ETF+inflows+record" },
  { headline: "Trump Signs Executive Order Establishing US Strategic Bitcoin Reserve", source: "WSJ", time: "2 hr ago", url: "https://news.google.com/search?q=Trump+Bitcoin+reserve+executive+order" },
  { headline: "SEC Approves Multiple Spot Crypto ETF Applications in Historic Decision", source: "Financial Times", time: "3 hr ago", url: "https://news.google.com/search?q=SEC+crypto+ETF+approval+2025" },
  { headline: "Polymarket Hits $1B in Monthly Trading Volume for First Time", source: "The Block", time: "4 hr ago", url: "https://news.google.com/search?q=Polymarket+1+billion+trading+volume" },
];

function renderNews(news) {
  const container = document.getElementById("news-list");
  container.innerHTML = "";
  news.forEach((n) => {
    const item = document.createElement("div");
    item.className = "news-item";
    item.innerHTML = `
      <div class="news-headline">${n.headline}</div>
      <div class="news-meta">
        <span class="news-source-tag">${n.source}</span>
        <span>${n.time}</span>
        <span class="news-ext-icon">↗</span>
      </div>
    `;
    item.addEventListener("click", () => window.open(n.url, "_blank"));
    container.appendChild(item);
  });
}

// ===== Skeleton Loading 卡片 =====
function skeletonHTML(count = 9) {
  return Array.from({ length: count }, () => `
    <div class="skeleton-card">
      <div class="skeleton-header">
        <div class="skeleton-icon skel"></div>
        <div class="skeleton-lines">
          <div class="skel skel-line" style="width:80%"></div>
          <div class="skel skel-line" style="width:50%"></div>
        </div>
      </div>
      <div class="skel skel-bar" style="width:100%;height:6px"></div>
      <div class="skel skel-bar" style="width:90%;height:6px"></div>
      <div class="skel skel-bar" style="width:75%;height:6px"></div>
      <div class="skeleton-footer">
        <div class="skel skel-stat"></div>
        <div class="skel skel-stat"></div>
      </div>
    </div>
  `).join("");
}

function renderSkeletons(count = 9) {
  const container = document.getElementById("markets-list");
  container.style.display = "grid";
  container.style.gridTemplateColumns = "repeat(3, 1fr)";
  container.style.gap = "10px";
  container.innerHTML = skeletonHTML(count);
}

// ===== 主要載入流程（唯一負責 fetch events 的地方）=====
async function loadAll() {
  // 顯示 Skeleton Loading（等待數據接入，不發 API 請求）
  renderSkeletons(9);
  buildTabs();               // 使用 Polymarket 硬編碼分類
  simulateLiveTrades();
  setApiStatus("pending", "等待數據接入...");
}

// ===== 定期更新交易（每 15 秒）=====
function startTradePolling() {
  setInterval(async () => {
    try {
      const trades = await fetchTrades();
      renderTrades(trades);
    } catch (_) {}
  }, 15000);
}

// ===== 全域快取（Events + 平坦 Markets）=====
let cachedEvents  = [];
let cachedMarkets = [];
let activeTagId   = "all"; // 目前選中的 tag id

// ===== 解析 outcomePrices（可能是 string 或 array）=====
// ===== 體育項目備用圖（當 event 沒有官方圖時使用）=====
/** 根據 event tags 取得對應的體育備用圖（目前停用，回傳 null）*/
function getSportFallbackIcon(_ev) {
  return null;
}

function parseOutcomePrices(raw) {
  if (Array.isArray(raw)) return raw.map(Number);
  if (typeof raw === "string") {
    try { return JSON.parse(raw).map(Number); } catch (_) {}
  }
  return [0.5, 0.5];
}

// ===== Polymarket 官方主分類（硬編碼，與 polymarket.com 一致）=====
const POLYMARKET_CATEGORIES = [
  { id: "all",             label: "All"                  },
  { id: "politics",        label: "🏛 Politics"          },
  { id: "crypto",          label: "₿ Crypto"             },
  { id: "ai",              label: "🤖 AI"                },
  { id: "tech",            label: "💻 Tech"              },
  { id: "sports",          label: "🏆 Sports"            },
  { id: "pop-culture",     label: "🎬 Pop Culture"       },
  { id: "middle-east",     label: "🌍 Middle East"       },
  { id: "iran",            label: "🇮🇷 Iran"             },
  { id: "finance",         label: "💰 Finance"           },
  { id: "geopolitics",     label: "🌐 Geopolitics"       },
  { id: "elections",       label: "🗳 Elections"         },
  { id: "economy",         label: "📈 Economy"           },
  { id: "weather-science", label: "🌦 Weather & Science" },
  { id: "culture",         label: "🎭 Culture"           },
];

// ===== 建立分類 Tabs（使用 Polymarket 官方分類，無需 API 資料）=====
function buildTabs() {
  const container = document.getElementById("category-tabs");
  if (!container) return;

  container.innerHTML = POLYMARKET_CATEGORIES.map((cat) =>
    `<button class="tab${cat.id === "all" ? " active" : ""}" data-tag-id="${cat.id}">${cat.label}</button>`
  ).join("");

  container.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      container.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      activeTagId = tab.dataset.tagId || "all";
      applyCurrentFilters();
    });
  });
}

// ===== 依 tagId 過濾 events =====
function filterEventsByTag(events, tagId) {
  if (tagId === "all") return events;
  return events.filter((ev) =>
    (ev.tags || []).some((t) => String(t.id) === tagId || t.slug === tagId)
  );
}

// initTabsWithApi 不再自己 fetch，由 loadAll 統一處理
function initTabsWithApi() {
  // Tabs 與市場由 loadAll() 負責建立，這裡是 no-op
}

// ===== 篩選排序 =====
function initFilters() {
  document.querySelectorAll(".filter-btn:not(.watchlist-toggle)").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter-btn:not(.watchlist-toggle)").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      applyCurrentFilters();
    });
  });
}

// ===== 市場詳情 Modal 入口（僅保留為 binary fallback）=====
// Event 卡片現在直接傳完整 event 物件，不再走此函式
async function openMarketDetailFromApi(m, yesPct, noPct, vol24h, oi, endDate, icon) {
  openBinaryDetailModal(m, yesPct, noPct, vol24h, oi, endDate, icon);
}

// ===== 多選項 Event Modal =====
async function openEventDetailModal(event, markets, currentMarket, vol24h, oi, endDate, icon) {
  const existing = document.getElementById("market-detail-modal");
  if (existing) existing.remove();

  const title    = event.title || currentMarket.question;
  const slug     = event.slug || currentMarket.eventSlug || currentMarket.slug || "";
  const polyUrl  = slug ? `https://polymarket.com/event/${slug}` : "https://polymarket.com/";

  // 整理每個選項
  const outcomes = markets.map((mk) => {
    const yesPrice  = parseOutcomePrices(mk.outcomePrices)[0];
    const label     = mk.groupItemTitle || mk.outcomes?.[0] || mk.question;
    const tokenIds  = mk.clobTokenIds
      ? (Array.isArray(mk.clobTokenIds) ? mk.clobTokenIds : JSON.parse(mk.clobTokenIds))
      : [];
    return {
      label,
      price:   yesPrice,
      pct:     Math.round(yesPrice * 100),
      tokenId: tokenIds[0] || "",
      mk,
    };
  }).sort((a, b) => b.price - a.price);

  const outcomeRows = outcomes.map((o) => `
    <div class="outcome-row" data-token="${o.tokenId}">
      <div class="outcome-info">
        <span class="outcome-label">${o.label}</span>
        <div class="outcome-bar-wrap">
          <div class="outcome-bar" style="width:${o.pct}%"></div>
        </div>
      </div>
      <div class="outcome-right">
        <span class="outcome-price ${o.pct >= 50 ? 'green' : o.pct <= 10 ? 'red' : ''}">${o.pct}¢</span>
        <button class="btn-trade yes-btn outcome-buy-btn"
          onclick="event.stopPropagation(); openBuyModal(event, '${(o.label).replace(/'/g,"\\'")}', 'Yes', ${o.pct})">
          Buy
        </button>
      </div>
    </div>
  `).join("");

  const overlay = document.createElement("div");
  overlay.id    = "market-detail-modal";
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-box detail-modal event-modal">
      <div class="detail-header">
        <img src="${icon}" class="detail-icon" onerror="this.style.display='none'"/>
        <div class="detail-title-wrap">
          <span class="platform-tag">Polymarket</span>
          <h2 class="detail-title">${title}</h2>
          <span class="detail-end">Ends ${endDate}</span>
        </div>
        <button class="modal-close" id="close-detail">✕</button>
      </div>

      <div class="event-stats-row">
        <div class="event-stat"><span class="stat-label">24h Volume</span><span class="stat-value">${vol24h}</span></div>
        <div class="event-stat"><span class="stat-label">Liquidity</span><span class="stat-value">${oi}</span></div>
        <div class="event-stat"><span class="stat-label">Outcomes</span><span class="stat-value accent">${outcomes.length}</span></div>
      </div>

      <div class="outcomes-list" id="outcomes-list">
        ${outcomeRows}
      </div>

      <!-- 價格走勢圖（點選項切換）-->
      <div class="chart-section" id="chart-section" style="display:${outcomes[0]?.tokenId ? 'block' : 'none'}">
        <div class="chart-header">
          <span class="stat-label" id="chart-label">${outcomes[0]?.label} · YES Price · 7 Days</span>
          <div class="chart-intervals" id="chart-intervals">
            <button class="interval-btn active" data-interval="1w">1W</button>
            <button class="interval-btn" data-interval="1d">1D</button>
            <button class="interval-btn" data-interval="6h">6H</button>
            <button class="interval-btn" data-interval="max">Max</button>
          </div>
        </div>
        <div class="chart-wrap" id="chart-wrap">
          <div class="chart-loading">載入走勢圖...</div>
        </div>
      </div>

      <a href="${polyUrl}" target="_blank" class="btn-polymarket-link">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
          <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
        </svg>
        在 Polymarket 查看此市場
      </a>
    </div>
  `;

  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  overlay.querySelector("#close-detail").addEventListener("click", () => overlay.remove());

  // 點選項高亮 + 換走勢圖
  let selectedTokenId = outcomes[0]?.tokenId || "";
  let selectedLabel   = outcomes[0]?.label   || "";
  let currentInterval = "1w";

  const chartWrap  = overlay.querySelector("#chart-wrap");
  const chartLabel = overlay.querySelector("#chart-label");

  const loadChart = async (tokenId, label, interval) => {
    if (!tokenId) return;
    chartWrap.innerHTML = `<div class="chart-loading">載入中...</div>`;
    chartLabel.textContent = `${label} · YES Price · ${interval.toUpperCase()}`;
    try {
      const result  = await fetchPriceHistory(tokenId, interval);
      const history = result?.history || [];
      if (history.length < 2) { chartWrap.innerHTML = `<div class="chart-loading">數據不足</div>`; return; }
      const lastP   = history[history.length - 1].p;
      const firstP  = history[0].p;
      const change  = ((lastP - firstP) * 100).toFixed(1);
      const isUp    = lastP >= firstP;
      chartWrap.innerHTML = `
        <div class="chart-price-info">
          <span class="chart-current">${(lastP * 100).toFixed(1)}¢</span>
          <span class="chart-change ${isUp ? 'green' : 'red'}">${isUp ? '▲' : '▼'} ${Math.abs(change)}%</span>
        </div>
        ${renderSparkline(history, 480, 90)}
      `;
    } catch (_) { chartWrap.innerHTML = `<div class="chart-loading">走勢圖載入失敗</div>`; }
  };

  if (selectedTokenId) loadChart(selectedTokenId, selectedLabel, currentInterval);

  // 點選項切換走勢圖
  overlay.querySelector("#outcomes-list").addEventListener("click", (e) => {
    const row = e.target.closest(".outcome-row");
    if (!row || e.target.closest(".outcome-buy-btn")) return;
    overlay.querySelectorAll(".outcome-row").forEach(r => r.classList.remove("selected"));
    row.classList.add("selected");
    selectedTokenId = row.dataset.token;
    selectedLabel   = row.querySelector(".outcome-label").textContent;
    loadChart(selectedTokenId, selectedLabel, currentInterval);
  });

  // 切換時間區間
  overlay.querySelector("#chart-intervals").addEventListener("click", (e) => {
    const btn = e.target.closest(".interval-btn");
    if (!btn) return;
    overlay.querySelectorAll(".interval-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentInterval = btn.dataset.interval;
    loadChart(selectedTokenId, selectedLabel, currentInterval);
  });

  // 預設高亮第一個
  overlay.querySelector(".outcome-row")?.classList.add("selected");
}

// ===== 二元市場詳情 Modal（Yes/No）=====
async function openBinaryDetailModal(m, yesPct, noPct, vol24h, oi, endDate, icon) {
  const existing = document.getElementById("market-detail-modal");
  if (existing) existing.remove();

  // 印出完整市場物件，找出正確的 slug 欄位
  console.log("Full market object →", JSON.stringify(m, null, 2));

  // 嘗試所有可能的 event slug 欄位
  const eventSlug = m.eventSlug
    || m.events?.[0]?.slug
    || m.event?.slug
    || m.groupSlug
    || null;
  const marketSlug = m.slug || "";
  const slug = eventSlug || marketSlug;

  console.log("Slug fields →", { eventSlug, marketSlug, using: slug });

  // 嘗試 event 路徑，fallback 到搜尋
  const polyUrl = eventSlug
    ? `https://polymarket.com/event/${eventSlug}`
    : marketSlug
      ? `https://polymarket.com/event/${marketSlug}`
      : `https://polymarket.com/`;

  const overlay = document.createElement("div");
  overlay.id = "market-detail-modal";
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-box detail-modal">
      <div class="detail-header">
        <img src="${icon}" class="detail-icon" onerror="this.style.display='none'"/>
        <div class="detail-title-wrap">
          <span class="platform-tag">Polymarket</span>
          <h2 class="detail-title">${m.question}</h2>
          <span class="detail-end">Ends ${endDate}</span>
        </div>
        <button class="modal-close" id="close-detail">✕</button>
      </div>

      <div class="detail-price-row">
        <div class="detail-price yes-price">
          <div class="price-label">YES</div>
          <div class="price-value">${yesPct}¢</div>
          <div class="price-sub">per share</div>
        </div>
        <div class="detail-divider"></div>
        <div class="detail-price no-price">
          <div class="price-label">NO</div>
          <div class="price-value">${noPct}¢</div>
          <div class="price-sub">per share</div>
        </div>
      </div>

      <div class="yes-no-bar" style="height:8px;margin:0">
        <div class="bar-yes" style="width:${yesPct}%"></div>
        <div class="bar-no"  style="width:${noPct}%"></div>
      </div>

      <!-- 價格走勢圖 -->
      <div class="chart-section">
        <div class="chart-header">
          <span class="stat-label">YES Price · 7 Days</span>
          <div class="chart-intervals" id="chart-intervals">
            <button class="interval-btn active" data-interval="1w">1W</button>
            <button class="interval-btn" data-interval="1d">1D</button>
            <button class="interval-btn" data-interval="6h">6H</button>
            <button class="interval-btn" data-interval="max">Max</button>
          </div>
        </div>
        <div class="chart-wrap" id="chart-wrap">
          <div class="chart-loading">載入走勢圖...</div>
        </div>
      </div>

      <div class="detail-stats-grid">
        <div class="detail-stat">
          <div class="stat-label">24h Volume</div>
          <div class="stat-value">${vol24h}</div>
        </div>
        <div class="detail-stat">
          <div class="stat-label">Liquidity</div>
          <div class="stat-value">${oi}</div>
        </div>
        <div class="detail-stat">
          <div class="stat-label">End Date</div>
          <div class="stat-value" style="font-size:12px">${endDate}</div>
        </div>
        <div class="detail-stat">
          <div class="stat-label">Platform</div>
          <div class="stat-value accent">Polymarket</div>
        </div>
      </div>

      <div class="detail-trade-row">
        <button class="btn-trade yes-btn full" onclick="openBuyModal(event,'${(m.question||'').replace(/'/g,"\\'")}','Yes',${yesPct})">
          Buy YES — ${yesPct}¢
        </button>
        <button class="btn-trade no-btn full" onclick="openBuyModal(event,'${(m.question||'').replace(/'/g,"\\'")}','No',${noPct})">
          Buy NO — ${noPct}¢
        </button>
      </div>

      <a href="${polyUrl}" target="_blank" class="btn-polymarket-link">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
          <polyline points="15 3 21 3 21 9"/>
          <line x1="10" y1="14" x2="21" y2="3"/>
        </svg>
        在 Polymarket 查看此市場
      </a>
    </div>
  `;

  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  overlay.querySelector("#close-detail").addEventListener("click", () => overlay.remove());

  // 取得 tokenId（YES token）
  const tokenIds = m.clobTokenIds
    ? (Array.isArray(m.clobTokenIds) ? m.clobTokenIds : JSON.parse(m.clobTokenIds))
    : [];
  const tokenId = tokenIds[0] || "";

  // 載入價格走勢圖
  const chartWrap = overlay.querySelector("#chart-wrap");
  const loadChart = async (interval) => {
    chartWrap.innerHTML = `<div class="chart-loading">載入中...</div>`;
    if (!tokenId) {
      chartWrap.innerHTML = `<div class="chart-loading">無價格數據</div>`;
      return;
    }
    try {
      const result = await fetchPriceHistory(tokenId, interval);
      const history = result?.history || [];
      if (history.length < 2) {
        chartWrap.innerHTML = `<div class="chart-loading">數據不足</div>`;
        return;
      }
      const lastPrice = history[history.length - 1].p;
      const firstPrice = history[0].p;
      const change = ((lastPrice - firstPrice) * 100).toFixed(1);
      const isUp = lastPrice >= firstPrice;
      chartWrap.innerHTML = `
        <div class="chart-price-info">
          <span class="chart-current">${(lastPrice * 100).toFixed(1)}¢</span>
          <span class="chart-change ${isUp ? 'green' : 'red'}">${isUp ? '▲' : '▼'} ${Math.abs(change)}%</span>
        </div>
        ${renderSparkline(history, 480, 90)}
      `;
    } catch (_) {
      chartWrap.innerHTML = `<div class="chart-loading">走勢圖載入失敗</div>`;
    }
  };

  loadChart("1w");

  // 切換時間區間
  overlay.querySelector("#chart-intervals").addEventListener("click", (e) => {
    const btn = e.target.closest(".interval-btn");
    if (!btn) return;
    overlay.querySelectorAll(".interval-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    loadChart(btn.dataset.interval);
  });
}

// ===== 下單 Modal =====
function openBuyModal(event, question, side, price) {
  if (event) event.stopPropagation();
  const existing = document.getElementById("trade-modal");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "trade-modal";
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-box trade-modal-box">
      <div class="trade-modal-header">
        <h3>Buy <span class="${side === "Yes" ? "yes-price" : "no-price"}" style="font-weight:800">${side}</span> Shares</h3>
        <button class="modal-close" id="close-trade">✕</button>
      </div>
      <p class="trade-modal-market">${question}</p>
      <div class="trade-input-group">
        <label>Amount (USD)</label>
        <div class="trade-input-wrap">
          <span class="trade-input-prefix">$</span>
          <input type="number" id="trade-amount" class="trade-input" placeholder="0.00" min="1" step="1" value="10"/>
        </div>
      </div>
      <div class="trade-summary">
        <div class="trade-summary-row">
          <span>Price per share</span>
          <span class="stat-value">${price}¢</span>
        </div>
        <div class="trade-summary-row">
          <span>Est. shares</span>
          <span class="stat-value" id="est-shares">${(10 / (price / 100)).toFixed(2)}</span>
        </div>
        <div class="trade-summary-row">
          <span>Est. max payout</span>
          <span class="stat-value green" id="est-payout">$${(10 / (price / 100)).toFixed(2)}</span>
        </div>
      </div>
      <button class="btn-accept" id="confirm-trade" style="margin-top:8px">
        Confirm — Buy ${side} at ${price}¢
      </button>
      <p class="trade-disclaimer">This is a demo. No real money is used.</p>
    </div>
  `;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  overlay.querySelector("#close-trade").addEventListener("click", () => overlay.remove());

  const input = document.getElementById("trade-amount");
  input.addEventListener("input", () => {
    const amt = parseFloat(input.value) || 0;
    const shares = amt / (price / 100);
    document.getElementById("est-shares").textContent = shares.toFixed(2);
    document.getElementById("est-payout").textContent = "$" + shares.toFixed(2);
  });

  document.getElementById("confirm-trade").addEventListener("click", () => {
    const amt = parseFloat(input.value) || 0;
    overlay.remove();
    showToast(`✓ 模擬下單：Buy ${side} $${amt.toFixed(2)} on "${question.slice(0,40)}..."`);
  });
}

// ===== 交易者 Profile Modal =====
function showTraderProfile(trade) {
  const existing = document.getElementById("trader-modal");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "trader-modal";
  overlay.className = "modal-overlay";

  const winRate  = Math.floor(Math.random() * 30 + 50);
  const total    = Math.floor(Math.random() * 500 + 50);
  const pnl      = (Math.random() * 5000 - 1000).toFixed(2);
  const positive = parseFloat(pnl) >= 0;

  overlay.innerHTML = `
    <div class="modal-box trader-modal-box">
      <div class="trade-modal-header">
        <h3>Trader Profile</h3>
        <button class="modal-close" id="close-trader">✕</button>
      </div>
      <div class="trader-profile-header">
        <div class="trade-avatar-placeholder" style="width:56px;height:56px;font-size:20px;background:linear-gradient(135deg,${trade.color},${trade.color}99)">
          ${trade.avatarText}
        </div>
        <div>
          <div class="trader-name">${trade.trader}</div>
          <div class="trader-since">Active trader · Polymarket</div>
        </div>
      </div>
      <div class="trader-stats-grid">
        <div class="detail-stat">
          <div class="stat-label">Total P&L</div>
          <div class="stat-value ${positive ? "green" : "red"}">${positive ? "+" : ""}$${pnl}</div>
        </div>
        <div class="detail-stat">
          <div class="stat-label">Win Rate</div>
          <div class="stat-value">${winRate}%</div>
        </div>
        <div class="detail-stat">
          <div class="stat-label">Total Trades</div>
          <div class="stat-value">${total}</div>
        </div>
        <div class="detail-stat">
          <div class="stat-label">Platform</div>
          <div class="stat-value accent">Polymarket</div>
        </div>
      </div>
      <div class="trader-last-trade">
        <div class="stat-label" style="margin-bottom:8px">Last Trade</div>
        <div class="trade-item" style="padding:12px;border-radius:10px;background:var(--bg-secondary);border:1px solid var(--border);cursor:default">
          <div class="trade-avatar-placeholder" style="background:linear-gradient(135deg,${trade.color},${trade.color}99)">${trade.avatarText}</div>
          <div class="trade-content">
            <div class="trade-action">
              <span class="${trade.action === "bought" ? "buy" : "sell"}">${trade.action}</span>
              ${trade.shares} shares
              <span class="${trade.side === "Yes" ? "yes-tag" : "no-tag"}">${trade.side}</span>
              at ${trade.price} (${trade.amount})
            </div>
            <div class="trade-market">${trade.market}</div>
            <div class="trade-time">${trade.time}</div>
          </div>
        </div>
      </div>
    </div>
  `;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  overlay.querySelector("#close-trader").addEventListener("click", () => overlay.remove());
}

// ===== 大額警報 =====
let lastWhaleAlertId = null;

function triggerWhaleAlert(trade) {
  const alertId = `${trade.trader}-${trade.amount}-${trade.time}`;
  if (lastWhaleAlertId === alertId) return;
  lastWhaleAlertId = alertId;

  const existing = document.getElementById("whale-alert");
  if (existing) existing.remove();

  const alert = document.createElement("div");
  alert.id = "whale-alert";
  alert.className = "whale-alert";
  alert.innerHTML = `
    <div class="whale-alert-icon">🐳</div>
    <div class="whale-alert-content">
      <div class="whale-alert-title">大額交易警報</div>
      <div class="whale-alert-body">
        <strong>${trade.trader}</strong> ${trade.action}
        <span class="${trade.side === "Yes" ? "yes-tag" : "no-tag"}">${trade.side}</span>
        <strong>${trade.amount}</strong>
      </div>
      <div class="whale-alert-market">${trade.market}</div>
    </div>
    <button class="whale-alert-close" onclick="this.parentElement.remove()">✕</button>
  `;
  document.body.appendChild(alert);
  requestAnimationFrame(() => alert.classList.add("whale-alert-show"));
  setTimeout(() => {
    alert.classList.remove("whale-alert-show");
    setTimeout(() => alert.remove(), 500);
  }, 6000);
}

// ===== Toast =====
function showToast(message) {
  const existing = document.getElementById("toast");
  if (existing) existing.remove();
  const toast = document.createElement("div");
  toast.id = "toast";
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("toast-show"));
  setTimeout(() => {
    toast.classList.remove("toast-show");
    setTimeout(() => toast.remove(), 400);
  }, 3500);
}


// ===== 備用模擬資料（API 失敗時使用）=====
const FALLBACK_MARKETS = [
  { question: "Will Bitcoin reach $100,000 before April 2025?", outcomePrices: ["0.62","0.38"], volume24hr: 4200000, liquidity: 18500000, endDate: "2025-04-30T00:00:00Z", image: "https://polymarket-upload.s3.us-east-2.amazonaws.com/BTC+fullsize.png" },
  { question: "Will the Federal Reserve cut interest rates in Q1 2025?", outcomePrices: ["0.34","0.66"], volume24hr: 2100000, liquidity: 9800000, endDate: "2025-03-31T00:00:00Z", image: "" },
  { question: "Will Ethereum ETF daily net inflows exceed $500M in March?", outcomePrices: ["0.48","0.52"], volume24hr: 3700000, liquidity: 14200000, endDate: "2025-03-31T00:00:00Z", image: "https://polymarket-upload.s3.us-east-2.amazonaws.com/ETH+fullsize.jpg" },
];

// 儲存從 API 抓到的真實市場名稱
let liveMarketNames = [
  "Will Bitcoin reach $100,000 before April 2025?",
  "Will Ethereum ETF daily net inflows exceed $500M?",
  "Will the Federal Reserve cut rates in Q1 2025?",
];

// ===== 模擬交易（使用真實市場名稱）=====
function simulateLiveTrades() {
  const traders = [
    { name: "Brave-Horizon",    initials: "BH", color: "#3b82f6" },
    { name: "Quiet-Thunder",    initials: "QT", color: "#f97316" },
    { name: "Silver-Cascade",   initials: "SC", color: "#a855f7" },
    { name: "Iron-Compass",     initials: "IC", color: "#14b8a6" },
    { name: "Lucky-Tide",       initials: "LT", color: "#ec4899" },
    { name: "Swift-Oracle",     initials: "SO", color: "#22c55e" },
  ];
  // mkts 會隨著真實市場資料更新
  const mkts = liveMarketNames;
  setInterval(() => {
    const t       = traders[Math.floor(Math.random() * traders.length)];
    const side    = Math.random() > 0.5 ? "Yes" : "No";
    const action  = Math.random() > 0.3 ? "bought" : "sold";
    const isWhale = Math.random() < 0.2;
    const shares  = isWhale ? (Math.random() * 50000 + 5000).toFixed(2) : (Math.random() * 200 + 1).toFixed(2);
    const price   = (Math.random() * 80 + 10) / 100;
    const amount  = parseFloat(shares) * price;

    const trade = {
      trader: t.name, avatarText: t.initials, action, shares,
      side, market: mkts[Math.floor(Math.random() * mkts.length)],
      price: (price * 100).toFixed(1) + "¢",
      amount: "$" + amount.toFixed(2),
      time: "just now", color: t.color,
    };

    const container = document.getElementById("trades-list");
    const item = document.createElement("div");
    item.className = "trade-item" + (amount >= WHALE_THRESHOLD ? " trade-whale" : "");
    const actionClass = action === "bought" ? "buy" : "sell";
    const sideClass   = side === "Yes" ? "yes-tag" : "no-tag";
    item.innerHTML = `
      ${amount >= WHALE_THRESHOLD ? `<div class="whale-bar"></div>` : ""}
      <div class="trade-avatar-placeholder" style="background:linear-gradient(135deg,${t.color},${t.color}99)">${t.initials}</div>
      <div class="trade-content">
        <div class="trade-trader">
          ${amount >= WHALE_THRESHOLD ? `<span class="whale-badge">🐳 WHALE</span>` : ""}
          ${t.name}
        </div>
        <div class="trade-action">
          <span class="${actionClass}">${action}</span>
          ${shares} shares <span class="${sideClass}">${side}</span>
          at ${(price * 100).toFixed(1)}¢
          <span class="${amount >= WHALE_THRESHOLD ? "whale-amount" : ""}">($${amount.toFixed(2)})</span>
        </div>
        <div class="trade-market">${trade.market}</div>
        <div class="trade-time">just now</div>
      </div>
      <div class="trade-arrow">›</div>
    `;
    item.addEventListener("click", () => showTraderProfile(trade));
    if (container.firstChild) container.insertBefore(item, container.firstChild);
    else container.appendChild(item);
    while (container.children.length > 12) container.removeChild(container.lastChild);
    if (amount >= WHALE_THRESHOLD) triggerWhaleAlert({ ...trade, avatarText: t.initials });
  }, 4000);
}

// ===== Watchlist (localStorage) =====
function wlLoad() {
  try { return JSON.parse(localStorage.getItem("pm_watchlist") || "[]"); }
  catch (_) { return []; }
}
function wlSave(ids) {
  try { localStorage.setItem("pm_watchlist", JSON.stringify(ids)); } catch (_) {}
}
function wlHas(id) { return wlLoad().includes(String(id)); }
function wlToggle(id) {
  const ids = wlLoad();
  const sid = String(id);
  const next = ids.includes(sid) ? ids.filter((x) => x !== sid) : [...ids, sid];
  wlSave(next);
  updateWatchlistBadge();
  return next.includes(sid);
}
function updateWatchlistBadge() {
  const ids = wlLoad();
  const cnt = document.getElementById("watchlist-count");
  if (!cnt) return;
  if (ids.length > 0) {
    cnt.textContent = ids.length;
    cnt.style.display = "";
  } else {
    cnt.style.display = "none";
  }
}

// ===== Watchlist Toggle Filter =====
let showWatchlistOnly = false;
function initWatchlistToggle() {
  const btn = document.getElementById("watchlist-toggle");
  const navWatchlist = document.getElementById("nav-watchlist");
  const handler = () => {
    showWatchlistOnly = !showWatchlistOnly;
    btn?.classList.toggle("wl-active", showWatchlistOnly);
    navWatchlist?.classList.toggle("wl-active", showWatchlistOnly);
    applyCurrentFilters();
  };
  btn?.addEventListener("click", handler);
  navWatchlist?.addEventListener("click", (e) => {
    e.preventDefault();
    handler();
  });
}

function applyCurrentFilters() {
  // 尚未有資料 → 保持 skeleton 狀態
  if (cachedEvents.length === 0) {
    renderSkeletons(9);
    return;
  }
  const activeTab = document.querySelector("#category-tabs .tab.active");
  const tagId = activeTab?.dataset?.tagId || "all";
  let base = filterEventsByTag(cachedEvents, tagId);
  if (showWatchlistOnly) {
    const ids = wlLoad();
    base = base.filter((ev) => ids.includes(String(ev.id)));
  }
  const activeOrder = document.querySelector(".filter-btn.active:not(.watchlist-toggle)");
  const order = activeOrder?.dataset?.order || "volume24hr";
  const sorted = sortEvents(base, order);
  renderMarkets(sorted);
}

function sortEvents(events, order) {
  return [...events].sort((a, b) => {
    if (order === "liquidity") return (parseFloat(b.liquidity) || 0) - (parseFloat(a.liquidity) || 0);
    if (order === "endDate")   return new Date(a.endDate || 0) - new Date(b.endDate || 0);
    if (order === "newest")    return new Date(b.startDate || b.createdAt || 0) - new Date(a.startDate || a.createdAt || 0);
    return (parseFloat(b.volume24hr) || 0) - (parseFloat(a.volume24hr) || 0);
  });
}

// ===== Search =====
let searchQuery = "";
function initSearch() {
  const input = document.getElementById("navbar-search-input");
  const clearBtn = document.getElementById("search-clear");
  if (!input) return;

  let timer;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    searchQuery = input.value.trim();
    clearBtn.style.display = searchQuery ? "" : "none";
    timer = setTimeout(() => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const filtered = cachedEvents.filter((ev) => {
          if ((ev.title || "").toLowerCase().includes(q)) return true;
          return (ev.markets || []).some((m) => (m.question || "").toLowerCase().includes(q));
        });
        if (filtered.length === 0) {
          document.getElementById("markets-list").innerHTML = `
            <div class="search-empty">
              <strong>No results for "${searchQuery}"</strong>
              Try a different keyword or browse categories above.
            </div>`;
        } else {
          renderMarkets(filtered);
        }
      } else {
        applyCurrentFilters();
      }
    }, 250);
  });

  clearBtn.addEventListener("click", () => {
    input.value = "";
    searchQuery = "";
    clearBtn.style.display = "none";
    applyCurrentFilters();
  });
}

// ===== Market Stats Bar =====
function updateStatsBar(events) {
  const bar = document.getElementById("market-stats-bar");
  const countEl = document.getElementById("stats-count");
  const volEl   = document.getElementById("stats-vol");
  if (!bar) return;
  const total = events.length;
  const totalVol = events.reduce((s, ev) => s + parseFloat(ev.volume24hr || 0), 0);
  countEl.textContent = `${total} markets`;
  volEl.textContent   = `${fmtUSD(totalVol)} 24h vol`;
  bar.style.display   = "";
}

// ===== Top Traders =====
const TOP_TRADERS_DATA = [
  { name: "Whale-Hunter",   initials: "WH", color: "#6366f1", trades: 142, pnl:  84200 },
  { name: "Alpha-Signal",   initials: "AS", color: "#22c55e", trades:  97, pnl:  51700 },
  { name: "Dark-Prophet",   initials: "DP", color: "#f59e0b", trades: 214, pnl:  33900 },
  { name: "Quiet-Thunder",  initials: "QT", color: "#f97316", trades:  76, pnl:  18400 },
  { name: "Swift-Oracle",   initials: "SO", color: "#ec4899", trades: 103, pnl:  11200 },
  { name: "Iron-Compass",   initials: "IC", color: "#14b8a6", trades:  55, pnl:  -4800 },
  { name: "Lucky-Tide",     initials: "LT", color: "#a855f7", trades:  89, pnl: -12300 },
];

function renderTopTraders() {
  const container = document.getElementById("traders-list");
  if (!container) return;
  const rankClass = (i) => i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "";
  container.innerHTML = TOP_TRADERS_DATA.map((t, i) => `
    <div class="trader-item">
      <span class="trader-rank ${rankClass(i)}">${i < 3 ? ["🥇","🥈","🥉"][i] : i + 1}</span>
      <div class="trader-avatar-sm" style="background:linear-gradient(135deg,${t.color},${t.color}88)">${t.initials}</div>
      <div class="trader-info">
        <div class="trader-name">${t.name}</div>
        <div class="trader-trades">${t.trades} trades</div>
      </div>
      <div class="trader-pnl ${t.pnl >= 0 ? "profit" : "loss"}">
        ${t.pnl >= 0 ? "+" : ""}${fmtUSD(t.pnl)}
      </div>
    </div>
  `).join("");
}

// ===== Trending: 前 5 大 24h Volume 的 event id =====
let trendingIds = new Set();
function computeTrending(events) {
  const sorted = [...events].sort((a, b) => (parseFloat(b.volume24hr) || 0) - (parseFloat(a.volume24hr) || 0));
  trendingIds = new Set(sorted.slice(0, 5).map((ev) => String(ev.id)));
}

// ===== Sports 頁面 =====

/** Sports 專用快取 TTL：15 分鐘 */
const SPORTS_CACHE_TTL = 15 * 60 * 1000;

function sportsCacheGet() {
  try {
    const item = JSON.parse(localStorage.getItem("pm_sports_all") || "null");
    if (item && Date.now() - item.ts < SPORTS_CACHE_TTL) return item.data;
  } catch (_) {}
  return null;
}
function sportsCacheSet(data) {
  try {
    localStorage.setItem("pm_sports_all", JSON.stringify({ ts: Date.now(), data }));
  } catch (_) {}
}

/**
 * 需要個別抓取的 tag slug（這些 tag 在 Polymarket 上是獨立分類，
 * 不一定有 sports tag，例如 esports、ncaab）
 */
const EXTRA_SPORT_TAGS = [
  "esports", "ncaab", "nba", "nhl", "nfl", "mlb",
  "ufc", "f1", "tennis", "golf", "cricket", "soccer",
];

/** Polymarket 各體育聯賽對應的 tag slug 與顯示名稱 */
/**
 * 已知 tag slug → emoji + 顯示名稱對照表
 * 這些是 Polymarket API 實際使用的 tag slug
 */
const SPORTS_TAG_EMOJI = {
  // 足球
  "epl": "⚽ EPL", "ucl": "⚽ UCL", "soccer": "⚽ Soccer",
  "bundesliga": "⚽ Bundesliga", "serie-a": "⚽ Serie A", "la-liga": "⚽ La Liga",
  "ligue-1": "⚽ Ligue 1", "mls": "⚽ MLS", "liga-mx": "⚽ Liga MX",
  "k-league": "⚽ K-League", "j-league": "⚽ J. League",
  "eredivisie": "⚽ Eredivisie", "primeira-liga": "⚽ Primeira Liga",
  "super-lig": "⚽ Süper Lig", "saudi-professional-league": "⚽ Saudi PL",
  "a-league": "⚽ A-League", "uef": "⚽ UEFA", "ufl": "⚽ UEL",
  "champions-league": "⚽ UCL",
  // 籃球
  "nba": "🏀 NBA", "ncaab": "🏀 NCAAB", "cba": "🏀 CBA",
  "euroleague": "🏀 Euroleague",
  // 美式足球
  "nfl": "🏈 NFL", "cfb": "🏈 CFB",
  // 冰球
  "nhl": "🏒 NHL",
  // 棒球
  "mlb": "⚾ MLB", "kbo": "⚾ KBO", "wbc": "⚾ WBC",
  // 綜合格鬥
  "ufc": "🥊 UFC", "mma": "🥊 MMA",
  // 網球
  "tennis": "🎾 Tennis", "atp": "🎾 ATP", "wta": "🎾 WTA",
  // 高爾夫
  "golf": "⛳ Golf", "pga": "⛳ PGA",
  // 板球
  "cricket": "🏏 Cricket", "ipl": "🏏 IPL",
  // 賽車
  "f1": "🏎 F1", "formula-1": "🏎 F1", "formula1": "🏎 F1",
  // 電競
  "esports": "🎮 Esports", "cs2": "🎮 CS2", "dota-2": "🎮 Dota 2",
  "valorant": "🎮 Valorant", "league-of-legends": "🎮 LoL",
  // 橄欖球
  "rugby": "🏉 Rugby",
  // 綜合體育
  "sports": "🏆 Sports",
};

/** 將 tag slug 轉成顯示名稱（有 emoji 的優先，否則用 label 欄位）*/
function tagDisplayName(slug, label) {
  if (SPORTS_TAG_EMOJI[slug]) return SPORTS_TAG_EMOJI[slug];
  if (label) return label;
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** 取得一個 event 的所有 tag slugs（排除純 "sports" 頂層 tag）*/
function eventTagSlugs(ev) {
  return (ev.tags || [])
    .map((t) => t.slug || t.id || "")
    .filter((s) => s && s !== "sports");
}

let cachedSportsEvents = [];
let sportsOrder = "volume24hr";
let sportsLeague = "all"; // "all" 或實際 tag slug

/** 從一個 URL 拉事件（不強制快取 key，避免覆蓋彼此）*/
async function fetchEventsFromUrl(url) {
  try {
    const data = await apiFetch(url, null);
    return Array.isArray(data) ? data : (data?.data || []);
  } catch (_) {
    return [];
  }
}

/**
 * 從 Polymarket 大量抓取體育事件：
 *   - sports tag 分頁（前 3 頁 = 最多 300 筆，按 volume 排序）
 *   - 電競、各主要聯賽獨立 tag（Polymarket 的電競事件不一定掛 sports tag）
 *   - 去重後回傳
 */
async function fetchSportsEvents() {
  // 先查快取
  const cached = sportsCacheGet();
  if (cached) return cached;

  setSportsStatus("loading", "正在載入...");

  // ── 1. sports tag 前 3 頁（最高 volume 的 300 筆）──
  const BASE = `${GAMMA_API}/events?active=true&closed=false&limit=100&order=volume24hr&ascending=false`;
  const sportsPages = [0, 100, 200].map((offset) =>
    fetchEventsFromUrl(`${BASE}&tag=sports&offset=${offset}`)
  );

  // ── 2. 額外獨立 tag（並行，失敗不阻斷）──
  const extraTagRequests = EXTRA_SPORT_TAGS.map((tag) =>
    fetchEventsFromUrl(`${BASE}&tag=${tag}`)
  );

  // 全部並行
  const allResults = await Promise.all([...sportsPages, ...extraTagRequests]);

  // 去重
  const seenIds = new Set();
  const allEvents = [];
  allResults.flat().forEach((ev) => {
    const id = String(ev.id || "");
    if (id && !seenIds.has(id)) {
      seenIds.add(id);
      allEvents.push(ev);
    }
  });

  if (allEvents.length > 0) sportsCacheSet(allEvents);
  return allEvents;
}

/** 設定 Sports API 狀態 */
function setSportsStatus(state, text) {
  const dot   = document.querySelector("#sports-api-status .status-dot");
  const label = document.getElementById("sports-status-text");
  if (dot) dot.className = "status-dot " + state;
  if (label) label.textContent = text;
}

// ===== Polymarket Sports 完整分類（硬編碼，與 polymarket.com/sports 一致）=====
// 圖片路徑簡寫
// 所有子 id 集合，用來快速判斷 sportsLeague 是否為某個群組的子項
const SPORTS_CATEGORIES = [
  { id: "all",       icon: "⚡", label: "All Sports" },
  { id: "soccer",    icon: "⚽", label: "Soccer",    children: [
    { id: "ucl",                       label: "UCL"          },
    { id: "epl",                       label: "EPL"          },
    { id: "la-liga",                   label: "La Liga"      },
    { id: "bundesliga",                label: "Bundesliga"   },
    { id: "serie-a",                   label: "Serie A"      },
    { id: "ligue-1",                   label: "Ligue 1"      },
    { id: "mls",                       label: "MLS"          },
    { id: "liga-mx",                   label: "Liga MX"      },
    { id: "k-league",                  label: "K-League"     },
    { id: "j-league",                  label: "J. League"    },
    { id: "saudi-professional-league", label: "Saudi PL"     },
    { id: "uef",                       label: "UEFA Europa"  },
    { id: "a-league",                  label: "A-League"     },
    { id: "eredivisie",                label: "Eredivisie"   },
    { id: "primeira-liga",             label: "Primeira Liga"},
    { id: "super-lig",                 label: "Süper Lig"    },
    { id: "fifa",                      label: "FIFA"         },
  ]},
  { id: "basketball", icon: "🏀", label: "Basketball", children: [
    { id: "nba",   label: "NBA"   },
    { id: "ncaab", label: "NCAAB" },
  ]},
  { id: "esports",   icon: "🎮", label: "Esports",    children: [
    { id: "esports",          label: "All Esports"  },
    { id: "cs2",              label: "CS2"           },
    { id: "league-of-legends",label: "LoL"           },
    { id: "dota-2",           label: "Dota 2"        },
    { id: "valorant",         label: "Valorant"      },
  ]},
  { id: "nhl",       icon: "🏒", label: "NHL" },
  { id: "cricket",   icon: "🏏", label: "Cricket",    children: [
    { id: "cricket", label: "Cricket" },
    { id: "ipl",     label: "IPL"     },
  ]},
  { id: "hockey",    icon: "🏑", label: "Hockey",     children: [
    { id: "nhl",       label: "NHL"    },
  ]},
  { id: "baseball",  icon: "⚾", label: "Baseball",   children: [
    { id: "mlb", label: "MLB" },
    { id: "kbo", label: "KBO" },
  ]},
  { id: "rugby",     icon: "🏉", label: "Rugby",      children: [
    { id: "nfl",  label: "NFL"   },
    { id: "cfb",  label: "CFB"   },
    { id: "rugby",label: "Rugby" },
  ]},
  { id: "tennis",    icon: "🎾", label: "Tennis",     children: [
    { id: "tennis", label: "Tennis" },
    { id: "atp",    label: "ATP"    },
    { id: "wta",    label: "WTA"    },
  ]},
  { id: "mma",       icon: "🥊", label: "MMA",        children: [
    { id: "ufc",    label: "UFC"    },
    { id: "boxing", label: "Boxing" },
  ]},
  { id: "f1",        icon: "🏎", label: "Formula 1" },
  { id: "golf",      icon: "⛳", label: "Golf" },
  { id: "table-tennis", icon: "🏓", label: "Table Tennis" },
  { id: "chess",     icon: "♟", label: "Chess" },
  { id: "lacrosse",  icon: "🥍", label: "Lacrosse" },
  { id: "american-football", icon: "🏈", label: "American Football", children: [
    { id: "nfl", label: "NFL" },
    { id: "cfb", label: "CFB" },
  ]},
];

/** 取得群組下所有葉節點 id */
function getCategoryLeafIds(cat) {
  if (!cat.children) return [cat.id];
  return cat.children.map((c) => c.id);
}

/** 當前 sportsLeague 對應的所有要篩選的 id 清單 */
function getSportsFilterIds() {
  if (sportsLeague === "all") return null; // null = 不篩選
  // 先找是否是群組 parent
  const group = SPORTS_CATEGORIES.find((c) => c.id === sportsLeague && c.children);
  if (group) return group.children.map((c) => c.id);
  return [sportsLeague];
}

// 記錄哪些群組是展開狀態
const expandedGroups = new Set(["soccer"]); // 預設展開 Soccer

/** 建立 Sports 左側手風琴分類側欄 */
function buildSportsLeagueTabs() {
  const container = document.getElementById("sports-league-tabs");
  if (!container) return;

  const html = SPORTS_CATEGORIES.map((cat) => {
    const hasChildren = Array.isArray(cat.children) && cat.children.length > 0;
    const isExpanded = expandedGroups.has(cat.id);
    // 判斷是否 active（自身 or 某個子項被選中）
    const leafIds = getCategoryLeafIds(cat);
    const isActive = sportsLeague === cat.id || leafIds.includes(sportsLeague);

    if (!hasChildren) {
      return `<button class="sports-cat-parent${isActive ? " active" : ""}" data-id="${cat.id}" data-leaf="true">
        <span class="scp-icon">${cat.icon}</span>
        <span class="scp-label">${cat.label}</span>
      </button>`;
    }

    const childrenHtml = cat.children.map((child) => {
      const childActive = sportsLeague === child.id ? " active" : "";
      return `<button class="sports-cat-child${childActive}" data-id="${child.id}">${child.label}</button>`;
    }).join("");

    return `<div class="sports-cat-group${isExpanded ? " expanded" : ""}">
      <button class="sports-cat-parent${isActive && sportsLeague === cat.id ? " active" : ""}" data-id="${cat.id}" data-leaf="false">
        <span class="scp-icon">${cat.icon}</span>
        <span class="scp-label">${cat.label}</span>
        <span class="scp-chevron">›</span>
      </button>
      <div class="sports-cat-children">${childrenHtml}</div>
    </div>`;
  }).join("");

  container.innerHTML = html;

  // Parent 點擊：有子項 → 展開/收合；無子項 → 直接選擇
  container.querySelectorAll(".sports-cat-parent").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const isLeaf = btn.dataset.leaf === "true";

      if (isLeaf) {
        selectSportsLeague(id);
      } else {
        // 展開/收合
        const group = btn.closest(".sports-cat-group");
        if (group) {
          const wasExpanded = group.classList.contains("expanded");
          group.classList.toggle("expanded", !wasExpanded);
          if (!wasExpanded) expandedGroups.add(id);
          else expandedGroups.delete(id);
        }
      }
    });
  });

  // Child 點擊 → 選擇子聯賽
  container.querySelectorAll(".sports-cat-child").forEach((btn) => {
    btn.addEventListener("click", () => selectSportsLeague(btn.dataset.id));
  });
}

function selectSportsLeague(id) {
  sportsLeague = id;
  // 更新 active 狀態
  const container = document.getElementById("sports-league-tabs");
  if (container) {
    container.querySelectorAll(".sports-cat-parent, .sports-cat-child").forEach((el) => {
      el.classList.remove("active");
    });
    // 標記被選中的按鈕
    container.querySelectorAll(`[data-id="${id}"]`).forEach((el) => el.classList.add("active"));
    // 如果選的是子項，也高亮父項群組
    SPORTS_CATEGORIES.forEach((cat) => {
      if (cat.children && cat.children.some((c) => c.id === id)) {
        const parentBtn = container.querySelector(`.sports-cat-parent[data-id="${cat.id}"]`);
        if (parentBtn) parentBtn.classList.add("active");
      }
    });
  }
  renderSportsMarkets();
}

/** 篩選 + 排序後渲染體育市場列表 */
function renderSportsMarkets() {
  const container = document.getElementById("sports-markets-list");
  if (!container) return;

  // 尚未有資料 → 保持 skeleton 狀態
  if (cachedSportsEvents.length === 0) {
    container.style.display = "grid";
    container.style.gridTemplateColumns = "repeat(3, 1fr)";
    container.style.gap = "10px";
    container.innerHTML = skeletonHTML(12);
    return;
  }

  let events = cachedSportsEvents;
  const filterIds = getSportsFilterIds();
  if (filterIds) {
    events = events.filter((ev) => filterIds.some((id) => eventTagSlugs(ev).includes(id)));
  }

  // 排序
  events = sortEvents(events, sportsOrder);

  container.innerHTML = "";
  container.style.display = "grid";
  container.style.gridTemplateColumns = "repeat(3, 1fr)";
  container.style.gap = "10px";

  if (events.length === 0) {
    container.innerHTML = `<div class="empty-state" style="grid-column:1/-1">No sports markets found for this league.</div>`;
    return;
  }

  events.forEach((ev) => {
    const card = document.createElement("div");
    card.className = "market-card";
    card.style.minWidth = "0";
    card.style.overflow = "hidden";
    const markets = ev.markets || [];
    if (markets.length > 1) renderEventCard(card, ev);
    else renderBinaryCard(card, markets[0] || ev, ev);
    container.appendChild(card);
  });
}

/** 載入並初始化 Sports 視圖（等待數據接入，顯示模板）*/
function loadSportsView() {
  setSportsStatus("pending", "等待數據接入...");
  const list = document.getElementById("sports-markets-list");
  if (list) {
    list.style.display = "grid";
    list.style.gridTemplateColumns = "repeat(3, 1fr)";
    list.style.gap = "10px";
    list.innerHTML = skeletonHTML(12);
  }
  buildSportsLeagueTabs();
}

/** 體育篩選排序按鈕 */
function initSportsFilters() {
  document.querySelectorAll(".sports-filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".sports-filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      sportsOrder = btn.dataset.order;
      renderSportsMarkets();
    });
  });
}

// ===== Crypto 頁面 =====
let cryptoTime  = "all";
let cryptoType  = "all";
let cryptoOrder = "volume24hr";

function renderCryptoMarkets() {
  const container = document.getElementById("crypto-markets-list");
  if (!container) return;
  container.style.display = "grid";
  container.style.gridTemplateColumns = "repeat(3, 1fr)";
  container.style.gap = "10px";
  container.innerHTML = skeletonHTML(12);
}

function initCryptoFilters() {
  // 時間 tabs
  const timeTabs = document.getElementById("crypto-time-tabs");
  timeTabs?.querySelectorAll(".crypto-time-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      timeTabs.querySelectorAll(".crypto-time-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      cryptoTime = btn.dataset.time;
      renderCryptoMarkets();
    });
  });

  // 幣種篩選按鈕（左側欄）
  document.getElementById("crypto-asset-tabs")?.querySelectorAll(".sports-cat-parent").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById("crypto-asset-tabs").querySelectorAll(".sports-cat-parent").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderCryptoMarkets();
    });
  });

  // 類型 tabs
  document.getElementById("crypto-type-tabs")?.querySelectorAll(".crypto-type-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById("crypto-type-tabs").querySelectorAll(".crypto-type-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      cryptoType = btn.dataset.type;
      renderCryptoMarkets();
    });
  });

  // 排序按鈕
  ["crypto-sort-vol", "crypto-sort-liq", "crypto-sort-end"].forEach((id) => {
    document.getElementById(id)?.addEventListener("click", (e) => {
      const btn = e.currentTarget;
      ["crypto-sort-vol", "crypto-sort-liq", "crypto-sort-end"]
        .forEach((bid) => document.getElementById(bid)?.classList.remove("active"));
      btn.classList.add("active");
      cryptoOrder = btn.dataset.order;
      renderCryptoMarkets();
    });
  });
}

function loadCryptoView() {
  renderCryptoMarkets();
}

// ===== 視圖切換 =====
let currentView = "events";
let sportsLoaded = false;
let portfolioLoaded = false;
let cryptoLoaded = false;
let intelLoaded = false;

function switchView(view) {
  currentView = view;
  ["view-events", "view-sports", "view-portfolio", "view-crypto", "view-intel"].forEach((id) =>
    document.getElementById(id)?.style.setProperty("display", "none")
  );
  ["nav-events", "nav-sports", "nav-crypto", "nav-intel", "btn-watchlist-nav"].forEach((id) =>
    document.getElementById(id)?.classList.remove("active")
  );

  // Portfolio / Intel 全寬（隱藏側邊欄）
  const grid    = document.querySelector(".content-grid");
  const sidebar = document.querySelector(".sidebar");
  if (view === "portfolio" || view === "intel") {
    grid?.classList.add("portfolio-mode");
    if (sidebar) sidebar.style.display = "none";
  } else {
    grid?.classList.remove("portfolio-mode");
    if (sidebar) sidebar.style.display = "";
  }

  if (view === "sports") {
    document.getElementById("view-sports")?.style.setProperty("display", "block");
    document.getElementById("nav-sports")?.classList.add("active");
    if (!sportsLoaded) { sportsLoaded = true; loadSportsView(); }
  } else if (view === "portfolio") {
    document.getElementById("view-portfolio")?.style.setProperty("display", "block");
    document.getElementById("btn-watchlist-nav")?.classList.add("active");
    if (!portfolioLoaded) { portfolioLoaded = true; renderPortfolioView(); }
  } else if (view === "crypto") {
    document.getElementById("view-crypto")?.style.setProperty("display", "block");
    document.getElementById("nav-crypto")?.classList.add("active");
    if (!cryptoLoaded) { cryptoLoaded = true; loadCryptoView(); }
  } else if (view === "intel") {
    document.getElementById("view-intel")?.style.setProperty("display", "block");
    document.getElementById("nav-intel")?.classList.add("active");
    if (!intelLoaded) { intelLoaded = true; loadIntelView(); }
  } else {
    document.getElementById("view-events")?.style.setProperty("display", "block");
    document.getElementById("nav-events")?.classList.add("active");
  }
}

function initNavigation() {
  ["events", "crypto", "sports", "intel"].forEach((view) => {
    document.getElementById(`nav-${view}`)?.addEventListener("click", (e) => {
      e.preventDefault();
      switchView(view);
    });
  });
  document.getElementById("btn-watchlist-nav")?.addEventListener("click", () => {
    switchView("portfolio");
  });
}

// ===== Portfolio Dashboard =====

/** 確定性偽亂數（seed 固定，確保每次重整數據一致）*/
function _pRand(seed) {
  let s = seed;
  return () => { s = (s * 16807 + 0) % 2147483647; return (s - 1) / 2147483646; };
}

/** 生成 365 天資金曲線 */
const EQUITY_DATA = (() => {
  const r = _pRand(7777);
  const arr = [];
  let v = 8500;
  const now = Date.now();
  for (let i = 364; i >= 0; i--) {
    v = Math.max(4800, v * (1 + (r() - 0.43) * 0.045));
    arr.push({ date: new Date(now - i * 86400000), value: Math.round(v * 100) / 100 });
  }
  return arr;
})();

/** 從資金曲線計算每日 P&L */
const DAILY_PNL = (() => {
  const map = {};
  EQUITY_DATA.forEach((d, i) => {
    if (!i) return;
    map[d.date.toISOString().slice(0, 10)] =
      +(d.value - EQUITY_DATA[i - 1].value).toFixed(2);
  });
  return map;
})();

/** 持倉資料 */
const OPEN_POSITIONS = [
  { market: "Will Trump sign AI executive order?",    side: "YES", shares: 250, avgEntry: 0.71, current: 0.78, endDate: "Apr 30" },
  { market: "EPL Winner 2024/25: Arsenal",            side: "YES", shares: 180, avgEntry: 0.22, current: 0.31, endDate: "May 18" },
  { market: "Fed rate cut in Q2 2025?",               side: "NO",  shares: 120, avgEntry: 0.58, current: 0.49, endDate: "Jul 1"  },
  { market: "NBA Champion: OKC Thunder",              side: "YES", shares: 300, avgEntry: 0.35, current: 0.41, endDate: "Jun 30" },
  { market: "F1 Driver Champion: George Russell",     side: "YES", shares: 200, avgEntry: 0.48, current: 0.54, endDate: "Dec 1"  },
  { market: "BTC reaches $120K before July 2025?",   side: "YES", shares: 150, avgEntry: 0.29, current: 0.21, endDate: "Jul 1"  },
];

/** 計算投資組合統計 */
const PORT_STATS = (() => {
  const total    = EQUITY_DATA.at(-1).value;
  const start    = EQUITY_DATA[0].value;
  const gain     = total - start;
  const posValue = OPEN_POSITIONS.reduce((s, p) => s + p.shares * p.current, 0);
  const stake    = OPEN_POSITIONS.reduce((s, p) => s + p.shares * p.avgEntry, 0);
  const unrealized = OPEN_POSITIONS.reduce((s, p) => s + p.shares * (p.current - p.avgEntry), 0);
  const realized   = gain - unrealized;
  const roi        = +((gain / start) * 100).toFixed(2);
  const volume     = +(stake * 4.8).toFixed(2); // 模擬總交易量
  return {
    total:      +total.toFixed(2),
    balance:    +Math.max(0, total - posValue).toFixed(2),
    posValue:   +posValue.toFixed(2),
    unrealized: +unrealized.toFixed(2),
    realized:   +realized.toFixed(2),
    roi,
    volume,
  };
})();

let equityRange = "1M";
let _eqState = null; // 給 hover handler 用

/** 渲染左側 Summary 面板數字 */
function renderPortfolioSummary() {
  const s = PORT_STATS;
  const setText = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
  setText("port-total-num",  fmtUSD(s.total));
  setText("port-active-num", fmtUSD(s.posValue));
  setText("port-cash-num",   fmtUSD(s.balance));
  setText("port-usdc-num",   fmtUSD(s.balance));
}

/** 渲染右側 4 個績效指標 */
function renderPortfolioStats() {
  const el = document.getElementById("portfolio-stats");
  if (!el) return;
  const s = PORT_STATS;

  const metric = (label, val, cls) => `
    <div class="port-metric">
      <div class="port-metric-label">${label}</div>
      <div class="port-metric-value ${cls}">${val}</div>
    </div>`;

  const sign = (v) => (v >= 0 ? "+" : "");
  el.innerHTML = [
    metric("Realized P&L",   `${sign(s.realized)}${fmtUSD(s.realized)}`,   s.realized   >= 0 ? "up" : "down"),
    metric("Unrealized P&L", `${sign(s.unrealized)}${fmtUSD(s.unrealized)}`,s.unrealized >= 0 ? "up" : "down"),
    metric("Total ROI",      `${sign(s.roi)}${s.roi}%`,                      s.roi        >= 0 ? "up" : "down"),
    metric("Total Volume",   fmtUSD(s.volume), "neutral"),
  ].join("");
}

/** 渲染資金曲線（SVG + 互動 hover）*/
function renderEquityChart() {
  const container = document.getElementById("equity-chart-wrap");
  if (!container) return;

  const DAYS = { "1W": 7, "1M": 30, "3M": 90, "All": 365 };
  const slice = EQUITY_DATA.slice(-(DAYS[equityRange] ?? 30));
  const W = 800, H = 210;
  const P = { t: 18, r: 12, b: 32, l: 62 };
  const CW = W - P.l - P.r, CH = H - P.t - P.b;

  const vals = slice.map((d) => d.value);
  const minV = Math.min(...vals), maxV = Math.max(...vals);
  const vR = maxV - minV || 1;
  const isUp = vals.at(-1) >= vals[0];
  const color = isUp ? "#22c55e" : "#ef4444";

  const xS = (i) => P.l + (i / (slice.length - 1)) * CW;
  const yS = (v) => P.t + (1 - (v - minV) / vR) * CH;

  const pts = slice.map((d, i) => `${xS(i).toFixed(1)},${yS(d.value).toFixed(1)}`).join(" ");
  const close = `${xS(slice.length - 1).toFixed(1)},${H - P.b} ${P.l},${H - P.b}`;

  const yTicks = [0, 1, 2, 3, 4].map((i) => ({
    v: minV + (vR * i) / 4,
    y: yS(minV + (vR * i) / 4),
  }));
  const step = Math.max(1, Math.floor(slice.length / 4));
  const xIdxs = [...new Set([0, step, step * 2, step * 3, slice.length - 1])].filter((i) => i < slice.length);

  const changeAbs = vals.at(-1) - vals[0];
  const changePct = ((changeAbs / vals[0]) * 100).toFixed(2);
  const sign = changeAbs >= 0 ? "+" : "";

  _eqState = { slice, W, H, P, CW, CH, minV, vR, color };

  container.innerHTML = `
    <div class="equity-change-badge ${isUp ? "up" : "down"}">
      ${sign}${fmtUSD(changeAbs)} <span class="eq-pct">${sign}${changePct}%</span>
    </div>
    <div class="equity-svg-wrap" style="position:relative">
      <svg id="equity-svg" viewBox="0 0 ${W} ${H}" width="100%" height="${H}"
           preserveAspectRatio="none" style="display:block;overflow:visible">
        <defs>
          <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${color}" stop-opacity="0.28"/>
            <stop offset="100%" stop-color="${color}" stop-opacity="0.02"/>
          </linearGradient>
        </defs>
        ${yTicks.map((t) => `
          <line x1="${P.l}" y1="${t.y.toFixed(1)}" x2="${W - P.r}" y2="${t.y.toFixed(1)}"
                stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
          <text x="${P.l - 6}" y="${(t.y + 4).toFixed(1)}" fill="rgba(255,255,255,0.32)"
                font-size="10" text-anchor="end">${fmtUSD(t.v)}</text>`).join("")}
        ${xIdxs.map((i) => `
          <text x="${xS(i).toFixed(1)}" y="${H - 6}" fill="rgba(255,255,255,0.32)"
                font-size="10" text-anchor="middle">
            ${slice[i].date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </text>`).join("")}
        <polygon points="${pts} ${close}" fill="url(#eqGrad)"/>
        <polyline points="${pts}" fill="none" stroke="${color}"
                  stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        <line id="eq-vline" x1="0" y1="${P.t}" x2="0" y2="${H - P.b}"
              stroke="rgba(255,255,255,0.35)" stroke-width="1" stroke-dasharray="3,2" display="none"/>
        <circle id="eq-dot" r="4.5" fill="${color}" stroke="#0f172a" stroke-width="2" display="none"/>
        <rect id="eq-overlay" x="${P.l}" y="${P.t}" width="${CW}" height="${CH}"
              fill="transparent" style="cursor:crosshair"/>
      </svg>
      <div id="eq-tooltip" class="equity-tooltip" style="display:none"></div>
    </div>`;

  const svg     = document.getElementById("equity-svg");
  const overlay = document.getElementById("eq-overlay");
  overlay?.addEventListener("mousemove", (e) => handleEquityHover(e, svg));
  overlay?.addEventListener("mouseleave", hideEquityTooltip);
}

function handleEquityHover(e, svg) {
  if (!_eqState) return;
  const { slice, W, P, CW, CH, minV, vR, color } = _eqState;

  const pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  const sp = pt.matrixTransform(svg.getScreenCTM().inverse());

  const idx = Math.max(0, Math.min(slice.length - 1,
    Math.round(((sp.x - P.l) / CW) * (slice.length - 1))));
  const d = slice[idx];
  const px = P.l + (idx / (slice.length - 1)) * CW;
  const py = P.t + (1 - (d.value - minV) / vR) * CH;

  const vline = document.getElementById("eq-vline");
  const dot   = document.getElementById("eq-dot");
  const tip   = document.getElementById("eq-tooltip");

  if (vline) { vline.setAttribute("x1", px); vline.setAttribute("x2", px); vline.removeAttribute("display"); }
  if (dot)   { dot.setAttribute("cx", px); dot.setAttribute("cy", py); dot.removeAttribute("display"); }
  if (tip) {
    const dateStr = d.date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    tip.textContent = `${dateStr}  ·  ${fmtUSD(d.value)}`;
    tip.style.display = "";
    const wrap = document.querySelector(".equity-svg-wrap");
    if (wrap) {
      const wr = wrap.getBoundingClientRect();
      const leftPx = ((px - P.l) / CW) * (wr.width - P.l - P.r) + P.l;
      tip.style.left = `${Math.min(leftPx, wr.width - 155)}px`;
    }
  }
}

function hideEquityTooltip() {
  document.getElementById("eq-vline")?.setAttribute("display", "none");
  document.getElementById("eq-dot")?.setAttribute("display", "none");
  const tip = document.getElementById("eq-tooltip");
  if (tip) tip.style.display = "none";
}

/** 渲染 P&L 熱力日曆（GitHub 風格）*/
// 月曆當前顯示月份
let calMonth = new Date().getMonth();
let calYear  = new Date().getFullYear();

/** 月曆：每月一頁，每格顯示金額，可前後切換 */
function renderPnLCalendar() {
  const container = document.getElementById("pnl-calendar");
  if (!container) return;

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const startDow    = new Date(calYear, calMonth, 1).getDay(); // 0=Sun

  const MONTH_NAMES = ["January","February","March","April","May","June",
                       "July","August","September","October","November","December"];
  const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  // 建立單元格陣列（null = 空白佔位）
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const date    = new Date(calYear, calMonth, d);
    const key     = date.toISOString().slice(0, 10);
    const future  = date > now;
    const isToday = date.getTime() === now.getTime();
    cells.push({ day: d, key, pnl: future ? null : (DAILY_PNL[key] ?? null), future, isToday });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  // 背景色
  function bgColor(pnl) {
    if (pnl == null) return "transparent";
    if (pnl >  400)  return "rgba(21,128,61,0.55)";
    if (pnl >  100)  return "rgba(22,163,74,0.42)";
    if (pnl >  0)    return "rgba(74,222,128,0.18)";
    if (pnl === 0)   return "transparent";
    if (pnl > -100)  return "rgba(239,68,68,0.18)";
    if (pnl > -400)  return "rgba(220,38,38,0.38)";
    return "rgba(153,27,27,0.55)";
  }
  function textColor(pnl) {
    if (pnl == null || pnl === 0) return "var(--text-muted)";
    return pnl > 0 ? "#4ade80" : "#f87171";
  }

  // 當月統計
  const tradedDays = cells.filter((c) => c && !c.future && c.pnl !== null);
  const monthTotal = tradedDays.reduce((s, c) => s + c.pnl, 0);
  const winDays    = tradedDays.filter((c) => c.pnl > 0).length;
  const loseDays   = tradedDays.filter((c) => c.pnl < 0).length;
  const bestDay    = tradedDays.reduce((b, c) => (c.pnl > (b?.pnl ?? -Infinity) ? c : b), null);
  const worstDay   = tradedDays.reduce((w, c) => (c.pnl < (w?.pnl ?? Infinity) ? c : w), null);
  const winRate    = tradedDays.length ? Math.round((winDays / tradedDays.length) * 100) : 0;

  // 邊界：不能超過本月，不能超過一年前
  const isCurrentMonth = calYear === now.getFullYear() && calMonth === now.getMonth();
  const minDate = new Date(now.getFullYear() - 1, now.getMonth(), 1);
  const isMinMonth = new Date(calYear, calMonth, 1) <= minDate;

  container.innerHTML = `
    <div class="cal-mnav">
      <button class="cal-mnav-btn" id="cal-prev-btn" ${isMinMonth ? "disabled" : ""}>‹</button>
      <span class="cal-mtitle">${MONTH_NAMES[calMonth]} ${calYear}</span>
      <button class="cal-mnav-btn" id="cal-next-btn" ${isCurrentMonth ? "disabled" : ""}>›</button>
    </div>

    <div class="cal-stats-bar">
      <div class="cal-mstat">
        <span class="cal-mstat-label">Monthly P&L</span>
        <span class="cal-mstat-val ${monthTotal >= 0 ? "up" : "down"}">
          ${monthTotal >= 0 ? "+" : ""}${fmtUSD(monthTotal)}
        </span>
      </div>
      <div class="cal-mstat">
        <span class="cal-mstat-label">Win Rate</span>
        <span class="cal-mstat-val">${winRate}%</span>
      </div>
      <div class="cal-mstat">
        <span class="cal-mstat-label">Profit Days</span>
        <span class="cal-mstat-val up">${winDays} days</span>
      </div>
      <div class="cal-mstat">
        <span class="cal-mstat-label">Loss Days</span>
        <span class="cal-mstat-val down">${loseDays} days</span>
      </div>
      ${bestDay ? `<div class="cal-mstat">
        <span class="cal-mstat-label">Best Day</span>
        <span class="cal-mstat-val up">+${fmtUSD(bestDay.pnl)}</span>
      </div>` : ""}
      ${worstDay ? `<div class="cal-mstat">
        <span class="cal-mstat-label">Worst Day</span>
        <span class="cal-mstat-val down">${fmtUSD(worstDay.pnl)}</span>
      </div>` : ""}
    </div>

    <div class="cal-mgrid">
      ${DOW.map((d) => `<div class="cal-mdow">${d}</div>`).join("")}
      ${cells.map((c) => {
        if (!c) return `<div class="cal-mcell empty"></div>`;
        return `
          <div class="cal-mcell ${c.future ? "future" : ""} ${c.isToday ? "is-today" : ""}"
               style="background:${bgColor(c.pnl)}">
            <span class="cal-mday-num ${c.isToday ? "today-num" : ""}">${c.day}</span>
            ${!c.future ? `<span class="cal-mpnl" style="color:${textColor(c.pnl)}">
              ${c.pnl !== null ? (c.pnl >= 0 ? "+" : "") + fmtUSD(c.pnl) : ""}
            </span>` : ""}
          </div>`;
      }).join("")}
    </div>`;

  document.getElementById("cal-prev-btn")?.addEventListener("click", () => {
    calMonth--;
    if (calMonth < 0) { calMonth = 11; calYear--; }
    renderPnLCalendar();
  });
  document.getElementById("cal-next-btn")?.addEventListener("click", () => {
    if (!isCurrentMonth) {
      calMonth++;
      if (calMonth > 11) { calMonth = 0; calYear++; }
      renderPnLCalendar();
    }
  });
}

/** 渲染持倉表 v2（Chance 風格）*/
function renderPositionsTable(filter = "") {
  const el = document.getElementById("positions-table");
  if (!el) return;

  const filtered = OPEN_POSITIONS.filter((p) =>
    !filter || p.market.toLowerCase().includes(filter.toLowerCase())
  );

  if (filtered.length === 0) {
    el.innerHTML = `<div class="pos-empty-state">No positions found</div>`;
    return;
  }

  const rows = filtered.map((p) => {
    const stake   = +(p.shares * p.avgEntry).toFixed(2);
    const value   = +(p.shares * p.current).toFixed(2);
    const pnl     = +(value - stake).toFixed(2);
    const pnlPct  = (((p.current - p.avgEntry) / p.avgEntry) * 100).toFixed(1);
    const expProfit = +(p.shares * (1 - p.avgEntry)).toFixed(2); // full win payout - stake
    const isUp    = pnl >= 0;

    return `
      <tr>
        <td>
          <div class="pos-market-cell">
            <div class="pos-platform-icon">P</div>
            <div>
              <div class="pos-market-name">${p.market}</div>
              <div class="pos-market-sub">
                <span class="pos-shares-label">${p.shares} shares</span>
                <span class="pos-side-badge ${p.side === "YES" ? "yes" : "no"}">${p.side}</span>
              </div>
            </div>
          </div>
        </td>
        <td class="pos-num">${(p.avgEntry * 100).toFixed(0)}¢</td>
        <td class="pos-num">${(p.current  * 100).toFixed(0)}¢</td>
        <td class="pos-num">${fmtUSD(stake)}</td>
        <td class="pos-num">+${fmtUSD(expProfit)}</td>
        <td>
          <div class="pos-val">${fmtUSD(value)}</div>
          <div class="pos-sub ${isUp ? "up" : "down"}">${isUp ? "+" : ""}${fmtUSD(pnl)} (${isUp ? "+" : ""}${pnlPct}%)</div>
        </td>
        <td>
          <button class="pos-sell-btn">Sell</button>
        </td>
      </tr>`;
  });

  el.innerHTML = `
    <table class="pos-table-v2">
      <thead>
        <tr>
          <th>Market</th>
          <th>Avg Entry</th>
          <th>Current</th>
          <th>Stake</th>
          <th>Expected Profit</th>
          <th>Value</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rows.join("")}</tbody>
    </table>`;
}

/** 初始化 Portfolio（Range 按鈕 + Tabs + Calendar toggle + 搜尋）*/
function initPortfolioView() {
  // 時間範圍按鈕
  document.querySelectorAll(".equity-range-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      equityRange = btn.dataset.range ?? "1M";
      document.querySelectorAll(".equity-range-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderEquityChart();
    });
  });

  // P&L Calendar 折疊切換
  document.getElementById("port-cal-toggle")?.addEventListener("click", () => {
    const sec = document.getElementById("port-calendar-section");
    const btn = document.getElementById("port-cal-toggle");
    if (!sec) return;
    const isOpen = sec.style.display !== "none";
    sec.style.display = isOpen ? "none" : "block";
    btn?.classList.toggle("cal-open", !isOpen);
    if (!isOpen) renderPnLCalendar();
  });

  // 持倉 Tabs（僅 UI 切換，demo 只有 positions）
  document.querySelectorAll(".port-pos-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".port-pos-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      // 僅 positions tab 有資料，其餘顯示空
      if (tab.dataset.tab === "positions") {
        renderPositionsTable();
      } else {
        const el = document.getElementById("positions-table");
        if (el) el.innerHTML = `<div class="pos-empty-state">No ${tab.dataset.tab} data in demo mode</div>`;
      }
    });
  });

  // 持倉搜尋
  document.getElementById("port-pos-search-input")?.addEventListener("input", (e) => {
    renderPositionsTable(e.target.value);
  });

  // 頭貼上傳
  const avatarEl    = document.getElementById("port-avatar");
  const avatarInput = document.getElementById("port-avatar-input");
  const avatarBtn   = document.getElementById("port-avatar-btn");

  const triggerAvatarUpload = () => avatarInput?.click();
  avatarEl?.addEventListener("click", triggerAvatarUpload);
  avatarBtn?.addEventListener("click", triggerAvatarUpload);

  avatarInput?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (!avatarEl) return;
      avatarEl.innerHTML = `<img src="${ev.target?.result}" alt="avatar"/>
        <input type="file" id="port-avatar-input" accept="image/*" style="display:none"/>`;
      avatarEl.querySelector("input")?.addEventListener("change", (e2) => {
        const f2 = e2.target.files?.[0];
        if (!f2) return;
        const r2 = new FileReader();
        r2.onload = (ev2) => {
          const img = avatarEl.querySelector("img");
          if (img) img.src = String(ev2.target?.result);
        };
        r2.readAsDataURL(f2);
      });
      avatarEl.onclick = () => avatarEl.querySelector("input")?.click();
    };
    reader.readAsDataURL(file);
  });

  // 暱稱 Enter 鍵取消焦點
  document.getElementById("port-nickname")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); e.target?.blur(); }
  });
}

/** 主入口：渲染整個 Portfolio 頁面 */
function renderPortfolioView() {
  initPortfolioView();
  renderPortfolioSummary();
  renderPortfolioStats();
  renderEquityChart();
  renderPositionsTable();
  // P&L Calendar 預設收起，點擊才展開
}

// ===== 登入 Modal =====
function initLoginModal() {
  const overlay   = document.getElementById("login-modal");
  const openBtn   = document.getElementById("btn-login");
  const closeBtn  = document.getElementById("login-close");
  const backBtn   = document.getElementById("login-back");

  const screens = {
    login    : document.getElementById("screen-login"),
    register : document.getElementById("screen-register"),
    forgot   : document.getElementById("screen-forgot"),
  };

  // ── 畫面切換 ──
  function showScreen(name) {
    Object.values(screens).forEach(s => { if (s) s.style.display = "none"; });
    if (screens[name]) screens[name].style.display = "block";
    if (backBtn) backBtn.style.display = (name === "login") ? "none" : "flex";
    if (name === "forgot") {
      const succ = document.getElementById("forgot-success");
      if (succ) succ.style.display = "none";
    }
  }

  const openModal  = () => { if (overlay) { overlay.style.display = "flex"; showScreen("login"); } };
  const closeModal = () => { if (overlay) overlay.style.display = "none"; };

  openBtn?.addEventListener("click", openModal);
  closeBtn?.addEventListener("click", closeModal);
  backBtn?.addEventListener("click",  () => showScreen("login"));

  // 背景點擊關閉
  overlay?.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay?.style.display === "flex") closeModal();
  });

  // ── 畫面跳轉連結 ──
  document.getElementById("go-register")?.addEventListener("click", (e) => { e.preventDefault(); showScreen("register"); });
  document.getElementById("go-login")?.addEventListener("click",    (e) => { e.preventDefault(); showScreen("login"); });
  document.getElementById("go-forgot")?.addEventListener("click",   (e) => { e.preventDefault(); showScreen("forgot"); });
  document.getElementById("go-login-from-forgot")?.addEventListener("click", (e) => { e.preventDefault(); showScreen("login"); });

  // ── 密碼顯示切換 ──
  function togglePw(toggleId, inputId) {
    document.getElementById(toggleId)?.addEventListener("click", () => {
      const inp = document.getElementById(inputId);
      if (!inp) return;
      const isText = inp.type === "text";
      inp.type = isText ? "password" : "text";
      const btn = document.getElementById(toggleId);
      btn?.querySelector(".eye-show")?.style.setProperty("display", isText ? "" : "none");
      btn?.querySelector(".eye-hide")?.style.setProperty("display", isText ? "none" : "");
    });
  }
  togglePw("login-pw-toggle", "login-password");
  togglePw("reg-pw-toggle",   "reg-password");

  // ── Email 登入（呼叫你的 API）──
  document.getElementById("btn-email-login")?.addEventListener("click", () => {
    const email    = document.getElementById("login-email")?.value.trim();
    const password = document.getElementById("login-password")?.value;
    if (!email || !password) return;
    // TODO: 接上你的後端 API
    console.log("[Login]", email);
  });

  // ── 註冊（呼叫你的 API）──
  document.getElementById("btn-email-register")?.addEventListener("click", () => {
    const email   = document.getElementById("reg-email")?.value.trim();
    const pw      = document.getElementById("reg-password")?.value;
    const confirm = document.getElementById("reg-confirm")?.value;
    if (!email || !pw || pw !== confirm) return;
    // TODO: 接上你的後端 API
    console.log("[Register]", email);
  });

  // ── 忘記密碼（呼叫你的 API）──
  document.getElementById("btn-send-reset")?.addEventListener("click", () => {
    const email = document.getElementById("forgot-email")?.value.trim();
    if (!email) return;
    // TODO: 接上你的後端 API
    console.log("[Reset]", email);
    const succ = document.getElementById("forgot-success");
    if (succ) succ.style.display = "flex";
  });

  // ── Google OAuth（替換為真實 URL）──
  document.getElementById("orb-google-login")?.addEventListener("click",    () => console.log("[Google Login]"));
  document.getElementById("orb-google-register")?.addEventListener("click", () => console.log("[Google Register]"));

  // ── X OAuth（替換為真實 URL）──
  document.getElementById("orb-x-login")?.addEventListener("click",    () => console.log("[X Login]"));
  document.getElementById("orb-x-register")?.addEventListener("click", () => console.log("[X Register]"));
}

// ===== 初始化 =====
document.addEventListener("DOMContentLoaded", () => {
  renderNews(NEWS_DATA);
  initFilters();
  initSearch();
  initWatchlistToggle();
  updateWatchlistBadge();
  renderTopTraders();
  startTradePolling();
  initNavigation();
  initSportsFilters();
  initCryptoFilters();
  initScrollableTabs("category-tabs");
  initLoginModal();
  // sports-league-tabs / crypto-asset-tabs 是垂直側欄，不需要滾動箭頭
  loadAll();              // 唯一 Events fetch 入口
});

/**
 * 為任何 tabs 容器加上左右箭頭按鈕，支援點擊捲動。
 * 使用 MutationObserver 監測 tab 增減，自動更新箭頭狀態。
 */
function initScrollableTabs(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // 建立 wrapper 替換原有 container 位置
  const wrapper = document.createElement("div");
  wrapper.className = "tabs-scroll-wrapper";
  container.parentNode.insertBefore(wrapper, container);
  wrapper.appendChild(container);

  const prevBtn = document.createElement("button");
  prevBtn.className = "tabs-arrow tabs-arrow-prev";
  prevBtn.innerHTML = "&#8249;"; // ‹
  prevBtn.setAttribute("aria-label", "Scroll tabs left");

  const nextBtn = document.createElement("button");
  nextBtn.className = "tabs-arrow tabs-arrow-next";
  nextBtn.innerHTML = "&#8250;"; // ›
  nextBtn.setAttribute("aria-label", "Scroll tabs right");

  wrapper.insertBefore(prevBtn, container);
  wrapper.appendChild(nextBtn);

  const SCROLL_STEP = 220;

  prevBtn.addEventListener("click", () =>
    container.scrollBy({ left: -SCROLL_STEP, behavior: "smooth" })
  );
  nextBtn.addEventListener("click", () =>
    container.scrollBy({ left: SCROLL_STEP, behavior: "smooth" })
  );

  function updateArrows() {
    const atStart = container.scrollLeft <= 2;
    const atEnd   = container.scrollLeft + container.clientWidth >= container.scrollWidth - 2;
    prevBtn.style.opacity  = atStart ? "0.3" : "1";
    prevBtn.style.pointerEvents = atStart ? "none" : "";
    nextBtn.style.opacity  = atEnd ? "0.3" : "1";
    nextBtn.style.pointerEvents = atEnd ? "none" : "";
  }

  container.addEventListener("scroll", updateArrows, { passive: true });

  // tab 內容更新時自動重算（buildTabs / buildSportsLeagueTabs 會觸發）
  new MutationObserver(updateArrows).observe(container, { childList: true });

  updateArrows();
}

// ═══════════════════════════════════════════════════
// ===== INTEL / GLOBAL THREAT MAP (Globe.gl) =====
// ═══════════════════════════════════════════════════

/** @type {object|null} Globe.gl instance */
let threatGlobe = null;

let activeThreatLevel = "all";
let activeThreatCat   = "all";

/**
 * @typedef {{ id:number, title:string, location:string, lat:number, lng:number,
 *   level:'critical'|'high'|'medium'|'low', category:string, time:string, description:string }} ThreatEvent
 */

/** @type {ThreatEvent[]} */
const THREAT_EVENTS = [
  { id:1,  title:"Frontline Artillery Exchange",       location:"Zaporizhzhia, Ukraine",      lat:47.84, lng:35.14, level:"critical", category:"conflict",   time:"18m ago",  description:"Heavy shelling reported along 40 km front. Three villages ordered to evacuate." },
  { id:2,  title:"Ceasefire Talks Collapse",           location:"Khartoum, Sudan",            lat:15.50, lng:32.56, level:"critical", category:"conflict",   time:"1h ago",   description:"SAF–RSF negotiations break down. Fighting resumes across Omdurman district." },
  { id:3,  title:"Ballistic Missile Launch Detected",  location:"North Korea",                lat:39.03, lng:125.75,level:"critical", category:"military",   time:"2h ago",   description:"ICBM-class launch detected by US Indo-Pacific Command. Fell into Sea of Japan." },
  { id:4,  title:"Suicide Bombing — Market District",  location:"Mogadishu, Somalia",         lat:2.05,  lng:45.34, level:"critical", category:"terrorism",  time:"3h ago",   description:"Al-Shabaab claims responsibility. 14 killed, 29 wounded." },
  { id:5,  title:"Naval Stand-off in Disputed Waters", location:"South China Sea",            lat:15.20, lng:114.30,level:"high",     category:"military",   time:"2h ago",   description:"PLA Coast Guard vessels water-cannon Philippine resupply vessel near Scarborough Shoal." },
  { id:6,  title:"Mass Anti-Government Protests",      location:"Tbilisi, Georgia",           lat:41.69, lng:44.80, level:"high",     category:"protest",    time:"4h ago",   description:"Estimated 80,000 march on parliament demanding snap elections." },
  { id:7,  title:"Infrastructure Cyberattack",         location:"Frankfurt, Germany",         lat:50.11, lng:8.68,  level:"high",     category:"cyber",      time:"5h ago",   description:"Critical energy grid operator reports coordinated intrusion. Power disruptions in three states." },
  { id:8,  title:"Earthquake Magnitude 6.3",           location:"Herat, Afghanistan",         lat:34.35, lng:62.20, level:"high",     category:"disaster",   time:"3h ago",   description:"Strong quake collapses dozens of buildings. Rescue operations underway." },
  { id:9,  title:"Oil Pipeline Sabotage",              location:"Niger Delta, Nigeria",       lat:5.33,  lng:6.45,  level:"high",     category:"conflict",   time:"6h ago",   description:"Armed group destroys 2 km section of Trans-Niger Pipeline. Spill ongoing." },
  { id:10, title:"Coup Attempt Suppressed",            location:"Naypyidaw, Myanmar",         lat:19.75, lng:96.13, level:"high",     category:"military",   time:"7h ago",   description:"Military faction loyal to ousted general seized state broadcaster for 4 hours before being repelled." },
  { id:11, title:"Cross-Border Drone Strike",          location:"Southern Lebanon",           lat:33.27, lng:35.57, level:"high",     category:"military",   time:"8h ago",   description:"IDF drones target weapons depot near Nabatieh. Hezbollah confirms casualties." },
  { id:12, title:"Armed Group Seizes Border Post",     location:"Eastern DRC",                lat:-0.52, lng:29.23, level:"high",     category:"conflict",   time:"9h ago",   description:"M23 rebels capture Bunagana crossing, cutting supply route to North Kivu." },
  { id:13, title:"Typhoon Landfall Warning Cat.4",     location:"Luzon, Philippines",         lat:16.00, lng:121.00,level:"high",     category:"disaster",   time:"4h ago",   description:"Typhoon Maria expected to make landfall in 12 hours. 500,000 under evacuation order." },
  { id:14, title:"General Strike Paralyzes Capital",   location:"Buenos Aires, Argentina",    lat:-34.60,lng:-58.38,level:"medium",   category:"protest",    time:"10h ago",  description:"Unions shut down transport and public services over austerity measures." },
  { id:15, title:"Diplomatic Expulsions Announced",    location:"Moscow, Russia",             lat:55.75, lng:37.62, level:"medium",   category:"diplomatic", time:"11h ago",  description:"Russia expels 18 EU diplomats. Brussels confirms reciprocal measures." },
  { id:16, title:"Emergency Sanctions Package",        location:"Tehran, Iran",               lat:35.69, lng:51.39, level:"medium",   category:"economic",   time:"12h ago",  description:"G7 announces new sanctions targeting Iran's petroleum exports and central bank." },
  { id:17, title:"Border Incursion Reported",          location:"Nagorno-Karabakh",           lat:39.95, lng:46.75, level:"medium",   category:"conflict",   time:"13h ago",  description:"Azerbaijan forces cross buffer zone; OSCE monitoring mission put on alert." },
  { id:18, title:"Data Breach — Defense Contractor",   location:"Seoul, South Korea",         lat:37.57, lng:126.98,level:"medium",   category:"cyber",      time:"14h ago",  description:"Classified procurement data of ROK Defense Ministry contractor leaked online." },
  { id:19, title:"Wildfire Emergency Declared",        location:"California, USA",            lat:34.05, lng:-118.24,level:"medium",  category:"disaster",   time:"6h ago",   description:"Fast-moving fire consumes 12,000 acres. Interstate 5 closed; air quality critical." },
  { id:20, title:"Trade War Tariff Escalation",        location:"Washington D.C., USA",       lat:38.91, lng:-77.04, level:"low",     category:"economic",   time:"15h ago",  description:"White House announces 25% tariffs on all Chinese semiconductor imports effective next month." },
];

function getThreatColor(level) {
  return { critical:"#ef4444", high:"#f97316", medium:"#eab308", low:"#22c55e" }[level] ?? "#6366f1";
}

function getThreatPointRadius(level) {
  return { critical:0.7, high:0.55, medium:0.42, low:0.3 }[level] ?? 0.35;
}

function buildThreatLabel(ev) {
  const color = getThreatColor(ev.level);
  return `<div style="background:#1a1a24;border:1px solid #2a2a38;border-radius:10px;padding:12px 14px;max-width:240px;font-family:Inter,sans-serif;pointer-events:none">
    <div style="font-size:10px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">${ev.level}</div>
    <div style="font-size:13px;font-weight:600;color:#e8e8f0;margin-bottom:4px;line-height:1.4">${ev.title}</div>
    <div style="font-size:11px;color:#8888a8;margin-bottom:6px">📍 ${ev.location} · ${ev.time}</div>
    <div style="font-size:11px;color:#a8a8c8;line-height:1.5">${ev.description}</div>
  </div>`;
}

function loadIntelView() {
  updateThreatStats(THREAT_EVENTS);
  // RAF ensures the view's layout (width/height) is fully calculated before Globe.gl reads it
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      initThreatGlobe();
    });
  });
  renderThreatEvents(THREAT_EVENTS);
  initThreatFilters();
}

// ── 事件所在國家對照表（用於地圖高亮）──
const LOCATION_TO_COUNTRY = {
  "Ukraine":          "Ukraine",
  "Sudan":            "Sudan",
  "North Korea":      "North Korea",
  "Somalia":          "Somalia",
  "Georgia":          "Georgia",
  "Germany":          "Germany",
  "Afghanistan":      "Afghanistan",
  "Nigeria":          "Nigeria",
  "Myanmar":          "Myanmar",
  "Lebanon":          "Lebanon",
  "Eastern DRC":      "Democratic Republic of the Congo",
  "Philippines":      "Philippines",
  "Argentina":        "Argentina",
  "Russia":           "Russia",
  "Iran":             "Iran",
  "Nagorno-Karabakh": "Azerbaijan",
  "South Korea":      "South Korea",
  "California":       "United States of America",
  "Washington D.C":   "United States of America",
};

function buildCountryThreatMap() {
  const priority = { critical: 4, high: 3, medium: 2, low: 1 };
  const map = {};
  THREAT_EVENTS.forEach((ev) => {
    for (const [key, country] of Object.entries(LOCATION_TO_COUNTRY)) {
      if (ev.location.includes(key)) {
        if (!map[country] || priority[ev.level] > priority[map[country]]) {
          map[country] = ev.level;
        }
        break;
      }
    }
  });
  return map;
}

// ── 主要國家標籤資料（lat/lng 為地圖中心點）──
const GLOBE_COUNTRY_LABELS = [
  { name: "USA",           lat: 39.5,   lng: -98.4,   sz: 0.55 },
  { name: "Canada",        lat: 60.0,   lng: -96.0,   sz: 0.50 },
  { name: "Brazil",        lat: -10.0,  lng: -52.0,   sz: 0.52 },
  { name: "Mexico",        lat: 23.6,   lng: -102.5,  sz: 0.40 },
  { name: "Argentina",     lat: -34.0,  lng: -64.0,   sz: 0.40 },
  { name: "UK",            lat: 54.0,   lng: -2.0,    sz: 0.32 },
  { name: "France",        lat: 46.2,   lng: 2.2,     sz: 0.35 },
  { name: "Germany",       lat: 51.2,   lng: 10.5,    sz: 0.35 },
  { name: "Ukraine",       lat: 49.0,   lng: 32.0,    sz: 0.38 },
  { name: "Russia",        lat: 62.0,   lng: 95.0,    sz: 0.65 },
  { name: "Turkey",        lat: 39.0,   lng: 35.0,    sz: 0.38 },
  { name: "Iran",          lat: 32.0,   lng: 53.7,    sz: 0.42 },
  { name: "Saudi Arabia",  lat: 24.0,   lng: 45.0,    sz: 0.40 },
  { name: "Israel",        lat: 31.5,   lng: 34.8,    sz: 0.25 },
  { name: "Lebanon",       lat: 33.9,   lng: 35.9,    sz: 0.22 },
  { name: "Syria",         lat: 34.8,   lng: 38.8,    sz: 0.28 },
  { name: "India",         lat: 20.0,   lng: 78.0,    sz: 0.52 },
  { name: "China",         lat: 35.0,   lng: 103.0,   sz: 0.58 },
  { name: "North Korea",   lat: 40.3,   lng: 127.5,   sz: 0.30 },
  { name: "South Korea",   lat: 36.5,   lng: 127.8,   sz: 0.30 },
  { name: "Japan",         lat: 36.0,   lng: 138.0,   sz: 0.38 },
  { name: "Pakistan",      lat: 30.0,   lng: 70.0,    sz: 0.40 },
  { name: "Afghanistan",   lat: 33.9,   lng: 67.7,    sz: 0.35 },
  { name: "Myanmar",       lat: 19.0,   lng: 96.7,    sz: 0.32 },
  { name: "Philippines",   lat: 12.0,   lng: 122.0,   sz: 0.35 },
  { name: "Indonesia",     lat: -2.0,   lng: 118.0,   sz: 0.48 },
  { name: "Australia",     lat: -25.0,  lng: 133.0,   sz: 0.55 },
  { name: "Nigeria",       lat: 9.1,    lng: 8.7,     sz: 0.38 },
  { name: "Sudan",         lat: 12.9,   lng: 30.0,    sz: 0.38 },
  { name: "Egypt",         lat: 26.0,   lng: 30.0,    sz: 0.38 },
  { name: "Ethiopia",      lat: 9.0,    lng: 40.0,    sz: 0.35 },
  { name: "DRC",           lat: -4.0,   lng: 24.0,    sz: 0.38 },
  { name: "Somalia",       lat: 5.2,    lng: 46.0,    sz: 0.30 },
  { name: "South Africa",  lat: -30.0,  lng: 25.0,    sz: 0.40 },
  { name: "Libya",         lat: 26.3,   lng: 17.2,    sz: 0.38 },
  { name: "Mali",          lat: 17.6,   lng: -1.5,    sz: 0.35 },
  { name: "Georgia",       lat: 42.3,   lng: 43.4,    sz: 0.25 },
  { name: "Azerbaijan",    lat: 40.1,   lng: 47.6,    sz: 0.25 },
  { name: "Yemen",         lat: 15.6,   lng: 48.0,    sz: 0.30 },
  { name: "Venezuela",     lat: 6.4,    lng: -66.6,   sz: 0.35 },
];

async function initThreatGlobe() {
  if (threatGlobe) return;
  const container = document.getElementById("threat-map");
  if (!container || typeof Globe === "undefined") return;

  const w = container.clientWidth  || 800;
  const h = container.clientHeight || 480;
  const ringEvents = THREAT_EVENTS.filter((e) => e.level === "critical" || e.level === "high");

  // 先初始化地球儀，讓標記立即顯示
  threatGlobe = Globe({ animateIn: true })(container)
    .width(w).height(h)
    .globeImageUrl("//unpkg.com/three-globe/example/img/earth-night.jpg")
    .bumpImageUrl("//unpkg.com/three-globe/example/img/earth-topology.png")
    .backgroundColor("#0a0a10")
    .showAtmosphere(true)
    .atmosphereColor("#6366f1")
    .atmosphereAltitude(0.13)
    .pointsData(THREAT_EVENTS)
    .pointLat("lat").pointLng("lng")
    .pointColor((d) => getThreatColor(d.level))
    .pointRadius((d) => getThreatPointRadius(d.level))
    .pointAltitude(0.015)
    .pointLabel((d) => buildThreatLabel(d))
    .onPointClick((d) => {
      threatGlobe.pointOfView({ lat: d.lat, lng: d.lng, altitude: 1.6 }, 1200);
      highlightThreatCard(d.id);
    })
    .ringsData(ringEvents)
    .ringLat("lat").ringLng("lng")
    .ringColor((d) => {
      const rgb = d.level === "critical" ? "239,68,68" : "249,115,22";
      return (t) => `rgba(${rgb},${1 - t})`;
    })
    .ringMaxRadius(3.5).ringPropagationSpeed(1.5)
    .ringRepeatPeriod(1000).ringAltitude(0.005);

  threatGlobe.controls().autoRotate = false;
  threatGlobe.pointOfView({ lat: 25, lng: 20, altitude: 1.8 });

  const ro = new ResizeObserver(() => {
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (threatGlobe && cw > 0 && ch > 0) threatGlobe.width(cw).height(ch);
  });
  ro.observe(container);

  // 非同步載入國家邊界 + 標籤（載入後自動疊加）
  try {
    const geoData = await fetch(
      "https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson"
    ).then((r) => r.json());

    const countryThreatMap = buildCountryThreatMap();
    const threatFillColors = {
      critical: "rgba(239,68,68,0.14)",
      high:     "rgba(249,115,22,0.11)",
      medium:   "rgba(234,179,8,0.08)",
      low:      "rgba(34,197,94,0.06)",
    };

    threatGlobe
      // 國家邊界多邊形
      .polygonsData(geoData.features)
      .polygonCapColor((feat) => {
        const level = countryThreatMap[feat.properties.name];
        return level ? threatFillColors[level] : "rgba(180,210,255,0.025)";
      })
      .polygonSideColor(() => "transparent")
      .polygonStrokeColor(() => "rgba(100,140,220,0.28)")
      .polygonAltitude(0.001)
      .polygonLabel(() => "")
      // 國家名稱標籤
      .labelsData(GLOBE_COUNTRY_LABELS)
      .labelLat((d) => d.lat)
      .labelLng((d) => d.lng)
      .labelText((d) => d.name)
      .labelSize((d) => d.sz)
      .labelDotRadius(0)
      .labelColor(() => "rgba(180,210,255,0.55)")
      .labelResolution(3)
      .labelAltitude(0.006);
  } catch (e) {
    console.warn("Globe country data load failed:", e);
  }
}

function highlightThreatCard(id) {
  const container = document.getElementById("threat-events-list");
  if (!container) return;
  container.querySelectorAll(".threat-event-card").forEach((c) => c.classList.remove("active-card"));
  const card = container.querySelector(`[data-id="${id}"]`);
  if (card) {
    card.classList.add("active-card");
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function renderThreatEvents(events) {
  const container = document.getElementById("threat-events-list");
  if (!container) return;

  if (events.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:32px;color:var(--text-muted)">No events match the current filters</div>`;
    return;
  }

  container.innerHTML = events.map((ev) => `
    <div class="threat-event-card" data-id="${ev.id}">
      <div class="threat-card-top">
        <span class="threat-level-badge ${ev.level}">${ev.level}</span>
        <span class="threat-card-title">${ev.title}</span>
      </div>
      <div class="threat-card-desc">${ev.description}</div>
      <div class="threat-card-meta">
        <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
        ${ev.location}
        <span style="color:var(--border-light)">·</span>
        ${ev.time}
        <span class="threat-cat-tag">${ev.category}</span>
      </div>
    </div>
  `).join("");

  container.querySelectorAll(".threat-event-card").forEach((card) => {
    card.addEventListener("click", () => {
      const ev = THREAT_EVENTS.find((e) => e.id === Number(card.dataset.id));
      if (!ev) return;
      if (threatGlobe) {
        threatGlobe.pointOfView({ lat: ev.lat, lng: ev.lng, altitude: 1.6 }, 1200);
      }
      highlightThreatCard(ev.id);
    });
  });
}

function updateThreatStats(events) {
  const count = (level) => events.filter((e) => e.level === level).length;
  const setEl = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  setEl("threat-stat-critical", `${count("critical")} Critical`);
  setEl("threat-stat-high",     `${count("high")} High`);
  setEl("threat-stat-medium",   `${count("medium")} Medium`);
}

function getFilteredThreatEvents() {
  return THREAT_EVENTS.filter((ev) => {
    const levelOk = activeThreatLevel === "all" || ev.level === activeThreatLevel;
    const catOk   = activeThreatCat   === "all" || ev.category === activeThreatCat;
    return levelOk && catOk;
  });
}

function applyThreatFilters() {
  const filtered = getFilteredThreatEvents();
  renderThreatEvents(filtered);
  updateThreatStats(filtered);

  if (!threatGlobe) return;
  const ringFiltered = filtered.filter((e) => e.level === "critical" || e.level === "high");
  threatGlobe.pointsData(filtered).ringsData(ringFiltered);
}

function initThreatFilters() {
  const sidebar = document.querySelector("#view-intel .sports-sidebar-inner");
  if (!sidebar) return;

  sidebar.querySelectorAll("[data-level]").forEach((btn) => {
    btn.addEventListener("click", () => {
      sidebar.querySelectorAll("[data-level]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activeThreatLevel = btn.dataset.level ?? "all";
      applyThreatFilters();
    });
  });

  sidebar.querySelectorAll("[data-cat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      sidebar.querySelectorAll("[data-cat]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activeThreatCat = btn.dataset.cat ?? "all";
      applyThreatFilters();
    });
  });
}
