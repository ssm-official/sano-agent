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
  $("#auth-verify").textContent = "Verifying...";
  $("#auth-error").classList.add("hidden");

  try {
    const res = await fetch("/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code })
    });
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
      <p>I can shop for products, book travel, send money, trade, and more. Just ask.</p>
      <div class="suggestions">
        <button class="suggestion" data-prompt="Find me wireless earbuds under $50">Find wireless earbuds under $50</button>
        <button class="suggestion" data-prompt="Search flights from LA to New York next Friday">Flights LA to New York</button>
        <button class="suggestion" data-prompt="Send $25 to alex.sol">Send $25 to a friend</button>
        <button class="suggestion" data-prompt="What's the price of Bitcoin right now?">Check Bitcoin price</button>
        <button class="suggestion" data-prompt="I want to earn interest on my balance">Earn interest</button>
        <button class="suggestion" data-prompt="Create a virtual card with $100 for online shopping">Get a virtual card</button>
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
    amazon_search: "Searching Amazon",
    shopify_search: "Searching stores",
    jupiter_swap: "Executing swap",
    jupiter_quote: "Getting quote",
    token_price: "Checking price",
    wallet_balance: "Checking balance",
    flight_search: "Searching flights",
    hotel_search: "Searching hotels",
    flight_book: "Booking flight",
    hotel_book: "Booking hotel",
    send_payment: "Preparing transfer",
    prediction_search: "Searching markets",
    prediction_bet: "Placing bet",
    defi_stake: "Setting up staking",
    defi_lend: "Setting up lending",
    defi_yield_search: "Finding rates",
    stock_trade: "Executing trade",
    stock_quote: "Getting quote",
    create_virtual_card: "Creating card",
    portfolio_summary: "Loading portfolio",
    transaction_history: "Loading history",
    price_compare: "Comparing prices",
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

function finishToolIndicator(el, result) {
  if (!el) return;
  el.className = "tool-indicator done";

  const hasError = result?.error;
  el.innerHTML = `<span class="check">${hasError ? "!" : "\u2713"}</span><span>${el.querySelector("span")?.textContent?.replace("...", "") || "Done"}${hasError ? " — error" : ""}</span>`;

  if (result && !hasError) {
    const detail = document.createElement("div");
    detail.className = "tool-detail";
    detail.textContent = JSON.stringify(result, null, 2).slice(0, 600);
    detail.addEventListener("click", () => detail.classList.toggle("expanded"));
    el.parentNode.insertBefore(detail, el.nextSibling);
  }
  scroll();
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
      body: JSON.stringify({ message: text, sessionId, walletAddress })
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
            finishToolIndicator(currentTool, ev.result);
            currentTool = null;
            if (["jupiter_swap", "send_payment", "defi_stake"].includes(ev.tool)) {
              setTimeout(loadBalance, 2000);
            }
            break;
          case "done":
            if (ev.sessionId) { sessionId = ev.sessionId; localStorage.setItem("sano_sid", sessionId); }
            break;
          case "error":
            textEl.innerHTML = `<span style="color:var(--red)">Something went wrong: ${esc(ev.message)}</span>`;
            break;
        }
      }
    }

    if (!started) textEl.innerHTML = `<span style="color:var(--text-3)">No response.</span>`;
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
