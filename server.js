require("dotenv").config();
const express = require("express");
const path = require("path");
const Anthropic = require("@anthropic-ai/sdk").default;
const { TOOLS, TOOL_CATEGORIES } = require("./tools");
const { executeTool } = require("./tool-executor");
const { v4: uuidv4 } = require("uuid");
const fetch = require("node-fetch");
const { Connection, PublicKey, LAMPORTS_PER_SOL } = require("@solana/web3.js");

const app = express();
app.use(express.json());

const SOLANA_RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const connection = new Connection(SOLANA_RPC, "confirmed");

// Inject Privy app ID into frontend
app.get("/", (req, res) => {
  const fs = require("fs");
  let html = fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf-8");
  // Inject config before app.js loads
  const config = `<script>window.__SANO_CONFIG__ = { PRIVY_APP_ID: "${process.env.PRIVY_APP_ID || ""}" };</script>`;
  html = html.replace("</head>", `${config}\n</head>`);
  res.send(html);
});

// Serve static files (but not index.html, we handle that above)
app.use(express.static("public", { index: false }));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Session store
const sessions = new Map();

const SYSTEM_PROMPT = `You are SANO — an AI agent that shops, trades, and executes on Solana, all from this chat interface.

You have 30+ real tools connected to live APIs:

LIVE INTEGRATIONS:
• Jupiter DEX — real token swaps, quotes, and limit orders on Solana (best price routing)
• Solana RPC — real wallet balances, token holdings, transaction history
• On-chain payments — real SOL/SPL token transfers to any address or .sol domain
• Token prices — real-time via Jupiter Price API and CoinGecko
• Polymarket — real prediction market search
• DeFi protocols — Marinade, Jito, Kamino, Marginfi, Orca, Raydium (real yield data)

AVAILABLE WITH API KEYS:
• Amazon search (1B+ products) — needs SEARCH_API_KEY (ScaleSERP)
• Flights & hotels — needs AMADEUS_API_KEY (free tier at amadeus.com)
• Shopify search — works with any store URL
• Virtual Visa cards — needs card provider (Immersve/Helio)
• Stock trading — needs tokenized asset platform integration

PERSONALITY:
- You are fast, confident, and concise
- You speak like a knowledgeable friend who's also a power user
- Short paragraphs, no walls of text
- When showing results, format them clearly with markdown
- Always confirm before executing transactions over $50
- Show exact amounts and prices before any swap or purchase
- When a tool returns "api_key_required", explain what's needed clearly and suggest alternatives

RULES:
- Always use tools for real data — never make up prices, balances, or results
- For swaps: ALWAYS get a quote first, show the user, then execute on confirmation
- For payments: show amount and recipient clearly, then execute
- Show transaction signatures/explorer links after on-chain actions
- The user's wallet address is provided in the context — use it for on-chain tools
- If something requires an API key that isn't configured, be honest and tell them what's needed`;

// Real wallet balance endpoint
app.post("/api/wallet/balance", async (req, res) => {
  try {
    const { address } = req.body;
    if (!address) return res.json({ error: "No address" });

    const pubkey = new PublicKey(address);
    const balance = await connection.getBalance(pubkey);
    const solAmount = balance / LAMPORTS_PER_SOL;

    // Get USDC balance
    const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    let usdcBalance = 0;

    try {
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(pubkey, { mint: USDC_MINT });
      if (tokenAccounts.value.length > 0) {
        usdcBalance = parseFloat(tokenAccounts.value[0].account.data.parsed.info.tokenAmount.uiAmountString || "0");
      }
    } catch (e) {}

    res.json({ sol: solAmount, usdc: usdcBalance, address });
  } catch (e) {
    res.json({ error: e.message });
  }
});

// Chat endpoint with streaming + agentic loop
app.post("/api/chat", async (req, res) => {
  const { message, sessionId, walletAddress } = req.body;
  const sid = sessionId || uuidv4();

  if (!sessions.has(sid)) {
    sessions.set(sid, []);
  }

  const history = sessions.get(sid);
  history.push({ role: "user", content: message });

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Session-Id", sid);

  // Build system prompt with wallet context
  let systemPrompt = SYSTEM_PROMPT;
  if (walletAddress) {
    systemPrompt += `\n\nUSER WALLET: ${walletAddress}\nAlways use this address for on-chain operations. Pass it to wallet_balance, send_payment, etc.`;
  }

  try {
    let messages = [...history];
    let fullResponse = "";
    let toolResults = [];

    // Agentic loop
    while (true) {
      const stream = anthropic.messages.stream({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: systemPrompt,
        tools: TOOLS,
        messages
      });

      let currentToolUse = null;
      let toolInputJson = "";
      let hasToolUse = false;
      let textContent = "";

      for await (const event of stream) {
        if (event.type === "content_block_start") {
          if (event.content_block.type === "tool_use") {
            hasToolUse = true;
            currentToolUse = { id: event.content_block.id, name: event.content_block.name };
            toolInputJson = "";
            res.write(`data: ${JSON.stringify({ type: "tool_start", tool: currentToolUse.name })}\n\n`);
          }
        } else if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            textContent += event.delta.text;
            res.write(`data: ${JSON.stringify({ type: "text", content: event.delta.text })}\n\n`);
          } else if (event.delta.type === "input_json_delta") {
            toolInputJson += event.delta.partial_json;
          }
        } else if (event.type === "content_block_stop" && currentToolUse) {
          const toolInput = toolInputJson ? JSON.parse(toolInputJson) : {};

          // Execute tool with real APIs
          const toolResult = await executeTool(currentToolUse.name, toolInput, walletAddress);

          res.write(`data: ${JSON.stringify({
            type: "tool_result",
            tool: currentToolUse.name,
            input: toolInput,
            result: toolResult
          })}\n\n`);

          toolResults.push({
            type: "tool_result",
            tool_use_id: currentToolUse.id,
            content: JSON.stringify(toolResult)
          });

          currentToolUse = null;
          toolInputJson = "";
        }
      }

      if (hasToolUse) {
        const finalMessage = await stream.finalMessage();
        messages.push({ role: "assistant", content: finalMessage.content });
        messages.push({ role: "user", content: toolResults });

        fullResponse += textContent;
        toolResults = [];
        textContent = "";

        if (finalMessage.stop_reason === "end_turn") break;
      } else {
        fullResponse += textContent;
        break;
      }
    }

    history.push({ role: "assistant", content: fullResponse });

    res.write(`data: ${JSON.stringify({ type: "done", sessionId: sid })}\n\n`);
    res.end();
  } catch (err) {
    console.error("Chat error:", err);
    res.write(`data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`);
    res.end();
  }
});

// Tool categories for UI
app.get("/api/tools", (req, res) => {
  res.json({ tools: TOOLS.map(t => ({ name: t.name, description: t.description })), categories: TOOL_CATEGORIES });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  ██████  █████  ███    ██  ██████  `);
  console.log(`  ██      ██   ██ ████   ██ ██    ██ `);
  console.log(`  ███████ ███████ ██ ██  ██ ██    ██ `);
  console.log(`       ██ ██   ██ ██  ██ ██ ██    ██ `);
  console.log(`  ██████  ██   ██ ██   ████  ██████  `);
  console.log(`\n  🟢 SANO Agent running → http://localhost:${PORT}`);
  console.log(`  📡 Solana RPC: ${SOLANA_RPC}`);
  console.log(`  🔑 Privy: ${process.env.PRIVY_APP_ID ? "Configured" : "Not set"}`);
  console.log(`  🛒 Amazon Search: ${process.env.SEARCH_API_KEY ? "Configured" : "Not set"}`);
  console.log(`  ✈️  Amadeus Flights: ${process.env.AMADEUS_API_KEY ? "Configured" : "Not set"}\n`);
});
