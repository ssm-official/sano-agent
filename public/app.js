// ─── SANO Agent Frontend — Real Integrations ───

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let sessionId = localStorage.getItem("sano_session") || null;
let isStreaming = false;
let privyClient = null;
let currentUser = null;
let walletAddress = null;

// ─── PRIVY AUTH ───
const PRIVY_APP_ID = window.__SANO_CONFIG__?.PRIVY_APP_ID || "PRIVY_APP_ID_PLACEHOLDER";

async function initPrivy() {
  if (typeof window.Privy === "undefined") {
    console.warn("Privy SDK not loaded yet, retrying...");
    setTimeout(initPrivy, 500);
    return;
  }

  try {
    privyClient = new window.Privy.PrivyClient(PRIVY_APP_ID, {
      appearance: {
        theme: "dark",
        accentColor: "#6c5ce7",
        logo: null
      },
      embeddedWallets: {
        createOnLogin: "all-users",
        defaultChain: "solana"
      },
      loginMethods: ["email", "wallet", "google", "twitter"],
      solanaClusters: [{ name: "mainnet-beta", rpcUrl: "https://api.mainnet-beta.solana.com" }]
    });

    // Check if already authenticated
    const isAuth = await privyClient.isAuthenticated?.();
    if (isAuth) {
      await handleLogin();
    }
  } catch (e) {
    console.log("Privy init:", e.message);
  }
}

async function handleLogin() {
  try {
    currentUser = await privyClient.getUser?.();
    if (currentUser) {
      // Find Solana wallet
      const solWallet = currentUser.linkedAccounts?.find(a => a.type === "wallet" && a.chainType === "solana");
      if (solWallet) {
        walletAddress = solWallet.address;
      } else if (currentUser.wallet?.address) {
        walletAddress = currentUser.wallet.address;
      }
      enterApp();
      updateWalletUI();
    }
  } catch (e) {
    console.log("Login handler:", e.message);
    // Still enter app even if user fetch fails
    enterApp();
  }
}

async function privyLogin() {
  try {
    if (privyClient?.login) {
      await privyClient.login();
      await handleLogin();
    } else {
      // Fallback: enter app without Privy if SDK isn't loaded properly
      console.log("Privy not fully initialized, entering demo mode");
      enterApp();
    }
  } catch (e) {
    console.log("Privy login:", e.message);
    // Still let users in
    enterApp();
  }
}

async function updateWalletUI() {
  const addrEl = $("#wallet-addr");
  const balEl = $("#wallet-bal");

  if (walletAddress) {
    addrEl.textContent = walletAddress.slice(0, 4) + "..." + walletAddress.slice(-4);

    // Fetch real balance from our API
    try {
      const res = await fetch("/api/wallet/balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: walletAddress })
      });
      const data = await res.json();
      if (data.sol !== undefined) {
        balEl.textContent = `${data.sol.toFixed(3)} SOL`;
        if (data.usdc !== undefined) {
          balEl.textContent += ` · $${data.usdc.toFixed(2)}`;
        }
      }
    } catch (e) {
      balEl.textContent = "Balance unavailable";
    }
  } else {
    addrEl.textContent = "No wallet";
    balEl.textContent = "Connect in settings";
  }
}

// ─── APP ENTRY ───
const onboarding = $("#onboarding");
const appEl = $("#app");

function enterApp() {
  onboarding.classList.add("hidden");
  appEl.classList.remove("hidden");
  localStorage.setItem("sano_onboarded", "true");
  loadToolCategories();
  $("#chat-input").focus();
}

// Check if returning user
if (localStorage.getItem("sano_onboarded")) {
  enterApp();
  initPrivy();
} else {
  initPrivy();
}

// Login button
$("#btn-privy-login").addEventListener("click", async () => {
  await privyLogin();
});

// Logout
$("#logout-btn").addEventListener("click", async () => {
  try {
    if (privyClient?.logout) await privyClient.logout();
  } catch (e) {}
  walletAddress = null;
  currentUser = null;
  localStorage.removeItem("sano_onboarded");
  localStorage.removeItem("sano_session");
  sessionId = null;
  appEl.classList.add("hidden");
  onboarding.classList.remove("hidden");
});

// ─── SIDEBAR ───
$("#sidebar-toggle").addEventListener("click", () => {
  $("#sidebar").classList.toggle("open");
});

$("#new-chat-btn").addEventListener("click", () => {
  sessionId = null;
  localStorage.removeItem("sano_session");
  const msgs = $("#chat-messages");
  msgs.innerHTML = "";
  addWelcome();
});

$$(".quick-action").forEach(btn => {
  btn.addEventListener("click", () => {
    sendMessage(btn.dataset.prompt);
  });
});

// ─── TOOLS PANEL ───
$("#tools-btn").addEventListener("click", () => {
  $("#tools-panel").classList.toggle("hidden");
});

$("#close-tools").addEventListener("click", () => {
  $("#tools-panel").classList.add("hidden");
});

async function loadToolCategories() {
  try {
    const res = await fetch("/api/tools");
    const data = await res.json();

    const catContainer = $("#tool-categories");
    catContainer.innerHTML = "";
    for (const [cat, toolNames] of Object.entries(data.categories)) {
      const div = document.createElement("div");
      div.className = "tool-cat";
      div.innerHTML = `${cat}<span class="tool-cat-count">${toolNames.length}</span>`;
      catContainer.appendChild(div);
    }

    const toolsList = $("#tools-list");
    toolsList.innerHTML = "";
    for (const [cat, toolNames] of Object.entries(data.categories)) {
      const title = document.createElement("div");
      title.className = "tool-group-title";
      title.textContent = cat;
      toolsList.appendChild(title);

      for (const name of toolNames) {
        const tool = data.tools.find(t => t.name === name);
        if (!tool) continue;
        const item = document.createElement("div");
        item.className = "tool-item";
        item.innerHTML = `
          <div class="tool-item-name">${formatToolName(tool.name)}</div>
          <div class="tool-item-desc">${tool.description}</div>
        `;
        toolsList.appendChild(item);
      }
    }
  } catch (e) {
    console.error("Failed to load tools:", e);
  }
}

function formatToolName(name) {
  return name.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// ─── CHAT ───
const chatInput = $("#chat-input");
const sendBtn = $("#send-btn");
const chatMessages = $("#chat-messages");

chatInput.addEventListener("input", () => {
  sendBtn.disabled = !chatInput.value.trim() || isStreaming;
  chatInput.style.height = "auto";
  chatInput.style.height = Math.min(chatInput.scrollHeight, 150) + "px";
});

chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (chatInput.value.trim() && !isStreaming) {
      sendMessage(chatInput.value.trim());
    }
  }
});

sendBtn.addEventListener("click", () => {
  if (chatInput.value.trim() && !isStreaming) {
    sendMessage(chatInput.value.trim());
  }
});

document.addEventListener("click", (e) => {
  const suggestion = e.target.closest(".suggestion");
  if (suggestion) {
    sendMessage(suggestion.dataset.prompt);
  }
});

function addWelcome() {
  chatMessages.innerHTML = `
    <div class="welcome-msg">
      <div class="welcome-icon">S</div>
      <h3>Hey, I'm SANO</h3>
      <p>Your AI agent for shopping, trading, and executing on Solana. Everything is real — live swaps, real payments, actual prices. What can I do for you?</p>
      <div class="suggestion-grid">
        <button class="suggestion" data-prompt="Find me the cheapest wireless earbuds on Amazon">
          <span class="suggestion-icon">🛒</span>
          <span class="suggestion-text">Find me the cheapest wireless earbuds on Amazon</span>
        </button>
        <button class="suggestion" data-prompt="Swap 50 USDC to SOL on Jupiter">
          <span class="suggestion-icon">🔄</span>
          <span class="suggestion-text">Swap 50 USDC to SOL</span>
        </button>
        <button class="suggestion" data-prompt="Bet $10 on BTC above 100k by end of year">
          <span class="suggestion-icon">📊</span>
          <span class="suggestion-text">Bet $10 on BTC above 100k</span>
        </button>
        <button class="suggestion" data-prompt="Search flights from LAX to NYC next Friday">
          <span class="suggestion-icon">✈️</span>
          <span class="suggestion-text">Search flights LAX → NYC</span>
        </button>
        <button class="suggestion" data-prompt="Create a virtual Visa card with $200 for online shopping">
          <span class="suggestion-icon">💳</span>
          <span class="suggestion-text">Create a virtual Visa card</span>
        </button>
        <button class="suggestion" data-prompt="Stake 10 SOL for the best yield">
          <span class="suggestion-icon">🌱</span>
          <span class="suggestion-text">Stake 10 SOL for best yield</span>
        </button>
      </div>
    </div>`;
}

function addMessage(role, content) {
  const welcome = chatMessages.querySelector(".welcome-msg");
  if (welcome) welcome.remove();

  const div = document.createElement("div");
  div.className = `message ${role}`;

  const avatar = role === "assistant" ? "S" : "Y";
  div.innerHTML = `
    <div class="message-avatar">${avatar}</div>
    <div class="message-body">
      <div class="message-content">${role === "user" ? escapeHtml(content) : ""}</div>
    </div>
  `;

  chatMessages.appendChild(div);
  scrollToBottom();
  return div.querySelector(".message-content");
}

function addToolCard(toolName) {
  const toolIcons = {
    amazon: "🛒", shopify: "🛍️", jupiter: "🔄", token: "💰",
    stock: "📈", prediction: "🎯", send: "💸", flight: "✈️",
    hotel: "🏨", wallet: "👛", portfolio: "📊", defi: "🌱",
    credit: "💳", virtual: "💳", subscription: "🔁", price: "📡",
    limit: "⏳", transaction: "📜"
  };

  const iconKey = Object.keys(toolIcons).find(k => toolName.includes(k)) || "⚡";
  const icon = toolIcons[iconKey] || "⚡";

  const bodies = chatMessages.querySelectorAll(".message.assistant .message-body");
  const lastBody = bodies[bodies.length - 1];
  if (!lastBody) return null;

  const card = document.createElement("div");
  card.className = "tool-card";
  card.id = `tool-${toolName}-${Date.now()}`;
  card.innerHTML = `
    <div class="tool-card-header">
      <div class="tool-card-icon">${icon}</div>
      <div class="tool-card-name">${formatToolName(toolName)}</div>
      <div class="tool-card-status running">Executing...</div>
    </div>
  `;

  const content = lastBody.querySelector(".message-content");
  lastBody.insertBefore(card, content);
  scrollToBottom();
  return card;
}

function updateToolCard(card, result) {
  if (!card) return;
  const status = card.querySelector(".tool-card-status");

  if (result.error) {
    status.className = "tool-card-status error";
    status.textContent = "✗ Error";
  } else {
    status.className = "tool-card-status done";
    status.textContent = "✓ Done";
  }

  const detail = document.createElement("div");
  detail.className = "tool-card-detail";
  // Format result nicely
  const display = result.error ? result.error : JSON.stringify(result, null, 2);
  detail.textContent = display.slice(0, 800);
  card.appendChild(detail);
  scrollToBottom();
}

async function sendMessage(text) {
  isStreaming = true;
  sendBtn.disabled = true;
  chatInput.value = "";
  chatInput.style.height = "auto";

  addMessage("user", text);
  const contentEl = addMessage("assistant", "");
  contentEl.innerHTML = `<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>`;

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        sessionId,
        walletAddress: walletAddress || null
      })
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let hasStartedText = false;
    let currentToolCard = null;
    let rawText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw) continue;

        let event;
        try { event = JSON.parse(raw); } catch { continue; }

        switch (event.type) {
          case "text":
            if (!hasStartedText) {
              contentEl.innerHTML = "";
              hasStartedText = true;
            }
            rawText += event.content;
            contentEl.innerHTML = renderMarkdown(rawText);
            scrollToBottom();
            break;

          case "tool_start":
            if (!hasStartedText) {
              contentEl.innerHTML = "";
              hasStartedText = true;
            }
            currentToolCard = addToolCard(event.tool);
            break;

          case "tool_result":
            if (currentToolCard) {
              updateToolCard(currentToolCard, event.result);
              currentToolCard = null;
            }
            // Refresh wallet balance after transactions
            if (["jupiter_swap", "send_payment", "defi_stake", "defi_lend"].includes(event.tool)) {
              setTimeout(updateWalletUI, 2000);
            }
            break;

          case "done":
            if (event.sessionId) {
              sessionId = event.sessionId;
              localStorage.setItem("sano_session", sessionId);
            }
            break;

          case "error":
            contentEl.innerHTML = `<span style="color: var(--red)">Error: ${escapeHtml(event.message)}</span>`;
            break;
        }
      }
    }

    if (!hasStartedText) {
      contentEl.innerHTML = `<span style="color: var(--text-tertiary)">No response received.</span>`;
    }
  } catch (err) {
    contentEl.innerHTML = `<span style="color: var(--red)">Connection error: ${escapeHtml(err.message)}</span>`;
    console.error(err);
  }

  isStreaming = false;
  sendBtn.disabled = !chatInput.value.trim();
  scrollToBottom();
}

function scrollToBottom() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function renderMarkdown(text) {
  if (!text) return "";
  let html = escapeHtml(text);

  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
  html = html.replace(/<\/ul>\s*<ul>/g, '');

  html = html.replace(/\|(.+)\|\n\|[-| ]+\|\n((?:\|.+\|\n?)+)/g, (match, header, body) => {
    const headers = header.split('|').map(h => h.trim()).filter(Boolean);
    const rows = body.trim().split('\n').map(row =>
      row.split('|').map(c => c.trim()).filter(Boolean)
    );
    let table = '<table><thead><tr>' + headers.map(h => `<th>${h}</th>`).join('') + '</tr></thead><tbody>';
    rows.forEach(row => {
      table += '<tr>' + row.map(c => `<td>${c}</td>`).join('') + '</tr>';
    });
    return table + '</tbody></table>';
  });

  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  html = '<p>' + html + '</p>';
  html = html.replace(/<p><\/p>/g, '');
  html = html.replace(/<p>(<h[23]>)/g, '$1');
  html = html.replace(/(<\/h[23]>)<\/p>/g, '$1');
  html = html.replace(/<p>(<table>)/g, '$1');
  html = html.replace(/(<\/table>)<\/p>/g, '$1');
  html = html.replace(/<p>(<ul>)/g, '$1');
  html = html.replace(/(<\/ul>)<\/p>/g, '$1');
  html = html.replace(/<p>(<pre>)/g, '$1');
  html = html.replace(/(<\/pre>)<\/p>/g, '$1');

  return html;
}
