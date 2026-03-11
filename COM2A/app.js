// ===== Polymarket API 設定 =====
const GAMMA_API = "https://gamma-api.polymarket.com";
const DATA_API  = "https://data-api.polymarket.com";
const CORS_PROXY = "https://corsproxy.io/?";
const WHALE_THRESHOLD = 5000;

// ===== 帶超時的 fetch（5 秒）=====
function fetchWithTimeout(url, ms = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

// ===== 支援多個 CORS Proxy 的 fetch =====
const PROXY_LIST = [
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
];

async function apiFetch(url) {
  // 先嘗試直接請求
  try {
    const res = await fetchWithTimeout(url, 5000);
    if (res.ok) return res.json();
  } catch (_) {}

  // 逐一嘗試備用 Proxy
  for (const makeProxy of PROXY_LIST) {
    try {
      const res = await fetchWithTimeout(makeProxy(url), 6000);
      if (res.ok) {
        const text = await res.text();
        return JSON.parse(text);
      }
    } catch (_) {}
  }

  throw new Error("All proxies failed");
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

// ===== 取得 Polymarket 市場列表 =====
async function fetchMarkets() {
  const url = `${GAMMA_API}/markets?active=true&closed=false&limit=20&order=volume24hr&ascending=false`;
  return apiFetch(url);
}

// ===== 取得最近交易 =====
async function fetchTrades() {
  // 嘗試兩個端點
  const endpoints = [
    `${DATA_API}/activity?limit=30`,
    `${GAMMA_API}/trades?limit=30`,
  ];
  for (const url of endpoints) {
    try {
      const data = await apiFetch(url);
      if (Array.isArray(data) && data.length > 0) return data;
    } catch (_) {}
  }
  throw new Error("Trades fetch failed");
}

// ===== 渲染市場列表 =====
function renderMarkets(markets) {
  const container = document.getElementById("markets-list");
  container.innerHTML = "";

  if (!markets || markets.length === 0) {
    container.innerHTML = `<div class="empty-state">No active markets found.</div>`;
    return;
  }

  markets.forEach((m) => {
    const yesPriceRaw = Array.isArray(m.outcomePrices)
      ? parseFloat(m.outcomePrices[0])
      : parseFloat(m.bestAsk ?? 0.5);
    const yesPct   = Math.round(yesPriceRaw * 100);
    const noPct    = 100 - yesPct;
    const vol24h   = fmtUSD(m.volume24hr ?? m.volume24h ?? 0);
    const oi       = fmtUSD(m.liquidity ?? m.openInterest ?? 0);
    const endDate  = m.endDate
      ? new Date(m.endDate).toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" })
      : "TBD";
    const icon     = m.image || m.icon || "";
    const isYes    = yesPct >= 50;

    const card = document.createElement("div");
    card.className = "market-card";

    card.innerHTML = `
      <div class="market-header">
        <img class="market-icon" src="${icon}" alt=""
          onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2244%22 height=%2244%22><rect width=%2244%22 height=%2244%22 rx=%2210%22 fill=%22%231e1e2a%22/><text x=%2222%22 y=%2228%22 text-anchor=%22middle%22 fill=%22%236366f1%22 font-size=%2218%22>P</text></svg>'"/>
        <div class="market-info">
          <div class="market-question">${m.question}</div>
          <div class="market-meta">
            <span class="platform-tag">Polymarket</span>
            <span class="market-end-date">Ends ${endDate}</span>
          </div>
        </div>
        <div class="stat-item" style="text-align:right;flex-shrink:0">
          <div class="stat-label">YES</div>
          <div class="stat-value ${isYes ? "green" : "red"}">${yesPct}¢</div>
        </div>
      </div>
      <div class="yes-no-bar">
        <div class="bar-yes" style="width:${yesPct}%"></div>
        <div class="bar-no"  style="width:${noPct}%"></div>
      </div>
      <div class="market-stats">
        <div class="stat-item">
          <div class="stat-label">24h Volume</div>
          <div class="stat-value">${vol24h}</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Liquidity</div>
          <div class="stat-value">${oi}</div>
        </div>
      </div>
      <div class="market-actions">
        <button class="btn-trade yes-btn" onclick="event.stopPropagation(); openBuyModal(event, ${JSON.stringify(m.question).replace(/"/g,"&quot;")}, 'Yes', ${yesPct})">
          Buy YES &nbsp;<strong>${yesPct}¢</strong>
        </button>
        <button class="btn-trade no-btn" onclick="event.stopPropagation(); openBuyModal(event, ${JSON.stringify(m.question).replace(/"/g,"&quot;")}, 'No', ${noPct})">
          Buy NO &nbsp;<strong>${noPct}¢</strong>
        </button>
      </div>
    `;

    card.addEventListener("click", () => openMarketDetailFromApi(m, yesPct, noPct, vol24h, oi, endDate, icon));
    container.appendChild(card);
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

// ===== 主要載入流程 =====
async function loadAll() {
  // 先立即顯示備用資料，讓頁面不空白
  renderMarkets(FALLBACK_MARKETS);
  simulateLiveTrades();
  setApiStatus("loading", "連接中...");

  // 背景嘗試取得真實資料
  try {
    const markets = await fetchMarkets();
    if (markets && markets.length > 0) {
      renderMarkets(markets);
      setApiStatus("live", "即時數據 · Polymarket");
    }
  } catch (err) {
    console.warn("Markets API failed:", err);
    setApiStatus("error", "顯示備用數據");
  }

  try {
    const trades = await fetchTrades();
    if (trades && trades.length > 0) {
      renderTrades(trades);
    }
  } catch (err) {
    console.warn("Trades API failed:", err);
  }
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

// ===== 市場篩選（用 API 資料）=====
let cachedMarkets = [];

async function initTabsWithApi() {
  try {
    cachedMarkets = await fetchMarkets();
  } catch (_) {
    cachedMarkets = FALLBACK_MARKETS;
  }

  const tabs = document.querySelectorAll(".tab");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      const key = tab.dataset.tab;
      let filtered = cachedMarkets;
      if (key === "crypto" || key === "live-crypto") {
        filtered = cachedMarkets.filter((m) =>
          /bitcoin|ethereum|btc|eth|crypto|solana|sol/i.test(m.question || "")
        );
      } else if (key === "sports") {
        filtered = cachedMarkets.filter((m) =>
          /nba|nfl|soccer|football|basketball|tennis|ufc|sport/i.test(m.question || "")
        );
      }
      renderMarkets(filtered);
    });
  });
}

// ===== 篩選排序 =====
function initFilters() {
  const filterBtns = document.querySelectorAll(".filter-btn");
  filterBtns.forEach((btn) => {
    btn.addEventListener("click", async () => {
      filterBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const text = btn.textContent.trim();
      let order = "volume24hr";
      if (text.includes("Open Interest")) order = "liquidity";
      if (text.includes("Total Markets"))  order = "volume";
      try {
        const markets = await apiFetch(`${GAMMA_API}/markets?active=true&closed=false&limit=20&order=${order}&ascending=false`);
        renderMarkets(markets);
      } catch (_) {}
    });
  });
}

// ===== 市場詳情 Modal（API 版）=====
function openMarketDetailFromApi(m, yesPct, noPct, vol24h, oi, endDate, icon) {
  const existing = document.getElementById("market-detail-modal");
  if (existing) existing.remove();

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
      ${m.url ? `<a href="${m.url}" target="_blank" class="modal-link" style="text-align:center;display:block">在 Polymarket 查看 ↗</a>` : ""}
    </div>
  `;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  overlay.querySelector("#close-detail").addEventListener("click", () => overlay.remove());
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

// ===== 備用模擬交易（API 失敗時）=====
function simulateLiveTrades() {
  const traders = [
    { name: "Brave-Horizon",    initials: "BH", color: "#3b82f6" },
    { name: "Quiet-Thunder",    initials: "QT", color: "#f97316" },
    { name: "Silver-Cascade",   initials: "SC", color: "#a855f7" },
    { name: "Iron-Compass",     initials: "IC", color: "#14b8a6" },
  ];
  const mkts = [
    "Bitcoin Up or Down - 4:20AM-4:25AM ET",
    "Ethereum Up or Down - 4:20AM-4:25AM ET",
    "Will BTC exceed $90,000 this week?",
  ];
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

// ===== 初始化 =====
document.addEventListener("DOMContentLoaded", () => {
  initModal();
  renderNews(NEWS_DATA);
  loadAll();
  initTabsWithApi();
  initFilters();
  startTradePolling();
});
