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

  const icon    = ev.image || ev.icon || markets[0]?.image || "";
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

  const evId     = String(ev.id || "");
  const isTrend  = trendingIds.has(evId);
  const isStarred = wlHas(evId);

  card.innerHTML = `
    <div class="market-header">
      <img class="market-icon" src="${icon}" alt=""
        onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2244%22 height=%2244%22><rect width=%2244%22 height=%2244%22 rx=%2210%22 fill=%22%231e1e2a%22/><text x=%2222%22 y=%2228%22 text-anchor=%22middle%22 fill=%22%236366f1%22 font-size=%2218%22>P</text></svg>'"/>
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
  const icon    = parentEvent?.image || m.image || m.icon || "";
  const isYes   = yesPct >= 50;

  const evId     = String(parentEvent?.id || m.id || "");
  const isTrend  = trendingIds.has(evId);
  const isStarred = wlHas(evId);

  card.innerHTML = `
    <div class="market-header">
      <img class="market-icon" src="${icon}" alt=""
        onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2244%22 height=%2244%22><rect width=%2244%22 height=%2244%22 rx=%2210%22 fill=%22%231e1e2a%22/><text x=%2222%22 y=%2228%22 text-anchor=%22middle%22 fill=%22%236366f1%22 font-size=%2218%22>P</text></svg>'"/>
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
  // 先顯示 Skeleton Loading 動畫
  renderSkeletons(9);
  buildTabs([]);             // 先建立只有 All 的 tab
  simulateLiveTrades();
  setApiStatus("loading", "連接中...");

  // 嘗試取得真實事件資料
  try {
    const events = await fetchEvents();
    if (events && events.length > 0) {
      cachedEvents  = events;
      cachedMarkets = events.flatMap((ev) => ev.markets || [ev]);
      liveMarketNames = events.slice(0, 10)
        .map((ev) => ev.title || ev.markets?.[0]?.question || "")
        .filter(Boolean);
      computeTrending(events);
      updateStatsBar(events);
      buildTabs(events);     // 重建含所有 tag 的 tabs
      renderMarkets(events);
      setApiStatus("live", "即時數據 · Polymarket");
    }
  } catch (err) {
    setApiStatus("error", "顯示備用數據");
  }

  // 交易資料（獨立，不影響主流程）
  try {
    const trades = await fetchTrades();
    if (trades && trades.length > 0) renderTrades(trades);
  } catch (_) {}
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
function parseOutcomePrices(raw) {
  if (Array.isArray(raw)) return raw.map(Number);
  if (typeof raw === "string") {
    try { return JSON.parse(raw).map(Number); } catch (_) {}
  }
  return [0.5, 0.5];
}

// ===== 從 events 提取所有 tags，按出現次數排序 =====
function extractTags(events) {
  const tagMap = new Map(); // id → { id, label, count }
  events.forEach((ev) => {
    (ev.tags || []).forEach((t) => {
      if (!t.id || !t.label) return;
      if (tagMap.has(t.id)) {
        tagMap.get(t.id).count++;
      } else {
        tagMap.set(t.id, { id: String(t.id), label: t.label, slug: t.slug || "", count: 1 });
      }
    });
  });
  return [...tagMap.values()].sort((a, b) => b.count - a.count);
}

// ===== 動態生成分類 Tabs =====
function buildTabs(events) {
  const container = document.getElementById("category-tabs");
  if (!container) return;

  const tags = extractTags(events);

  // 清除舊的（保留 All）
  container.innerHTML = `<button class="tab active" data-tag-id="all">All</button>`;

  tags.forEach((t) => {
    const btn = document.createElement("button");
    btn.className  = "tab";
    btn.dataset.tagId = t.id;
    btn.textContent   = t.label;
    container.appendChild(btn);
  });

  // 掛點擊事件
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

// ===== 免責聲明 Modal =====
function initModal() {
  const modal     = document.getElementById("disclaimer-modal");
  const acceptBtn = document.getElementById("modal-accept");
  const declineBtn = document.getElementById("modal-decline");
  if (sessionStorage.getItem("disclaimer-accepted")) {
    modal.classList.add("hidden");
    return;
  }
  acceptBtn.addEventListener("click", () => {
    sessionStorage.setItem("disclaimer-accepted", "true");
    modal.classList.add("hidden");
  });
  declineBtn.addEventListener("click", () => {
    setTimeout(() => { window.location.href = "https://www.google.com"; }, 300);
  });
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
  const navBtn = document.getElementById("btn-watchlist-nav");
  const handler = () => {
    showWatchlistOnly = !showWatchlistOnly;
    btn?.classList.toggle("wl-active", showWatchlistOnly);
    navBtn?.classList.toggle("active", showWatchlistOnly);
    applyCurrentFilters();
  };
  btn?.addEventListener("click", handler);
  navBtn?.addEventListener("click", handler);
}

function applyCurrentFilters() {
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
const SPORTS_LEAGUES = [
  { id: "all",      label: "🏆 All Sports"  },
  // 球類運動
  { id: "soccer",   label: "⚽ Soccer"       },
  { id: "epl",      label: "⚽ EPL"          },
  { id: "ucl",      label: "⚽ UCL"          },
  { id: "bundesliga", label: "⚽ Bundesliga" },
  { id: "seriea",   label: "⚽ Serie A"      },
  { id: "laliga",   label: "⚽ La Liga"      },
  { id: "ligue1",   label: "⚽ Ligue 1"      },
  { id: "nba",      label: "🏀 NBA"          },
  { id: "ncaab",    label: "🏀 NCAAB"        },
  { id: "nfl",      label: "🏈 NFL/CFB"      },
  { id: "nhl",      label: "🏒 NHL"          },
  { id: "mlb",      label: "⚾ MLB"          },
  { id: "ufc",      label: "🥊 UFC/MMA"      },
  { id: "tennis",   label: "🎾 Tennis"       },
  { id: "golf",     label: "⛳ Golf"         },
  { id: "cricket",  label: "🏏 Cricket"      },
  { id: "formula1", label: "🏎 F1"           },
  { id: "esports",  label: "🎮 Esports"      },
  { id: "rugby",    label: "🏉 Rugby"        },
  { id: "other",    label: "🏅 Other"        },
];

/** 關鍵字匹配，用於從 event title / tags 判斷聯賽 */
const SPORTS_LEAGUE_PATTERNS = {
  soccer:     /\bsoccer\b|\bfootball\b(?!.*nfl|.*cfb|.*american)/i,
  epl:        /premier league|\bepl\b/i,
  ucl:        /champions league|\bucl\b|\buefa\b/i,
  bundesliga: /bundesliga/i,
  seriea:     /\bserie a\b/i,
  laliga:     /\bla liga\b/i,
  ligue1:     /\bligue 1\b/i,
  nba:        /\bnba\b/i,
  ncaab:      /\bncaab\b|college basketball/i,
  nfl:        /\bnfl\b|super bowl|\bcfb\b|college football/i,
  nhl:        /\bnhl\b|stanley cup/i,
  mlb:        /\bmlb\b|world series|\bkbo\b|\bwbc\b/i,
  ufc:        /\bufc\b|\bmma\b|zuffa/i,
  tennis:     /tennis|wimbledon|us open|french open|australian open|\batp\b|\bwta\b/i,
  golf:       /golf|\bmasters\b|\bpga\b|\blpga\b/i,
  cricket:    /cricket|\bipl\b|\bicc\b|\bbbl\b|\bpsl\b/i,
  formula1:   /formula.?1|\bf1\b|grand prix/i,
  esports:    /esport|\bcs2\b|\bcounter.strike\b|\bcs:go\b|\bdota\b|\bvalorant\b|\blol\b|\bleague of legends\b|\boverwatch\b|\brocket league\b|\bcall of duty\b/i,
  rugby:      /rugby|six nations|super rugby|premiership rugby|top 14/i,
};

let cachedSportsEvents = [];
let sportsOrder = "volume24hr";
let sportsLeague = "all";

/** 判斷一個 event 屬於哪個聯賽（回傳 league id 陣列）*/
function detectLeagues(ev) {
  const text = [
    ev.title || "",
    ev.description || "",
    ...(ev.tags || []).map((t) => t.label || t.slug || ""),
  ].join(" ");
  return Object.entries(SPORTS_LEAGUE_PATTERNS)
    .filter(([, rx]) => rx.test(text))
    .map(([id]) => id);
}

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

/** 建立聯賽 Tabs（只顯示有資料的聯賽）*/
function buildSportsLeagueTabs(events) {
  const container = document.getElementById("sports-league-tabs");
  if (!container) return;

  if (events.length === 0) {
    container.innerHTML = `<button class="tab active" data-league="all">🏆 All Sports</button>`;
    container.querySelector(".tab").addEventListener("click", () => {});
    return;
  }

  // 計算每個 league 有多少事件
  const counts = {};
  events.forEach((ev) => {
    const found = detectLeagues(ev);
    (found.length ? found : ["other"]).forEach((id) => {
      counts[id] = (counts[id] || 0) + 1;
    });
  });

  // 只顯示有資料的 tab，"All" 永遠顯示
  const visibleTabs = SPORTS_LEAGUES.filter(
    (l) => l.id === "all" || (counts[l.id] && counts[l.id] > 0)
  );

  // 若目前選中的 league 已沒有資料，重置為 all
  if (sportsLeague !== "all" && !counts[sportsLeague]) {
    sportsLeague = "all";
  }

  container.innerHTML = visibleTabs.map((l) => {
    const cnt = l.id === "all" ? events.length : (counts[l.id] || 0);
    const active = l.id === sportsLeague ? " active" : "";
    return `<button class="tab${active}" data-league="${l.id}">${l.label}<span class="tab-count">${cnt}</span></button>`;
  }).join("");

  container.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      sportsLeague = btn.dataset.league;
      container.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      btn.classList.add("active");
      renderSportsMarkets();
    });
  });
}

/** 篩選 + 排序後渲染體育市場列表 */
function renderSportsMarkets() {
  const container = document.getElementById("sports-markets-list");
  if (!container) return;

  let events = cachedSportsEvents;
  if (sportsLeague !== "all") {
    events = events.filter((ev) => detectLeagues(ev).includes(sportsLeague));
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

/** 載入並初始化 Sports 視圖 */
async function loadSportsView() {
  setSportsStatus("loading", "連接中...");
  const list = document.getElementById("sports-markets-list");
  if (list) {
    list.style.display = "grid";
    list.style.gridTemplateColumns = "repeat(3, 1fr)";
    list.style.gap = "10px";
    list.innerHTML = skeletonHTML(12);
  }

  // 先顯示空的 tabs
  buildSportsLeagueTabs([]);

  try {
    const events = await fetchSportsEvents();
    if (events.length === 0) throw new Error("empty");
    cachedSportsEvents = events;
    setSportsStatus("live", `即時數據 · ${events.length.toLocaleString()} markets`);
    buildSportsLeagueTabs(events);
    renderSportsMarkets();
  } catch (err) {
    console.warn("[Sports] fetchSportsEvents failed:", err);
    // 備援：從主頁已快取的事件中，以關鍵字篩選體育類
    const fallback = cachedEvents.filter((ev) => {
      const text = (ev.title || "") + " " + (ev.tags || []).map((t) => t.label || "").join(" ");
      return /sports|epl|nba|nfl|ucl|ufc|tennis|golf|cricket|formula|soccer|football|basketball|esport|cs2|dota|valorant|nhl|mlb/i.test(text);
    });
    cachedSportsEvents = fallback;
    setSportsStatus(
      fallback.length ? "simulated" : "error",
      fallback.length ? `備用數據 · ${fallback.length} markets` : "無法載入"
    );
    buildSportsLeagueTabs(fallback);
    renderSportsMarkets();
  }
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

// ===== 視圖切換（Events / Sports）=====
let currentView = "events";
let sportsLoaded = false;
let portfolioLoaded = false;

function switchView(view) {
  currentView = view;
  ["view-events", "view-sports", "view-portfolio"].forEach((id) =>
    document.getElementById(id)?.style.setProperty("display", "none")
  );
  ["nav-events", "nav-sports", "nav-portfolio"].forEach((id) =>
    document.getElementById(id)?.classList.remove("active")
  );

  // Portfolio 全寬（隱藏側邊欄）
  const grid    = document.querySelector(".content-grid");
  const sidebar = document.querySelector(".sidebar");
  if (view === "portfolio") {
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
    document.getElementById("nav-portfolio")?.classList.add("active");
    if (!portfolioLoaded) { portfolioLoaded = true; renderPortfolioView(); }
  } else {
    document.getElementById("view-events")?.style.setProperty("display", "block");
    document.getElementById("nav-events")?.classList.add("active");
  }
}

function initNavigation() {
  ["events", "sports", "portfolio"].forEach((view) => {
    document.getElementById(`nav-${view}`)?.addEventListener("click", (e) => {
      e.preventDefault();
      switchView(view);
    });
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
  const total = EQUITY_DATA.at(-1).value;
  const start = EQUITY_DATA[0].value;
  const gain  = total - start;
  const unrealized = OPEN_POSITIONS.reduce((s, p) => s + p.shares * (p.current - p.avgEntry), 0);
  const realized   = gain - unrealized;
  const posValue   = OPEN_POSITIONS.reduce((s, p) => s + p.shares * p.current, 0);
  return {
    total:      +total.toFixed(2),
    balance:    +Math.max(0, total - posValue).toFixed(2),
    unrealized: +unrealized.toFixed(2),
    realized:   +realized.toFixed(2),
  };
})();

let equityRange = "1M";
let _eqState = null; // 給 hover handler 用

/** 渲染統計卡片 */
function renderPortfolioStats() {
  const el = document.getElementById("portfolio-stats");
  if (!el) return;
  const s = PORT_STATS;
  const totalGain = s.total - EQUITY_DATA[0].value;
  const gainPct   = ((totalGain / EQUITY_DATA[0].value) * 100).toFixed(2);

  const card = (label, val, sub, dir) => `
    <div class="port-stat-card">
      <div class="port-stat-label">${label}</div>
      <div class="port-stat-value">${val}</div>
      ${sub ? `<div class="port-stat-sub ${dir === 1 ? "up" : dir === -1 ? "down" : ""}">${sub}</div>` : ""}
    </div>`;

  el.innerHTML = [
    card("Total Assets",     fmtUSD(s.total),
      `${totalGain >= 0 ? "+" : ""}${fmtUSD(totalGain)} (${totalGain >= 0 ? "+" : ""}${gainPct}%) all time`,
      totalGain >= 0 ? 1 : -1),
    card("Available Balance", fmtUSD(s.balance), "Ready to trade"),
    card("Unrealized P&L",   `${s.unrealized >= 0 ? "+" : ""}${fmtUSD(s.unrealized)}`,
      "From open positions", s.unrealized >= 0 ? 1 : -1),
    card("Realized P&L",     `${s.realized >= 0 ? "+" : ""}${fmtUSD(s.realized)}`,
      "Settled trades", s.realized >= 0 ? 1 : -1),
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

/** 渲染持倉表 */
function renderPositionsTable() {
  const el = document.getElementById("positions-table");
  if (!el) return;

  const rows = OPEN_POSITIONS.map((p) => {
    const pnl    = p.shares * (p.current - p.avgEntry);
    const pnlPct = (((p.current - p.avgEntry) / p.avgEntry) * 100).toFixed(1);
    const isUp   = pnl >= 0;
    return `
      <tr class="pos-row">
        <td class="pos-market">${p.market}</td>
        <td><span class="pos-side ${p.side === "YES" ? "yes" : "no"}">${p.side}</span></td>
        <td class="pos-num">${p.shares}</td>
        <td class="pos-num">${(p.avgEntry * 100).toFixed(0)}¢</td>
        <td class="pos-num">${(p.current * 100).toFixed(0)}¢</td>
        <td class="pos-num ${isUp ? "profit" : "loss"}">
          ${isUp ? "+" : ""}${fmtUSD(pnl)}
          <span class="pos-pct">${isUp ? "+" : ""}${pnlPct}%</span>
        </td>
        <td class="pos-end">${p.endDate}</td>
      </tr>`;
  });

  el.innerHTML = `
    <table class="pos-table">
      <thead>
        <tr>
          <th>Market</th><th>Side</th><th>Shares</th>
          <th>Avg Entry</th><th>Current</th><th>P&L</th><th>Closes</th>
        </tr>
      </thead>
      <tbody>${rows.join("")}</tbody>
    </table>`;
}

/** 初始化 Portfolio（Range 按鈕事件）*/
function initPortfolioView() {
  document.querySelectorAll(".equity-range-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      equityRange = btn.dataset.range;
      document.querySelectorAll(".equity-range-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderEquityChart();
    });
  });
}

/** 主入口：渲染整個 Portfolio 頁面 */
function renderPortfolioView() {
  initPortfolioView();
  renderPortfolioStats();
  renderEquityChart();
  renderPnLCalendar();
  renderPositionsTable();
}

// ===== 初始化 =====
document.addEventListener("DOMContentLoaded", () => {
  initModal();
  renderNews(NEWS_DATA);
  initFilters();
  initSearch();
  initWatchlistToggle();
  updateWatchlistBadge();
  renderTopTraders();
  startTradePolling();
  initNavigation();
  initSportsFilters();
  loadAll();              // 唯一 Events fetch 入口
});
