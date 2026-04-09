// ─── SANO Agent Frontend ───

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let sessionId = localStorage.getItem("sano_session") || null;
let isStreaming = false;

// ─── ONBOARDING ───
const onboarding = $("#onboarding");
const app = $("#app");

function enterApp() {
  onboarding.classList.add("hidden");
  app.classList.remove("hidden");
  localStorage.setItem("sano_onboarded", "true");
  loadToolCategories();
  $("#chat-input").focus();
}

// Skip onboarding if already done
if (localStorage.getItem("sano_onboarded")) {
  enterApp();
}

$("#btn-connect-wallet").addEventListener("click", () => {
  // In production: connect to Phantom/Solflare
  enterApp();
});

$("#btn-email-signup").addEventListener("click", () => {
  enterApp();
});

// ─── SIDEBAR ───
$("#sidebar-toggle").addEventListener("click", () => {
  $(".sidebar").classList.toggle("open");
});

$("#new-chat-btn").addEventListener("click", () => {
  sessionId = null;
  localStorage.removeItem("sano_session");
  const msgs = $("#chat-messages");
  msgs.innerHTML = "";
  addWelcome();
});

// Quick actions
$$(".quick-action").forEach(btn => {
  btn.addEventListener("click", () => {
    sendMessage(btn.dataset.prompt);
  });
});

// ─── TOOLS PANEL ───
$("#tools-btn").addEventListener("click", () => {
  const panel = $("#tools-panel");
  panel.classList.toggle("hidden");
});

$("#close-tools").addEventListener("click", () => {
  $("#tools-panel").classList.add("hidden");
});

async function loadToolCategories() {
  try {
    const res = await fetch("/api/tools");
    const data = await res.json();

    // Sidebar categories
    const catContainer = $("#tool-categories");
    catContainer.innerHTML = "";
    for (const [cat, toolNames] of Object.entries(data.categories)) {
      const div = document.createElement("div");
      div.className = "tool-cat";
      div.innerHTML = `${cat}<span class="tool-cat-count">${toolNames.length}</span>`;
      catContainer.appendChild(div);
    }

    // Tools panel
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
  // Auto-resize
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

// Suggestions
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
      <p>Your AI agent for shopping, trading, and executing on Solana. What can I do for you?</p>
      <div class="suggestion-grid">
        <button class="suggestion" data-prompt="Find me the cheapest wireless earbuds on Amazon">
          <span class="suggestion-icon">🛒</span>
          <span class="suggestion-text">Find me the cheapest wireless earbuds on Amazon</span>
        </button>
        <button class="suggestion" data-prompt="Swap 50 USDC to SOL">
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
  // Remove welcome on first message
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

function addToolCard(toolName, status) {
  const toolIcons = {
    amazon: "🛒", shopify: "🛍️", jupiter: "🔄", token: "💰",
    stock: "📈", prediction: "🎯", send: "💸", flight: "✈️",
    hotel: "🏨", wallet: "👛", portfolio: "📊", defi: "🌱",
    credit: "💳", virtual: "💳", subscription: "🔁", price: "📡",
    limit: "⏳", transaction: "📜"
  };

  const iconKey = Object.keys(toolIcons).find(k => toolName.includes(k)) || "⚡";
  const icon = toolIcons[iconKey] || "⚡";

  // Find the last assistant message body
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
      <div class="tool-card-status running">Running...</div>
    </div>
  `;

  // Insert before the text content
  const content = lastBody.querySelector(".message-content");
  lastBody.insertBefore(card, content);
  scrollToBottom();
  return card;
}

function updateToolCard(card, result, input) {
  if (!card) return;
  const status = card.querySelector(".tool-card-status");
  status.className = "tool-card-status done";
  status.textContent = "✓ Done";

  // Add detail preview
  const detail = document.createElement("div");
  detail.className = "tool-card-detail";
  detail.textContent = JSON.stringify(result, null, 2).slice(0, 500);
  card.appendChild(detail);
  scrollToBottom();
}

async function sendMessage(text) {
  isStreaming = true;
  sendBtn.disabled = true;
  chatInput.value = "";
  chatInput.style.height = "auto";

  // Add user message
  addMessage("user", text);

  // Add assistant message placeholder
  const contentEl = addMessage("assistant", "");

  // Add typing indicator
  contentEl.innerHTML = `<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>`;

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, sessionId })
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let hasStartedText = false;
    let currentToolCard = null;

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
            contentEl.innerHTML = renderMarkdown(contentEl.textContentRaw = (contentEl.textContentRaw || "") + event.content);
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
              updateToolCard(currentToolCard, event.result, event.input);
              currentToolCard = null;
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

    // If no text was received
    if (!hasStartedText) {
      contentEl.innerHTML = `<span style="color: var(--text-tertiary)">No response received.</span>`;
    }
  } catch (err) {
    contentEl.innerHTML = `<span style="color: var(--red)">Connection error. Make sure the server is running.</span>`;
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

// Simple markdown renderer
function renderMarkdown(text) {
  if (!text) return "";
  let html = escapeHtml(text);

  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  // Lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
  // Fix nested ul
  html = html.replace(/<\/ul>\s*<ul>/g, '');
  // Tables
  html = html.replace(/\|(.+)\|\n\|[-| ]+\|\n((?:\|.+\|\n?)+)/g, (match, header, body) => {
    const headers = header.split('|').map(h => h.trim()).filter(Boolean);
    const rows = body.trim().split('\n').map(row =>
      row.split('|').map(c => c.trim()).filter(Boolean)
    );
    let table = '<table><thead><tr>' + headers.map(h => `<th>${h}</th>`).join('') + '</tr></thead><tbody>';
    rows.forEach(row => {
      table += '<tr>' + row.map(c => `<td>${c}</td>`).join('') + '</tr>';
    });
    table += '</tbody></table>';
    return table;
  });
  // Paragraphs
  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  html = '<p>' + html + '</p>';
  // Clean up empty tags
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
