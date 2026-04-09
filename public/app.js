// ─── SANO Agent — Production Frontend ───

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

let sessionId = localStorage.getItem("sano_sid") || null;
let streaming = false;
let userEmail = null;
let walletAddress = null;
let authToken = null;

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
    send(btn.dataset.prompt);
    $("#sidebar").classList.remove("open");
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

// ─── Backup Key Modal ───
$("#backup-key-btn").addEventListener("click", async () => {
  $("#backup-modal").classList.remove("hidden");
  $("#backup-key-display").textContent = "Loading...";
  $("#backup-wallet-display").textContent = walletAddress || "—";
  try {
    const res = await fetch("/api/wallet/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: userEmail })
    });
    const data = await res.json();
    if (data.error) {
      $("#backup-key-display").textContent = "Error: " + data.error;
    } else {
      $("#backup-key-display").textContent = data.private_key;
      $("#backup-wallet-display").textContent = data.wallet;
    }
  } catch (e) {
    $("#backup-key-display").textContent = "Could not load key";
  }
});
$("#backup-modal-close").addEventListener("click", () => $("#backup-modal").classList.add("hidden"));
$("#backup-modal").addEventListener("click", e => { if (e.target.id === "backup-modal") $("#backup-modal").classList.add("hidden"); });
$("#copy-backup-key").addEventListener("click", () => {
  const key = $("#backup-key-display").textContent;
  if (key && !key.includes("Error") && !key.includes("Loading")) {
    navigator.clipboard.writeText(key);
    $("#copy-backup-key").textContent = "Copied";
    setTimeout(() => $("#copy-backup-key").textContent = "Copy", 2000);
  }
});

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

// Suggestions
document.addEventListener("click", e => {
  const s = e.target.closest(".suggestion");
  if (s) send(s.dataset.prompt);
});

function addWelcome() {
  messages.innerHTML = `
    <div class="welcome" id="welcome">
      <h2>What can I help you with?</h2>
      <p>Shop, trade stocks, swap currencies, send money. Just ask.</p>
      <div class="suggestions">
        <button class="suggestion" data-prompt="Find me wireless earbuds under $50">Find wireless earbuds</button>
        <button class="suggestion" data-prompt="Buy $100 of Apple stock">Buy $100 of Apple stock</button>
        <button class="suggestion" data-prompt="Find me a Sony PlayStation 5">Find a PS5</button>
        <button class="suggestion" data-prompt="Send $25 to a friend">Send money</button>
        <button class="suggestion" data-prompt="What's Bitcoin worth right now?">Check Bitcoin price</button>
        <button class="suggestion" data-prompt="Find me Nike Air Force 1 size 10">Find Nike sneakers</button>
      </div>
    </div>`;
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
  div.innerHTML = `
    <div class="receipt-header">
      <div class="receipt-icon">\u2713</div>
      <div>
        <div class="receipt-title">Purchase complete</div>
        <div class="receipt-subtitle">${esc(r.merchant)} \u2022 $${r.amount_usd}</div>
      </div>
    </div>
    <div class="receipt-body">
      <div class="receipt-row"><span class="label">Store</span><span class="value">${esc(r.merchant)}</span></div>
      <div class="receipt-row"><span class="label">Amount</span><span class="value">$${r.amount_usd}</span></div>
      ${r.redemption_code && !r.redemption_code.includes("Pending") ? `
        <div style="margin-top:4px">
          <div class="label" style="font-size:12px;color:var(--text-3);margin-bottom:6px">Your code:</div>
          <div class="receipt-code">
            <span>${esc(r.redemption_code)}</span>
            <button class="copy-code-btn">Copy</button>
          </div>
        </div>
      ` : `
        <div class="receipt-row"><span class="label">Code</span><span class="value">Delivering...</span></div>
      `}
      ${r.explorer ? `<a href="${esc(r.explorer)}" target="_blank" class="receipt-link">View transaction</a>` : ""}
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
          case "tool_result":
            finishToolIndicator(currentTool, ev.result, ev.tool);
            currentTool = null;
            if (["jupiter_swap", "send_payment", "defi_stake"].includes(ev.tool)) {
              setTimeout(loadBalance, 2000);
            }
            break;
          case "done":
            if (ev.sessionId) { sessionId = ev.sessionId; localStorage.setItem("sano_sid", sessionId); }
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
