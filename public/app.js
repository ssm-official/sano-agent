// ─── SANO Agent — Production Frontend ───

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

let sessionId = localStorage.getItem("sano_sid") || null;
let streaming = false;
let userEmail = null;
let walletAddress = null;
let authToken = null;
let userSettings = { theme: "light", language: "en", country: "US", shipping_address: "" };

// ─── Theme ───
function applyTheme(theme) {
  const actual = theme === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme;
  document.documentElement.classList.toggle("dark", actual === "dark");
  // Update theme toggle icons
  const moon = document.querySelector(".icon-moon");
  const sun = document.querySelector(".icon-sun");
  if (moon && sun) {
    if (actual === "dark") {
      moon.classList.add("hidden");
      sun.classList.remove("hidden");
    } else {
      moon.classList.remove("hidden");
      sun.classList.add("hidden");
    }
  }
  // Update theme switcher in settings
  document.querySelectorAll(".theme-option").forEach(b => {
    b.classList.toggle("active", b.dataset.theme === theme);
  });
}

// Apply saved theme immediately
const savedTheme = localStorage.getItem("sano_theme") || "light";
applyTheme(savedTheme);

// ─── Auth ───
const authScreen = $("#auth-screen");
const appEl = $("#app");

// Check stored session
const stored = localStorage.getItem("sano_auth");
if (stored) {
  try {
    const data = JSON.parse(stored);
    userEmail = data.email;
    walletAddress = data.wallet;
    authToken = data.token;
    enterApp();
  } catch (e) { localStorage.removeItem("sano_auth"); }
}

$("#auth-submit").addEventListener("click", submitEmail);
$("#auth-email").addEventListener("keydown", e => { if (e.key === "Enter") submitEmail(); });
$("#auth-verify").addEventListener("click", verifyCode);
$("#auth-code").addEventListener("keydown", e => { if (e.key === "Enter") verifyCode(); });
$("#auth-back").addEventListener("click", () => {
  $("#auth-step-code").classList.add("hidden");
  $("#auth-step-email").classList.remove("hidden");
  $("#auth-error").classList.add("hidden");
});

async function submitEmail() {
  const email = $("#auth-email").value.trim();
  if (!email || !email.includes("@")) {
    showAuthError("Enter a valid email address.");
    return;
  }

  $("#auth-submit").disabled = true;
  $("#auth-submit").textContent = "Sending code...";
  $("#auth-error").classList.add("hidden");

  try {
    const res = await fetch("/api/auth/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });
    const data = await res.json();

    if (data.error) {
      showAuthError(data.error);
      return;
    }

    $("#auth-email-display").textContent = email;
    $("#auth-step-email").classList.add("hidden");
    $("#auth-step-code").classList.remove("hidden");
    $("#auth-code").focus();
  } catch (e) {
    showAuthError("Something went wrong. Try again.");
  } finally {
    $("#auth-submit").disabled = false;
    $("#auth-submit").textContent = "Continue";
  }
}

async function verifyCode() {
  const code = $("#auth-code").value.trim();
  const email = $("#auth-email").value.trim();
  if (!code || code.length < 6) {
    showAuthError("Enter the 6-digit code.");
    return;
  }

  $("#auth-verify").disabled = true;
  $("#auth-verify").textContent = "Setting up your agent...";
  $("#auth-error").classList.add("hidden");

  try {
    // Sandbox creation can take 30-60 seconds — be patient
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);
    const res = await fetch("/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    const data = await res.json();

    if (data.error) {
      showAuthError(data.error);
      return;
    }

    userEmail = data.email;
    walletAddress = data.wallet;
    authToken = data.token;

    localStorage.setItem("sano_auth", JSON.stringify({
      email: userEmail, wallet: walletAddress, token: authToken
    }));

    enterApp();

    // First-time signin: force the user to back up their private key
    if (data.first_signin) {
      setTimeout(() => $("#backup-key-btn")?.click(), 500);
    }
  } catch (e) {
    showAuthError("Verification failed. Try again.");
  } finally {
    $("#auth-verify").disabled = false;
    $("#auth-verify").textContent = "Sign in";
  }
}

function showAuthError(msg) {
  const el = $("#auth-error");
  el.textContent = msg;
  el.classList.remove("hidden");
}

function enterApp() {
  authScreen.classList.add("hidden");
  appEl.classList.remove("hidden");

  // Update UI
  if (userEmail) {
    $("#user-email").textContent = userEmail;
    $("#user-avatar").textContent = userEmail[0].toUpperCase();
  }

  loadBalance();
  $("#input").focus();
}

// ─── Balance ───
async function loadBalance() {
  if (!walletAddress) {
    $("#balance-amount").textContent = "$0.00";
    return;
  }

  try {
    const res = await fetch("/api/wallet/balance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: walletAddress })
    });
    const data = await res.json();

    let total = 0;
    if (data.sol !== undefined && data.sol_price) {
      total += data.sol * data.sol_price;
    }
    if (data.usdc !== undefined) total += data.usdc;

    $("#balance-amount").textContent = "$" + total.toFixed(2);
  } catch (e) {
    $("#balance-amount").textContent = "$—";
  }
}

// ─── Sidebar ───
$("#menu-toggle").addEventListener("click", () => { $("#sidebar").classList.toggle("open"); });
$("#new-chat").addEventListener("click", () => {
  sessionId = null;
  localStorage.removeItem("sano_sid");
  $("#messages").innerHTML = "";
  addWelcome();
});

$$(".nav-item").forEach(btn => {
  btn.addEventListener("click", () => {
    // Only nav-items with a data-prompt should trigger a chat message
    if (btn.dataset.prompt) {
      send(btn.dataset.prompt);
      $("#sidebar").classList.remove("open");
    }
  });
});

// Sign out
$("#sign-out").addEventListener("click", () => {
  localStorage.removeItem("sano_auth");
  localStorage.removeItem("sano_sid");
  userEmail = null;
  walletAddress = null;
  authToken = null;
  sessionId = null;
  appEl.classList.add("hidden");
  authScreen.classList.remove("hidden");
  $("#auth-step-code").classList.add("hidden");
  $("#auth-step-email").classList.remove("hidden");
  $("#auth-email").value = "";
  $("#auth-code").value = "";
});

// ─── Portfolio Panel ───
const portfolioPanel = $("#portfolio-panel");
$("#portfolio-btn").addEventListener("click", () => {
  portfolioPanel.classList.remove("hidden");
  loadPortfolio();
});
$("#portfolio-close").addEventListener("click", () => portfolioPanel.classList.add("hidden"));

let currentPortfolioTab = "all";
$$(".portfolio-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    $$(".portfolio-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    currentPortfolioTab = tab.dataset.tab;
    renderPortfolio();
  });
});

let portfolioData = null;
async function loadPortfolio() {
  $("#portfolio-positions").innerHTML = `<div class="portfolio-empty">Loading...</div>`;
  if (!walletAddress) {
    $("#portfolio-positions").innerHTML = `<div class="portfolio-empty">Sign in to see your portfolio</div>`;
    return;
  }
  try {
    // Fetch wallet balance + prediction positions in parallel
    const [walletRes, predRes] = await Promise.all([
      fetch("/api/wallet/balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: walletAddress })
      }),
      fetch(`/api/predictions/positions?owner=${walletAddress}`)
    ]);
    const walletData = await walletRes.json();
    const predData = await predRes.json();
    portfolioData = {
      ...walletData,
      prediction_positions: predData.positions || []
    };
    renderPortfolio();
  } catch (e) {
    $("#portfolio-positions").innerHTML = `<div class="portfolio-empty">Couldn't load portfolio</div>`;
  }
}

function renderPortfolio() {
  if (!portfolioData) return;

  const cash = portfolioData.cash_holdings || [];
  const stocks = portfolioData.stock_holdings || [];
  const predictions = portfolioData.prediction_positions || [];
  const sol = portfolioData.sol_balance || 0;
  const solUsd = portfolioData.sol_value_usd || 0;

  let positions = [];

  // SOL
  if (sol > 0.0001) {
    positions.push({
      type: "crypto",
      symbol: "SOL",
      name: "Solana",
      amount: sol.toFixed(4) + " SOL",
      value_usd: solUsd
    });
  }

  // Cash / crypto holdings
  for (const c of cash) {
    if ((c.value_usd || 0) < 0.01 && c.token !== "USDC" && c.token !== "USDT") continue;
    positions.push({
      type: "crypto",
      symbol: c.token,
      name: c.token,
      amount: c.balance.toFixed(c.token === "USDC" || c.token === "USDT" ? 2 : 4) + " " + c.token,
      value_usd: c.value_usd || 0
    });
  }

  // Stock holdings
  for (const s of stocks) {
    positions.push({
      type: "stock",
      symbol: s.ticker,
      name: s.ticker,
      amount: s.shares.toFixed(6) + " shares",
      value_usd: s.value_usd || 0
    });
  }

  // Prediction positions (Jupiter Predict format)
  for (const p of predictions) {
    const side = p.isYes ? "YES" : "NO";
    const costUsd = (parseFloat(p.totalCostUsd) || 0) / 1_000_000;
    const valueUsd = (parseFloat(p.valueUsd) || 0) / 1_000_000;
    const payoutUsd = (parseFloat(p.payoutUsd) || 0) / 1_000_000;
    const pnlUsd = (parseFloat(p.pnlUsd) || 0) / 1_000_000;
    const contracts = parseInt(p.contracts) || 0;
    const eventTitle = p.eventMetadata?.title || "";
    const marketTitle = p.marketMetadata?.title || "";
    const displayName = eventTitle ? `${eventTitle}${marketTitle ? " — " + marketTitle : ""}` : (p.market_id || "Prediction");

    positions.push({
      type: "prediction",
      symbol: side,
      name: `${displayName} · ${side}`,
      amount: `${contracts} contracts · Paid $${costUsd.toFixed(2)} · Payout $${payoutUsd.toFixed(2)}`,
      value_usd: valueUsd,
      pnl: pnlUsd,
      market_id: p.marketId || p.market_id
    });
  }

  // Total
  const totalUsd = positions.reduce((s, p) => s + (p.value_usd || 0), 0);
  $("#portfolio-total").textContent = "$" + totalUsd.toFixed(2);
  $("#portfolio-pnl").textContent = `${positions.length} ${positions.length === 1 ? "position" : "positions"}`;
  $("#portfolio-pnl").className = "portfolio-pnl flat";

  // Filter by tab
  if (currentPortfolioTab === "stocks") positions = positions.filter(p => p.type === "stock");
  if (currentPortfolioTab === "crypto") positions = positions.filter(p => p.type === "crypto");
  if (currentPortfolioTab === "predictions") positions = positions.filter(p => p.type === "prediction");

  if (positions.length === 0) {
    $("#portfolio-positions").innerHTML = `<div class="portfolio-empty">No positions yet. Add funds and buy something to start.</div>`;
    return;
  }

  // Sort by value desc
  positions.sort((a, b) => b.value_usd - a.value_usd);

  const html = positions.map(p => {
    const pnlClass = (p.pnl || 0) > 0 ? "up" : (p.pnl || 0) < 0 ? "down" : "flat";
    const pnlText = p.pnl !== undefined ? `${p.pnl >= 0 ? "+" : ""}$${p.pnl.toFixed(2)}` : "";
    return `
    <div class="position-row">
      <div class="position-icon ${p.type}">${esc(p.symbol.slice(0, 4))}</div>
      <div class="position-info">
        <div class="position-name">${esc(p.name)}</div>
        <div class="position-amount">${esc(p.amount)}</div>
      </div>
      <div class="position-value">
        <div class="position-usd">$${p.value_usd.toFixed(2)}</div>
        ${pnlText ? `<div class="position-change ${pnlClass}">${pnlText}</div>` : ""}
      </div>
      <div class="position-actions">
        <button class="position-sell-btn" data-symbol="${esc(p.symbol)}" data-type="${p.type}" data-market="${esc(p.market_id || '')}">Sell</button>
      </div>
    </div>`;
  }).join("");
  $("#portfolio-positions").innerHTML = html;

  // Wire up sell buttons
  $$("#portfolio-positions .position-sell-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const sym = btn.dataset.symbol;
      const type = btn.dataset.type;
      portfolioPanel.classList.add("hidden");
      if (type === "stock") {
        send(`Sell all my ${sym} stock`);
      } else {
        send(`Sell all my ${sym} for USDC`);
      }
    });
  });
}

// ─── Backup Key Modal ───
$("#backup-key-btn").addEventListener("click", async () => {
  $("#backup-modal").classList.remove("hidden");
  $("#backup-sol-address").textContent = "Loading...";
  $("#backup-sol-key").textContent = "Loading...";
  $("#backup-evm-address").textContent = "Loading...";
  $("#backup-evm-key").textContent = "Loading...";

  try {
    const res = await fetch("/api/wallet/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: userEmail })
    });
    const data = await res.json();
    if (data.error) {
      $("#backup-sol-key").textContent = "Error: " + data.error;
      return;
    }
    // Solana
    const sol = data.solana || { address: data.public_key, private_key: data.private_key };
    $("#backup-sol-address").textContent = sol.address || "—";
    $("#backup-sol-key").textContent = sol.private_key || "—";
    // EVM (might not exist for old accounts until next signin)
    if (data.evm) {
      $("#backup-evm-address").textContent = data.evm.address;
      $("#backup-evm-key").textContent = data.evm.private_key;
    } else {
      $("#backup-evm-address").textContent = "(sign out and back in to generate)";
      $("#backup-evm-key").textContent = "(sign out and back in to generate)";
    }
  } catch (e) {
    $("#backup-sol-key").textContent = "Could not load keys";
  }
});
$("#backup-modal-close").addEventListener("click", () => $("#backup-modal").classList.add("hidden"));
$("#backup-modal").addEventListener("click", e => { if (e.target.id === "backup-modal") $("#backup-modal").classList.add("hidden"); });

function setupCopyBtn(btnId, srcId) {
  $("#" + btnId).addEventListener("click", () => {
    const v = $("#" + srcId).textContent;
    if (v && !v.includes("Loading") && !v.includes("Error") && !v.startsWith("(")) {
      navigator.clipboard.writeText(v);
      $("#" + btnId).textContent = "Copied";
      setTimeout(() => $("#" + btnId).textContent = "Copy", 2000);
    }
  });
}
setupCopyBtn("copy-sol-key", "backup-sol-key");
setupCopyBtn("copy-evm-key", "backup-evm-key");

// ─── Fund Modal ───
$("#add-funds-btn").addEventListener("click", () => { $("#fund-modal").classList.remove("hidden"); });
$("#fund-modal-close").addEventListener("click", () => { $("#fund-modal").classList.add("hidden"); });
$("#fund-modal").addEventListener("click", e => { if (e.target.id === "fund-modal") $("#fund-modal").classList.add("hidden"); });

$("#fund-card").addEventListener("click", () => {
  // Open MoonPay widget for fiat on-ramp
  const moonpayUrl = `https://buy.moonpay.com/?apiKey=${window.__SANO_CONFIG__?.MOONPAY_KEY || "pk_test_key"}&currencyCode=usdc_sol&walletAddress=${walletAddress || ""}&colorCode=%237c3aed`;
  window.open(moonpayUrl, "_blank", "width=420,height=640");
});

$("#fund-crypto").addEventListener("click", () => {
  const box = $("#fund-address-box");
  box.classList.remove("hidden");
  if (walletAddress) {
    $("#fund-address").textContent = walletAddress;
  } else {
    $("#fund-address").textContent = "Sign in to get your address";
  }
});

$("#copy-address").addEventListener("click", () => {
  if (walletAddress) {
    navigator.clipboard.writeText(walletAddress);
    $("#copy-address").title = "Copied!";
    setTimeout(() => { $("#copy-address").title = "Copy"; }, 2000);
  }
});

// ─── Chat ───
const input = $("#input");
const sendBtn = $("#send");
const messages = $("#messages");

input.addEventListener("input", () => {
  sendBtn.disabled = !input.value.trim() || streaming;
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 120) + "px";
});

input.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (input.value.trim() && !streaming) send(input.value.trim());
  }
});

sendBtn.addEventListener("click", () => {
  if (input.value.trim() && !streaming) send(input.value.trim());
});

// Suggestions + feature cards
document.addEventListener("click", e => {
  const s = e.target.closest(".suggestion");
  if (s) send(s.dataset.prompt);

  const card = e.target.closest(".feature-card");
  if (card) {
    if (card.classList.contains("locked")) {
      // Subtle shake animation, no send
      card.classList.remove("shake");
      void card.offsetWidth; // restart animation
      card.classList.add("shake");
      return;
    }
    if (card.dataset.prompt) send(card.dataset.prompt);
  }
});

// Snapshot the welcome HTML on first load so we can restore it for new chats
let _welcomeSnapshot = null;
(function captureWelcome() {
  const orig = document.querySelector("#welcome");
  if (orig) _welcomeSnapshot = orig.outerHTML;
})();

function addWelcome() {
  if (_welcomeSnapshot) {
    messages.innerHTML = _welcomeSnapshot;
  }
}

function addMsg(role, content) {
  const w = messages.querySelector(".welcome");
  if (w) w.remove();

  const div = document.createElement("div");
  div.className = `msg ${role}`;
  const av = role === "assistant" ? "S" : (userEmail ? userEmail[0].toUpperCase() : "Y");
  div.innerHTML = `
    <div class="msg-avatar">${av}</div>
    <div class="msg-body">
      <div class="msg-text">${role === "user" ? esc(content) : ""}</div>
    </div>`;
  messages.appendChild(div);
  scroll();
  return div.querySelector(".msg-text");
}

function addToolIndicator(toolName) {
  const bodies = messages.querySelectorAll(".msg.assistant .msg-body");
  const body = bodies[bodies.length - 1];
  if (!body) return null;

  // For "computer" tool, return the existing computer card if it exists,
  // otherwise create one. This coalesces all computer actions into one card.
  if (toolName === "computer") {
    let card = body.querySelector(".computer-card");
    if (!card) card = createComputerCard(body);
    return card;
  }

  const names = {
    product_search: "Searching products",
    buy_product: "Processing purchase",
    buy_gift_card: "Processing payment",
    list_gift_card_merchants: "Loading stores",
    jupiter_swap: "Swapping",
    jupiter_quote: "Getting quote",
    token_price: "Checking price",
    wallet_balance: "Checking balance",
    send_payment: "Sending",
    prediction_search: "Searching markets",
    prediction_bet: "Placing bet",
    defi_stake: "Setting up savings",
    defi_lend: "Setting up savings",
    defi_yield_search: "Finding rates",
    stock_trade: "Trading",
    stock_quote: "Getting quote",
    portfolio_summary: "Loading portfolio",
    transaction_history: "Loading activity",
    save_credential: "Saving login",
    get_credential: "Getting login",
    list_credentials: "Loading logins",
    remember: "Remembering",
    forget: "Updating memory",
  };

  const label = names[toolName] || toolName.replace(/_/g, " ");
  const el = document.createElement("div");
  el.className = "tool-indicator";
  el.innerHTML = `<div class="spinner"></div><span>${label}...</span>`;

  const text = body.querySelector(".msg-text");
  body.insertBefore(el, text);
  scroll();
  return el;
}

function createComputerCard(body) {
  const card = document.createElement("div");
  card.className = "computer-card";
  card.dataset.actionCount = "0";
  card.innerHTML = `
    <div class="computer-header">
      <div class="computer-icon">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
      </div>
      <div class="computer-status">
        <div class="computer-spinner"></div>
        <span class="computer-status-text">Working...</span>
      </div>
      <div class="computer-action-count">0</div>
    </div>
  `;
  const text = body.querySelector(".msg-text");
  body.insertBefore(card, text);
  return card;
}

function updateComputerCard(card, action, label, screenshotB64) {
  if (!card) return;
  const count = parseInt(card.dataset.actionCount || "0", 10) + 1;
  card.dataset.actionCount = String(count);

  const statusText = card.querySelector(".computer-status-text");
  if (statusText) statusText.textContent = label || action;

  const counter = card.querySelector(".computer-action-count");
  if (counter) counter.textContent = `${count}`;

  scroll();
}

function finishComputerCard(card) {
  if (!card) return;
  card.classList.add("done");
  const statusText = card.querySelector(".computer-status-text");
  if (statusText) statusText.textContent = "Done";
}

function finishToolIndicator(el, result, toolName) {
  if (!el) return;
  el.className = "tool-indicator done";

  const hasError = result?.error;
  const labelText = el.querySelector("span")?.textContent?.replace("...", "") || "Done";
  el.innerHTML = `<span class="check">${hasError ? "!" : "\u2713"}</span><span>${labelText}${hasError ? " — error" : ""}</span>`;

  if (hasError) {
    scroll();
    return;
  }

  // Render rich UI based on result type
  if (result?.ui_type === "product_grid" && result.products) {
    const grid = renderProductGrid(result.products);
    el.parentNode.insertBefore(grid, el.nextSibling);
  } else if (result?.ui_type === "gift_card_receipt") {
    const card = renderGiftCardReceipt(result);
    el.parentNode.insertBefore(card, el.nextSibling);
  } else if (result?.ui_type === "trade_receipt") {
    const card = renderTradeReceipt(result);
    el.parentNode.insertBefore(card, el.nextSibling);
  }

  scroll();
}

function renderProductGrid(products) {
  const grid = document.createElement("div");
  grid.className = "product-grid";

  products.forEach(p => {
    const card = document.createElement("div");
    card.className = "product-card";
    const ratingHtml = p.rating ? `<span class="product-rating">${"\u2605".repeat(Math.round(p.rating))}</span> ${p.rating}${p.reviews ? ` <span>(${p.reviews})</span>` : ""}` : "";
    card.innerHTML = `
      <div class="product-image">
        ${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.title)}" onerror="this.style.display='none';this.parentNode.innerHTML='<div class=&quot;product-image-placeholder&quot;>image</div>'">` : `<div class="product-image-placeholder">image</div>`}
      </div>
      <div class="product-info">
        <div class="product-store">${esc(p.store || "Store")}</div>
        <div class="product-title">${esc(p.title || "Product")}</div>
        ${ratingHtml ? `<div class="product-meta">${ratingHtml}</div>` : ""}
        <div class="product-price-row">
          <div class="product-price">${esc(p.price || "$—")}</div>
        </div>
        <div class="product-actions">
          <button class="product-buy-btn" data-product='${esc(JSON.stringify({title: p.title, price: p.price, extracted_price: p.extracted_price, store: p.store, url: p.url}))}'>Buy</button>
          ${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener" class="product-link-btn">View</a>` : ""}
        </div>
      </div>
    `;
    grid.appendChild(card);
  });

  // Wire up buy buttons
  grid.querySelectorAll(".product-buy-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const data = JSON.parse(btn.getAttribute("data-product"));
      const price = data.extracted_price || (data.price ? parseFloat(String(data.price).replace(/[^0-9.]/g, "")) : 0);
      const msg = `Buy this for me: ${data.title} from ${data.store} for $${price}${data.url ? ` (${data.url})` : ""}`;
      send(msg);
    });
  });

  return grid;
}

function renderGiftCardReceipt(r) {
  const div = document.createElement("div");
  div.className = "receipt-card";
  const hasCode = r.redemption_code && !r.redemption_code.includes("Pending") && !r.redemption_code.includes("Delivering");
  const hasLink = r.redemption_link;
  div.innerHTML = `
    <div class="receipt-header">
      <div class="receipt-icon">\u2713</div>
      <div>
        <div class="receipt-title">Purchase complete</div>
        <div class="receipt-subtitle">${esc(r.merchant)}${r.amount_usd ? " \u2022 $" + r.amount_usd : ""}</div>
      </div>
    </div>
    <div class="receipt-body">
      ${hasCode ? `
        <div>
          <div class="label" style="font-size:12px;color:var(--text-3);margin-bottom:6px;font-weight:500">Redemption code</div>
          <div class="receipt-code">
            <span>${esc(r.redemption_code)}</span>
            <button class="copy-code-btn">Copy</button>
          </div>
        </div>
      ` : ""}
      ${hasLink ? `
        <div>
          <div class="label" style="font-size:12px;color:var(--text-3);margin-bottom:6px;font-weight:500">Redeem at</div>
          <a href="${esc(r.redemption_link)}" target="_blank" rel="noopener" class="redeem-link-btn">Open redemption page \u2192</a>
        </div>
      ` : ""}
      ${!hasCode && !hasLink ? `
        <div class="receipt-row"><span class="label">Status</span><span class="value">Delivering... check your activity in a few minutes</span></div>
      ` : ""}
      <div class="receipt-row"><span class="label">Store</span><span class="value">${esc(r.merchant)}</span></div>
      ${r.amount_usd ? `<div class="receipt-row"><span class="label">Paid</span><span class="value">$${r.amount_usd}</span></div>` : ""}
      ${r.invoice_id ? `<div class="receipt-row"><span class="label">Order ID</span><span class="value" style="font-family:var(--mono);font-size:11px">${esc(r.invoice_id.slice(0, 12))}...</span></div>` : ""}
      ${r.explorer ? `<a href="${esc(r.explorer)}" target="_blank" class="receipt-link">View transaction on Solscan</a>` : ""}
    </div>
  `;

  const copyBtn = div.querySelector(".copy-code-btn");
  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(r.redemption_code);
      copyBtn.textContent = "Copied";
      setTimeout(() => copyBtn.textContent = "Copy", 2000);
    });
  }

  return div;
}

function renderTradeReceipt(r) {
  const div = document.createElement("div");
  div.className = "receipt-card";
  const isBuy = r.side === "buy";
  div.innerHTML = `
    <div class="receipt-header">
      <div class="receipt-icon">\u2713</div>
      <div>
        <div class="receipt-title">${isBuy ? "Bought" : "Sold"} ${esc(r.symbol)}</div>
        <div class="receipt-subtitle">$${r.amount_usd}</div>
      </div>
    </div>
    <div class="receipt-body">
      <div class="receipt-row"><span class="label">${isBuy ? "Stock" : "Sold"}</span><span class="value">${esc(r.symbol)}</span></div>
      <div class="receipt-row"><span class="label">Amount</span><span class="value">$${r.amount_usd}</span></div>
      ${r.shares_received ? `<div class="receipt-row"><span class="label">Shares</span><span class="value">${r.shares_received.toFixed(4)}</span></div>` : ""}
      ${r.usd_received ? `<div class="receipt-row"><span class="label">Received</span><span class="value">$${r.usd_received.toFixed(2)}</span></div>` : ""}
      ${r.explorer ? `<a href="${esc(r.explorer)}" target="_blank" class="receipt-link">View transaction</a>` : ""}
    </div>
  `;
  return div;
}

async function send(text) {
  streaming = true;
  sendBtn.disabled = true;
  input.value = "";
  input.style.height = "auto";

  addMsg("user", text);
  const textEl = addMsg("assistant", "");
  textEl.innerHTML = `<div class="typing"><span></span><span></span><span></span></div>`;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { "Authorization": `Bearer ${authToken}` } : {})
      },
      body: JSON.stringify({ message: text, sessionId, walletAddress, userEmail })
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let started = false;
    let raw = "";
    let currentTool = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (!payload) continue;
        let ev;
        try { ev = JSON.parse(payload); } catch { continue; }

        switch (ev.type) {
          case "text":
            if (!started) { textEl.innerHTML = ""; started = true; }
            raw += ev.content;
            textEl.innerHTML = md(raw);
            scroll();
            break;
          case "tool_start":
            if (!started) { textEl.innerHTML = ""; started = true; }
            currentTool = addToolIndicator(ev.tool);
            break;
          case "computer_action":
            // Live preview update for computer use — coalesces into single card
            if (!started) { textEl.innerHTML = ""; started = true; }
            const card = currentTool && currentTool.classList?.contains("computer-card")
              ? currentTool
              : addToolIndicator("computer");
            updateComputerCard(card, ev.action, ev.label, ev.screenshot);
            currentTool = card;
            break;
          case "tool_result":
            // For computer tool, finalize the card; for others, normal indicator
            if (ev.tool === "computer") {
              // Don't tear down — let next computer action update the same card
              // We'll finalize when the assistant message ends (in 'done' handler)
            } else {
              finishToolIndicator(currentTool, ev.result, ev.tool);
              currentTool = null;
              if (["jupiter_swap", "send_payment", "defi_stake", "stock_trade"].includes(ev.tool)) {
                setTimeout(loadBalance, 2000);
              }
            }
            break;
          case "done":
            if (ev.sessionId) { sessionId = ev.sessionId; localStorage.setItem("sano_sid", sessionId); }
            // Finalize any open computer card
            const openCards = messages.querySelectorAll(".computer-card:not(.done)");
            openCards.forEach(c => finishComputerCard(c));
            // Reload chat list so new chats appear
            if (typeof loadChatList === "function") setTimeout(loadChatList, 300);
            break;
          case "error":
            started = true; // mark started so the no-response fallback doesn't overwrite this
            textEl.innerHTML = `<span style="color:var(--red)">Something went wrong: ${esc(ev.message)}</span>`;
            break;
        }
      }
    }

    if (!started) textEl.innerHTML = `<span style="color:var(--text-3)">No response. Try again or refresh.</span>`;
  } catch (err) {
    textEl.innerHTML = `<span style="color:var(--red)">Connection error. Check that the server is running.</span>`;
  }

  streaming = false;
  sendBtn.disabled = !input.value.trim();
  scroll();
}

function scroll() { messages.scrollTop = messages.scrollHeight; }

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function md(text) {
  if (!text) return "";
  let h = esc(text);
  h = h.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  h = h.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  h = h.replace(/^- (.+)$/gm, '<li>$1</li>');
  h = h.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
  h = h.replace(/<\/ul>\s*<ul>/g, '');
  h = h.replace(/\|(.+)\|\n\|[-| ]+\|\n((?:\|.+\|\n?)+)/g, (_, hdr, body) => {
    const hs = hdr.split('|').map(x => x.trim()).filter(Boolean);
    const rs = body.trim().split('\n').map(r => r.split('|').map(c => c.trim()).filter(Boolean));
    return '<table><thead><tr>' + hs.map(x => `<th>${x}</th>`).join('') + '</tr></thead><tbody>' +
      rs.map(r => '<tr>' + r.map(c => `<td>${c}</td>`).join('') + '</tr>').join('') + '</tbody></table>';
  });
  h = h.replace(/\n\n/g, '</p><p>');
  h = h.replace(/\n/g, '<br>');
  h = '<p>' + h + '</p>';
  h = h.replace(/<p><\/p>/g, '');
  h = h.replace(/<p>(<h3>)/g, '$1').replace(/(<\/h3>)<\/p>/g, '$1');
  h = h.replace(/<p>(<table>)/g, '$1').replace(/(<\/table>)<\/p>/g, '$1');
  h = h.replace(/<p>(<ul>)/g, '$1').replace(/(<\/ul>)<\/p>/g, '$1');
  h = h.replace(/<p>(<pre>)/g, '$1').replace(/(<\/pre>)<\/p>/g, '$1');
  return h;
}

// ═════════════════════════════════════════════════════════════════
//  NAVBAR / SETTINGS / CHATS / ORDERS / WITHDRAW
// ═════════════════════════════════════════════════════════════════

// ─── Theme toggle ───
$("#theme-toggle").addEventListener("click", () => {
  const current = localStorage.getItem("sano_theme") || "light";
  const next = current === "dark" ? "light" : "dark";
  localStorage.setItem("sano_theme", next);
  applyTheme(next);
  userSettings.theme = next;
  saveUserSettings();
});

// ─── Settings modal ───
$("#settings-btn").addEventListener("click", async () => {
  $("#settings-modal").classList.remove("hidden");
  // Load current settings
  if (userEmail) {
    try {
      const res = await fetch(`/api/settings?email=${encodeURIComponent(userEmail)}`);
      userSettings = await res.json();
    } catch (e) {}
  }
  $("#setting-language").value = userSettings.language || "en";
  $("#setting-country").value = userSettings.country || "US";
  // Address fields
  const a = userSettings.address || {};
  $("#addr-name").value = a.name || "";
  $("#addr-phone").value = a.phone || "";
  $("#addr-line1").value = a.line1 || "";
  $("#addr-line2").value = a.line2 || "";
  $("#addr-city").value = a.city || "";
  $("#addr-state").value = a.state || "";
  $("#addr-postal").value = a.postal || "";
  $("#addr-country").value = a.country || "";
  applyTheme(userSettings.theme || "light");
});
$("#settings-modal-close").addEventListener("click", () => $("#settings-modal").classList.add("hidden"));
$("#settings-modal").addEventListener("click", e => { if (e.target.id === "settings-modal") $("#settings-modal").classList.add("hidden"); });

$$(".theme-option").forEach(btn => {
  btn.addEventListener("click", () => {
    const theme = btn.dataset.theme;
    localStorage.setItem("sano_theme", theme);
    applyTheme(theme);
    userSettings.theme = theme;
  });
});

$("#settings-save").addEventListener("click", async () => {
  userSettings.language = $("#setting-language").value;
  userSettings.country = $("#setting-country").value;
  userSettings.address = {
    name: $("#addr-name").value.trim(),
    phone: $("#addr-phone").value.trim(),
    line1: $("#addr-line1").value.trim(),
    line2: $("#addr-line2").value.trim(),
    city: $("#addr-city").value.trim(),
    state: $("#addr-state").value.trim(),
    postal: $("#addr-postal").value.trim(),
    country: $("#addr-country").value.trim()
  };
  await saveUserSettings();
  $("#settings-modal").classList.add("hidden");
});

async function saveUserSettings() {
  if (!userEmail) return;
  try {
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: userEmail, settings: userSettings })
    });
  } catch (e) {}
}

// ─── Chat list ───
async function loadChatList() {
  if (!userEmail) return;
  try {
    const res = await fetch(`/api/chats?email=${encodeURIComponent(userEmail)}`);
    const data = await res.json();
    renderChatList(data.chats || []);
  } catch (e) {}
}

function renderChatList(chats) {
  const list = $("#chat-list");
  if (chats.length === 0) {
    list.innerHTML = `<div style="padding:12px;font-size:12px;color:var(--text-4);text-align:center">No chats yet</div>`;
    return;
  }
  list.innerHTML = chats.map(c => `
    <div class="chat-list-item ${c.id === sessionId ? "active" : ""}" data-chat-id="${esc(c.id)}">
      <div class="chat-list-item-title">${esc(c.title)}</div>
      <button class="chat-list-delete" data-delete="${esc(c.id)}" title="Delete">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    </div>
  `).join("");

  $$(".chat-list-item").forEach(el => {
    el.addEventListener("click", async (e) => {
      if (e.target.closest(".chat-list-delete")) return;
      await switchToChat(el.dataset.chatId);
    });
  });
  $$(".chat-list-delete").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.dataset.delete;
      try {
        await fetch(`/api/chats/${id}?email=${encodeURIComponent(userEmail)}`, { method: "DELETE" });
        if (id === sessionId) {
          sessionId = null;
          localStorage.removeItem("sano_sid");
          messages.innerHTML = "";
          addWelcome();
          $("#current-chat-title").textContent = "New chat";
        }
        loadChatList();
      } catch (e) {}
    });
  });
}

async function switchToChat(chatId) {
  try {
    const res = await fetch(`/api/chats/${chatId}?email=${encodeURIComponent(userEmail)}`);
    const chat = await res.json();
    if (chat.error) return;
    sessionId = chatId;
    localStorage.setItem("sano_sid", sessionId);
    $("#current-chat-title").textContent = chat.title || "Chat";
    messages.innerHTML = "";
    for (const m of chat.messages || []) {
      if (typeof m.content === "string" && m.content.trim()) {
        const textEl = addMsg(m.role, m.content);
        if (m.role === "assistant") textEl.innerHTML = md(m.content);
      }
    }
    loadChatList();
  } catch (e) {
    console.error("Failed to switch chat:", e);
  }
}

// Override new-chat button
const origNewChat = $("#new-chat");
if (origNewChat) {
  origNewChat.replaceWith(origNewChat.cloneNode(true));
  $("#new-chat").addEventListener("click", () => {
    sessionId = null;
    localStorage.removeItem("sano_sid");
    messages.innerHTML = "";
    addWelcome();
    $("#current-chat-title").textContent = "New chat";
    loadChatList();
  });
}

// ─── Orders panel ───
$("#orders-btn").addEventListener("click", () => {
  $("#orders-panel").classList.remove("hidden");
  loadOrders();
});
$("#orders-close").addEventListener("click", () => $("#orders-panel").classList.add("hidden"));

async function loadOrders() {
  $("#orders-list").innerHTML = `<div class="portfolio-empty">Loading...</div>`;
  try {
    const res = await fetch("/api/orders");
    const data = await res.json();
    const orders = data.orders || [];
    if (orders.length === 0) {
      $("#orders-list").innerHTML = `<div class="portfolio-empty">No orders yet. Buy something to get started.</div>`;
      return;
    }
    $("#orders-list").innerHTML = orders.map(o => {
      const firstItem = (o.cart_items && o.cart_items[0]) || {};
      const name = firstItem.name || o.product_name || "Order";
      const amount = o.payment_info?.altcoinPrice || firstItem.payment_price || o.total || "—";
      const status = o.payment_status || o.status || "paid";
      const date = o.created_time || o.created || "";
      return `
        <div class="order-row">
          <div class="order-info">
            <div class="order-name">${esc(name)}</div>
            <div class="order-meta">${esc(new Date(date).toLocaleString())} \u2022 <span class="order-status ${status.toLowerCase()}">${esc(status)}</span></div>
          </div>
          <div class="order-price">$${esc(String(amount))}</div>
        </div>
      `;
    }).join("");
  } catch (e) {
    $("#orders-list").innerHTML = `<div class="portfolio-empty">Couldn't load orders.</div>`;
  }
}

// ─── Withdraw modal ───
$("#withdraw-btn").addEventListener("click", () => {
  $("#withdraw-modal").classList.remove("hidden");
  $("#withdraw-error").classList.add("hidden");
});
$("#withdraw-modal-close").addEventListener("click", () => $("#withdraw-modal").classList.add("hidden"));
$("#withdraw-modal").addEventListener("click", e => { if (e.target.id === "withdraw-modal") $("#withdraw-modal").classList.add("hidden"); });

$("#withdraw-submit").addEventListener("click", async () => {
  const token = $("#withdraw-asset").value;
  const amount = parseFloat($("#withdraw-amount").value);
  const address = $("#withdraw-address").value.trim();

  if (!amount || amount <= 0) {
    $("#withdraw-error").textContent = "Enter a valid amount.";
    $("#withdraw-error").classList.remove("hidden");
    return;
  }
  if (!address) {
    $("#withdraw-error").textContent = "Enter a destination address.";
    $("#withdraw-error").classList.remove("hidden");
    return;
  }

  $("#withdraw-submit").disabled = true;
  $("#withdraw-submit").textContent = "Sending...";
  $("#withdraw-error").classList.add("hidden");

  try {
    const res = await fetch("/api/withdraw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: userEmail, token, amount, address })
    });
    const data = await res.json();
    if (data.error) {
      $("#withdraw-error").textContent = data.error;
      $("#withdraw-error").classList.remove("hidden");
    } else if (data.status === "completed") {
      $("#withdraw-modal").classList.add("hidden");
      $("#withdraw-amount").value = "";
      $("#withdraw-address").value = "";
      loadBalance();
      alert(`Sent ${amount} ${token}!${data.explorer ? "\n" + data.explorer : ""}`);
    } else {
      $("#withdraw-error").textContent = data.message || "Withdraw failed";
      $("#withdraw-error").classList.remove("hidden");
    }
  } catch (e) {
    $("#withdraw-error").textContent = "Connection error.";
    $("#withdraw-error").classList.remove("hidden");
  }

  $("#withdraw-submit").disabled = false;
  $("#withdraw-submit").textContent = "Withdraw";
});

// Load chat list + settings on app entry
// (hooked in via a small observer on the #app element — runs when it becomes visible)
function bootstrapAfterAuth() {
  loadChatList();
  if (userEmail) {
    fetch(`/api/settings?email=${encodeURIComponent(userEmail)}`).then(r => r.json()).then(s => {
      userSettings = s;
      if (s.theme) applyTheme(s.theme);
    }).catch(() => {});
  }
}

// Run bootstrap when the app becomes visible
new MutationObserver(() => {
  if (!appEl.classList.contains("hidden") && userEmail) {
    bootstrapAfterAuth();
  }
}).observe(appEl, { attributes: true, attributeFilter: ["class"] });

// Also run it immediately if already authenticated on page load
if (!appEl.classList.contains("hidden") && userEmail) {
  bootstrapAfterAuth();
}
