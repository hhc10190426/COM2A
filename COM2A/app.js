// ===== 模擬資料 =====

const MARKETS_DATA = [
  {
    id: 1,
    platform: "Polymarket",
    question: "Will Bitcoin reach $100,000 before April 2025?",
    icon: "https://polymarket-upload.s3.us-east-2.amazonaws.com/BTC+fullsize.png",
    yesPct: 62,
    volume24h: "$4.2M",
    openInterest: "$18.5M",
    totalMarkets: 1,
    endDate: "Apr 30, 2025",
    smartFlow: "+$128K",
    flowPositive: true,
  },
  {
    id: 2,
    platform: "Kalshi",
    question: "Will the Federal Reserve cut interest rates in Q1 2025?",
    icon: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/46/Bitcoin.svg/800px-Bitcoin.svg.png",
    yesPct: 34,
    volume24h: "$2.1M",
    openInterest: "$9.8M",
    totalMarkets: 3,
    endDate: "Mar 31, 2025",
    smartFlow: "-$45K",
    flowPositive: false,
  },
  {
    id: 3,
    platform: "Polymarket",
    question: "Will Ethereum ETF daily net inflows exceed $500M in March?",
    icon: "https://polymarket-upload.s3.us-east-2.amazonaws.com/ETH+fullsize.jpg",
    yesPct: 48,
    volume24h: "$3.7M",
    openInterest: "$14.2M",
    totalMarkets: 1,
    endDate: "Mar 31, 2025",
    smartFlow: "+$67K",
    flowPositive: true,
  },
  {
    id: 4,
    platform: "Kalshi",
    question: "Will the US unemployment rate remain below 4.5% through June 2025?",
    icon: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a4/Flag_of_the_United_States.svg/320px-Flag_of_the_United_States.svg.png",
    yesPct: 78,
    volume24h: "$890K",
    openInterest: "$5.6M",
    totalMarkets: 2,
    endDate: "Jun 30, 2025",
    smartFlow: "+$22K",
    flowPositive: true,
  },
  {
    id: 5,
    platform: "Polymarket",
    question: "Will Donald Trump sign an executive order on crypto regulation by April 2025?",
    icon: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a4/Flag_of_the_United_States.svg/320px-Flag_of_the_United_States.svg.png",
    yesPct: 55,
    volume24h: "$6.4M",
    openInterest: "$22.1M",
    totalMarkets: 1,
    endDate: "Apr 30, 2025",
    smartFlow: "+$204K",
    flowPositive: true,
  },
  {
    id: 6,
    platform: "Opinion",
    question: "Will Solana outperform Bitcoin in Q2 2025?",
    icon: "https://upload.wikimedia.org/wikipedia/en/b/b9/Solana_logo.png",
    yesPct: 41,
    volume24h: "$1.3M",
    openInterest: "$7.3M",
    totalMarkets: 1,
    endDate: "Jun 30, 2025",
    smartFlow: "-$12K",
    flowPositive: false,
  },
  {
    id: 7,
    platform: "Limitless",
    question: "Will AI-related stocks outperform S&P 500 in 2025?",
    icon: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Amazon_logo.svg/320px-Amazon_logo.svg.png",
    yesPct: 71,
    volume24h: "$2.9M",
    openInterest: "$11.4M",
    totalMarkets: 5,
    endDate: "Dec 31, 2025",
    smartFlow: "+$87K",
    flowPositive: true,
  },
  {
    id: 8,
    platform: "Polymarket",
    question: "Will Bitcoin Up or Down - March 11, 4:15AM-4:20AM ET",
    icon: "https://polymarket-upload.s3.us-east-2.amazonaws.com/BTC+fullsize.png",
    yesPct: 5,
    volume24h: "$320K",
    openInterest: "$1.2M",
    totalMarkets: 1,
    endDate: "Mar 11, 2025 4:20AM",
    smartFlow: "+$8K",
    flowPositive: true,
  },
];

const TRADES_DATA = [
  {
    trader: "Polymarket Trader",
    avatarText: "PT",
    action: "bought",
    shares: "1.21",
    side: "No",
    market: "Bitcoin Up or Down - March 11, 4:15AM-4:20AM ET",
    price: "95.0¢",
    amount: "$1.15",
    time: "just now",
    color: "#6366f1",
  },
  {
    trader: "Polymarket Trader",
    avatarText: "PT",
    action: "bought",
    shares: "209.28",
    side: "No",
    market: "Bitcoin Up or Down - March 11, 4:15AM-4:20AM ET",
    price: "95.6¢",
    amount: "$200.00",
    time: "1 min ago",
    color: "#8b5cf6",
  },
  {
    trader: "Sentimental-Finance",
    avatarText: "SF",
    action: "bought",
    shares: "5.15",
    side: "Yes",
    market: "Bitcoin Up or Down - March 11, 4:15AM-4:30AM ET",
    price: "29.9¢",
    amount: "$1.54",
    time: "2 min ago",
    color: "#22c55e",
  },
  {
    trader: "Unimportant-Calm",
    avatarText: "UC",
    action: "sold",
    shares: "10.20",
    side: "No",
    market: "Ethereum Up or Down - March 11, 4:15AM-4:20AM ET",
    price: "98.0¢",
    amount: "$10.00",
    time: "2 min ago",
    color: "#ef4444",
  },
  {
    trader: "Physical-Downtown",
    avatarText: "PD",
    action: "bought",
    shares: "50.00",
    side: "Yes",
    market: "Ethereum Up or Down - March 11, 4:15AM-4:20AM ET",
    price: "2.0¢",
    amount: "$1.00",
    time: "3 min ago",
    color: "#f59e0b",
  },
  {
    trader: "Esteemed-Emphasis",
    avatarText: "EE",
    action: "bought",
    shares: "26.50",
    side: "No",
    market: "Bitcoin Up or Down - March 11, 4:15AM-4:30AM ET",
    price: "72.0¢",
    amount: "$19.07",
    time: "3 min ago",
    color: "#06b6d4",
  },
  {
    trader: "Warlike-Shoemaker",
    avatarText: "WS",
    action: "sold",
    shares: "3.66",
    side: "Yes",
    market: "Strait of Hormuz traffic returns to normal by April 30?",
    price: "54.0¢",
    amount: "$1.98",
    time: "4 min ago",
    color: "#ec4899",
  },
  {
    trader: "Likable-Showstopper",
    avatarText: "LS",
    action: "bought",
    shares: "1.04",
    side: "No",
    market: "Bitcoin Up or Down - March 11, 4:15AM-4:20AM ET",
    price: "96.0¢",
    amount: "$1.00",
    time: "5 min ago",
    color: "#10b981",
  },
];

const NEWS_DATA = [
  {
    headline: "Bitcoin Surges Past $85,000 as Institutional Demand Drives Market Rally",
    source: "CoinDesk",
    time: "10 min ago",
    url: "https://news.google.com/search?q=Bitcoin+surges+85000",
  },
  {
    headline: "Federal Reserve Officials Signal Patience on Rate Cuts Amid Inflation Concerns",
    source: "Reuters",
    time: "25 min ago",
    url: "https://news.google.com/search?q=Federal+Reserve+rate+cuts+2025",
  },
  {
    headline: "Ethereum ETF Sees Record $420M Inflows in Single Trading Session",
    source: "Bloomberg",
    time: "1 hr ago",
    url: "https://news.google.com/search?q=Ethereum+ETF+inflows+record",
  },
  {
    headline: "Trump Signs Executive Order Establishing US Strategic Bitcoin Reserve",
    source: "WSJ",
    time: "2 hr ago",
    url: "https://news.google.com/search?q=Trump+Bitcoin+reserve+executive+order",
  },
  {
    headline: "SEC Approves Multiple Spot Crypto ETF Applications in Historic Decision",
    source: "Financial Times",
    time: "3 hr ago",
    url: "https://news.google.com/search?q=SEC+crypto+ETF+approval+2025",
  },
  {
    headline: "Polymarket Hits $1B in Monthly Trading Volume for First Time",
    source: "The Block",
    time: "4 hr ago",
    url: "https://news.google.com/search?q=Polymarket+1+billion+trading+volume",
  },
];

// ===== 渲染市場列表 =====
function renderMarkets(markets) {
  const container = document.getElementById("markets-list");
  container.innerHTML = "";

  if (markets.length === 0) {
    container.innerHTML = `<div class="empty-state">No markets available for this category.</div>`;
    return;
  }

  markets.forEach((m) => {
    const card = document.createElement("div");
    card.className = "market-card";
    card.style.cursor = "pointer";

    const yesWidth = m.yesPct;
    const noWidth = 100 - m.yesPct;
    const isYesMajority = m.yesPct >= 50;

    card.innerHTML = `
      <div class="market-header">
        <img class="market-icon" src="${m.icon}" alt="${m.question}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2244%22 height=%2244%22><rect width=%2244%22 height=%2244%22 rx=%2210%22 fill=%22%231e1e2a%22/><text x=%2222%22 y=%2228%22 text-anchor=%22middle%22 fill=%22%236366f1%22 font-size=%2218%22>?</text></svg>'"/>
        <div class="market-info">
          <div class="market-question">${m.question}</div>
          <div class="market-meta">
            <span class="platform-tag">${m.platform}</span>
            <span class="market-end-date">Ends ${m.endDate}</span>
          </div>
        </div>
        <div class="stat-item" style="text-align:right;flex-shrink:0">
          <div class="stat-label">YES</div>
          <div class="stat-value ${isYesMajority ? 'green' : 'red'}">${m.yesPct}¢</div>
        </div>
      </div>
      <div class="yes-no-bar">
        <div class="bar-yes" style="width:${yesWidth}%"></div>
        <div class="bar-no" style="width:${noWidth}%"></div>
      </div>
      <div class="market-stats">
        <div class="stat-item">
          <div class="stat-label">Smart Flow (24h)</div>
          <div class="stat-value ${m.flowPositive ? 'green' : 'red'}">${m.smartFlow}</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">24h Volume</div>
          <div class="stat-value">${m.volume24h}</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Open Interest</div>
          <div class="stat-value">${m.openInterest}</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Markets</div>
          <div class="stat-value accent">${m.totalMarkets}</div>
        </div>
      </div>
      <div class="market-actions">
        <button class="btn-trade yes-btn" onclick="event.stopPropagation(); showTradeModal('${m.id}', 'Yes')">
          Buy YES &nbsp;<strong>${m.yesPct}¢</strong>
        </button>
        <button class="btn-trade no-btn" onclick="event.stopPropagation(); showTradeModal('${m.id}', 'No')">
          Buy NO &nbsp;<strong>${100 - m.yesPct}¢</strong>
        </button>
      </div>
    `;

    card.addEventListener("click", () => openMarketDetail(m));
    container.appendChild(card);
  });
}

// ===== 渲染最近交易 =====
function renderTrades(trades) {
  const container = document.getElementById("trades-list");
  container.innerHTML = "";

  trades.forEach((t) => {
    const item = document.createElement("div");
    item.className = "trade-item";

    const actionClass = t.action === "bought" ? "buy" : "sell";
    const sideClass = t.side === "Yes" ? "yes-tag" : "no-tag";

    item.innerHTML = `
      <div class="trade-avatar-placeholder" style="background: linear-gradient(135deg, ${t.color}, ${t.color}99)">
        ${t.avatarText}
      </div>
      <div class="trade-content">
        <div class="trade-trader">${t.trader}</div>
        <div class="trade-action">
          <span class="${actionClass}">${t.action}</span>
          ${t.shares} shares
          <span class="${sideClass}">${t.side}</span>
          at ${t.price} (${t.amount})
        </div>
        <div class="trade-market">${t.market}</div>
        <div class="trade-time">${t.time}</div>
      </div>
      <div class="trade-arrow">›</div>
    `;

    item.addEventListener("click", () => showTraderProfile(t));
    container.appendChild(item);
  });
}

// ===== 渲染新聞 =====
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

// ===== 分類標籤邏輯 =====
function initTabs() {
  const tabs = document.querySelectorAll(".tab");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");

      const tabKey = tab.dataset.tab;
      let filtered = MARKETS_DATA;

      if (tabKey === "crypto" || tabKey === "live-crypto") {
        filtered = MARKETS_DATA.filter((m) =>
          m.question.toLowerCase().includes("bitcoin") ||
          m.question.toLowerCase().includes("ethereum") ||
          m.question.toLowerCase().includes("solana") ||
          m.question.toLowerCase().includes("crypto")
        );
      } else if (tabKey === "sports") {
        filtered = [];
      }

      renderMarkets(filtered);
    });
  });
}

// ===== 篩選按鈕邏輯 =====
function initFilters() {
  const filterBtns = document.querySelectorAll(".filter-btn");

  filterBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      filterBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      let sorted = [...MARKETS_DATA];
      const text = btn.textContent.trim();

      if (text.includes("24h Volume")) {
        sorted.sort((a, b) => parseFloat(b.volume24h.replace(/[$MK]/g, "")) - parseFloat(a.volume24h.replace(/[$MK]/g, "")));
      } else if (text.includes("Open Interest")) {
        sorted.sort((a, b) => parseFloat(b.openInterest.replace(/[$MK]/g, "")) - parseFloat(a.openInterest.replace(/[$MK]/g, "")));
      } else if (text.includes("Total Markets")) {
        sorted.sort((a, b) => b.totalMarkets - a.totalMarkets);
      }

      renderMarkets(sorted);
    });
  });
}

// ===== 平台篩選 =====
function initPlatformChips() {
  const chips = document.querySelectorAll(".platform-chip");

  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      chips.forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");

      const platformName = chip.querySelector("span").textContent;
      const filtered = MARKETS_DATA.filter((m) => m.platform === platformName);
      renderMarkets(filtered.length > 0 ? filtered : MARKETS_DATA);
    });
  });
}

// ===== 市場詳情 Modal =====
function openMarketDetail(market) {
  const existing = document.getElementById("market-detail-modal");
  if (existing) existing.remove();

  const noPrice = 100 - market.yesPct;
  const overlay = document.createElement("div");
  overlay.id = "market-detail-modal";
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-box detail-modal">
      <div class="detail-header">
        <img src="${market.icon}" class="detail-icon" onerror="this.style.display='none'"/>
        <div class="detail-title-wrap">
          <span class="platform-tag">${market.platform}</span>
          <h2 class="detail-title">${market.question}</h2>
          <span class="detail-end">Ends ${market.endDate}</span>
        </div>
        <button class="modal-close" id="close-detail">✕</button>
      </div>

      <div class="detail-price-row">
        <div class="detail-price yes-price">
          <div class="price-label">YES</div>
          <div class="price-value">${market.yesPct}¢</div>
          <div class="price-sub">per share</div>
        </div>
        <div class="detail-divider"></div>
        <div class="detail-price no-price">
          <div class="price-label">NO</div>
          <div class="price-value">${noPrice}¢</div>
          <div class="price-sub">per share</div>
        </div>
      </div>

      <div class="yes-no-bar" style="height:8px;margin:0">
        <div class="bar-yes" style="width:${market.yesPct}%"></div>
        <div class="bar-no" style="width:${noPrice}%"></div>
      </div>

      <div class="detail-stats-grid">
        <div class="detail-stat">
          <div class="stat-label">Smart Flow (24h)</div>
          <div class="stat-value ${market.flowPositive ? 'green' : 'red'}">${market.smartFlow}</div>
        </div>
        <div class="detail-stat">
          <div class="stat-label">24h Volume</div>
          <div class="stat-value">${market.volume24h}</div>
        </div>
        <div class="detail-stat">
          <div class="stat-label">Open Interest</div>
          <div class="stat-value">${market.openInterest}</div>
        </div>
        <div class="detail-stat">
          <div class="stat-label">Total Markets</div>
          <div class="stat-value accent">${market.totalMarkets}</div>
        </div>
      </div>

      <div class="detail-trade-row">
        <button class="btn-trade yes-btn full" onclick="showTradeModal('${market.id}', 'Yes')">
          Buy YES — ${market.yesPct}¢
        </button>
        <button class="btn-trade no-btn full" onclick="showTradeModal('${market.id}', 'No')">
          Buy NO — ${noPrice}¢
        </button>
      </div>
    </div>
  `;

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.getElementById("close-detail")?.addEventListener("click", () => overlay.remove());
  // bind after appending
  overlay.querySelector("#close-detail").addEventListener("click", () => overlay.remove());
  document.body.appendChild(overlay);
}

// ===== 交易 Modal =====
function showTradeModal(marketId, side) {
  const market = MARKETS_DATA.find((m) => String(m.id) === String(marketId));
  if (!market) return;

  const existing = document.getElementById("trade-modal");
  if (existing) existing.remove();

  const price = side === "Yes" ? market.yesPct : (100 - market.yesPct);
  const sideClass = side === "Yes" ? "yes-price" : "no-price";

  const overlay = document.createElement("div");
  overlay.id = "trade-modal";
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-box trade-modal-box">
      <div class="trade-modal-header">
        <h3>Buy <span class="${sideClass}" style="font-weight:800">${side}</span> Shares</h3>
        <button class="modal-close" id="close-trade">✕</button>
      </div>
      <p class="trade-modal-market">${market.question}</p>
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
        <div class="trade-summary-row" id="est-shares-row">
          <span>Est. shares</span>
          <span class="stat-value" id="est-shares">${(10 / (price / 100)).toFixed(2)}</span>
        </div>
        <div class="trade-summary-row" id="est-payout-row">
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

  document.getElementById("close-trade").addEventListener("click", () => overlay.remove());

  const amountInput = document.getElementById("trade-amount");
  amountInput.addEventListener("input", () => {
    const amt = parseFloat(amountInput.value) || 0;
    const shares = amt / (price / 100);
    document.getElementById("est-shares").textContent = shares.toFixed(2);
    document.getElementById("est-payout").textContent = `$${shares.toFixed(2)}`;
  });

  document.getElementById("confirm-trade").addEventListener("click", () => {
    const amt = parseFloat(amountInput.value) || 0;
    overlay.remove();
    showToast(`✓ Order placed: Buy ${side} $${amt.toFixed(2)} on "${market.question.slice(0, 40)}..."`);
  });
}

// ===== 交易者 Profile Modal =====
function showTraderProfile(trade) {
  const existing = document.getElementById("trader-modal");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "trader-modal";
  overlay.className = "modal-overlay";

  const winRate = Math.floor(Math.random() * 30 + 50);
  const totalTrades = Math.floor(Math.random() * 500 + 50);
  const pnl = (Math.random() * 5000 - 1000).toFixed(2);
  const pnlPositive = parseFloat(pnl) >= 0;

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
          <div class="trader-since">Active trader · Joined 2024</div>
        </div>
      </div>
      <div class="trader-stats-grid">
        <div class="detail-stat">
          <div class="stat-label">Total P&L</div>
          <div class="stat-value ${pnlPositive ? 'green' : 'red'}">${pnlPositive ? '+' : ''}$${pnl}</div>
        </div>
        <div class="detail-stat">
          <div class="stat-label">Win Rate</div>
          <div class="stat-value">${winRate}%</div>
        </div>
        <div class="detail-stat">
          <div class="stat-label">Total Trades</div>
          <div class="stat-value">${totalTrades}</div>
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
              <span class="${trade.action === 'bought' ? 'buy' : 'sell'}">${trade.action}</span>
              ${trade.shares} shares
              <span class="${trade.side === 'Yes' ? 'yes-tag' : 'no-tag'}">${trade.side}</span>
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
  document.getElementById("close-trader").addEventListener("click", () => overlay.remove());
}

// ===== Toast 通知 =====
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
  const modal = document.getElementById("disclaimer-modal");
  const acceptBtn = document.getElementById("modal-accept");
  const declineBtn = document.getElementById("modal-decline");

  const accepted = sessionStorage.getItem("disclaimer-accepted");
  if (accepted) {
    modal.classList.add("hidden");
    return;
  }

  acceptBtn.addEventListener("click", () => {
    sessionStorage.setItem("disclaimer-accepted", "true");
    modal.classList.add("hidden");
  });

  declineBtn.addEventListener("click", () => {
    window.history.back();
    setTimeout(() => {
      window.location.href = "https://www.google.com";
    }, 300);
  });
}

// ===== 模擬即時交易更新 =====
function simulateLiveTrades() {
  const newTraders = [
    { trader: "Brave-Horizon", avatarText: "BH", color: "#3b82f6" },
    { trader: "Quiet-Thunder", avatarText: "QT", color: "#f97316" },
    { trader: "Silver-Cascade", avatarText: "SC", color: "#a855f7" },
    { trader: "Iron-Compass", avatarText: "IC", color: "#14b8a6" },
  ];

  const markets = [
    "Bitcoin Up or Down - March 11, 4:20AM-4:25AM ET",
    "Ethereum Up or Down - March 11, 4:20AM-4:25AM ET",
    "Will BTC exceed $90,000 this week?",
  ];

  setInterval(() => {
    const t = newTraders[Math.floor(Math.random() * newTraders.length)];
    const side = Math.random() > 0.5 ? "Yes" : "No";
    const action = Math.random() > 0.3 ? "bought" : "sold";
    const shares = (Math.random() * 200 + 1).toFixed(2);
    const price = side === "Yes"
      ? (Math.random() * 50 + 2).toFixed(1)
      : (Math.random() * 50 + 50).toFixed(1);
    const amount = (parseFloat(shares) * parseFloat(price) / 100).toFixed(2);

    const newTrade = {
      trader: t.trader,
      avatarText: t.avatarText,
      action,
      shares,
      side,
      market: markets[Math.floor(Math.random() * markets.length)],
      price: `${price}¢`,
      amount: `$${amount}`,
      time: "just now",
      color: t.color,
    };

    TRADES_DATA.unshift(newTrade);
    if (TRADES_DATA.length > 12) TRADES_DATA.pop();

    // Update times
    TRADES_DATA.forEach((tr, i) => {
      if (i === 0) tr.time = "just now";
      else if (i <= 2) tr.time = `${i} min ago`;
      else tr.time = `${i} min ago`;
    });

    renderTrades(TRADES_DATA);
  }, 4000);
}

// ===== 初始化 =====
document.addEventListener("DOMContentLoaded", () => {
  initModal();
  renderMarkets(MARKETS_DATA);
  renderTrades(TRADES_DATA);
  renderNews(NEWS_DATA);
  initTabs();
  initFilters();
  initPlatformChips();
  simulateLiveTrades();
});
