require("dotenv").config();
const express = require("express");
const Anthropic = require("@anthropic-ai/sdk").default;
const { TOOLS, TOOL_CATEGORIES } = require("./tools");
const { executeTool } = require("./tool-executor");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(express.json());
app.use(express.static("public"));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// In-memory session store (use Redis/DB in production)
const sessions = new Map();

const SYSTEM_PROMPT = `You are SANO — an AI agent that shops, trades, and executes on Solana, all from this chat interface.

You have access to 30+ tools that let you:
• Shop 1B+ products on Amazon & Shopify — paid with USDC
• Swap any token instantly via Jupiter (best price routing across all Solana DEXs)
• Buy & sell 170+ stocks, commodities, and ETFs
• Trade prediction markets (Polymarket, Drift)
• Book flights and hotels — paid with USDC
• Send payments to anyone on-chain (addresses, .sol domains)
• Create virtual Visa cards funded with USDC
• USDC credit lines backed by on-chain assets
• DeFi: staking, lending, borrowing, yield farming
• Portfolio tracking, price alerts, subscriptions, and DCA

PERSONALITY:
- You are fast, confident, and concise
- You speak like a knowledgeable friend who's also a power user
- Use short paragraphs. No walls of text
- When showing results (products, flights, etc), format them clearly
- Always confirm before executing purchases, swaps, or trades over $100
- Show the USDC cost before any transaction
- When comparing options, use clear formatting

RULES:
- Always use the appropriate tool — don't make up data
- For purchases: search first, show options, then buy on confirmation
- For swaps: show the quote first, then execute on confirmation
- Show transaction signatures after on-chain actions
- If the user's request is ambiguous, ask a clarifying question
- Keep your wallet security top of mind — never expose private keys

FORMAT:
- Use markdown for formatting
- Use tables for comparisons when helpful
- Show prices in USD/USDC
- Include relevant emojis sparingly for visual clarity (🛒 🔄 ✈️ 💳 📊)`;

// Chat endpoint with streaming
app.post("/api/chat", async (req, res) => {
  const { message, sessionId } = req.body;
  const sid = sessionId || uuidv4();

  if (!sessions.has(sid)) {
    sessions.set(sid, []);
  }

  const history = sessions.get(sid);
  history.push({ role: "user", content: message });

  // Set up SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Session-Id", sid);

  try {
    let messages = [...history];
    let fullResponse = "";
    let toolResults = [];

    // Agentic loop — keep going until no more tool calls
    while (true) {
      const stream = anthropic.messages.stream({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
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
            // Send tool_start event to frontend
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
          // Execute the tool
          const toolInput = toolInputJson ? JSON.parse(toolInputJson) : {};
          const toolResult = executeTool(currentToolUse.name, toolInput);

          // Send tool result to frontend
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

      // If there were tool calls, add assistant message and tool results, then loop
      if (hasToolUse) {
        const assistantContent = [];
        if (textContent) assistantContent.push({ type: "text", text: textContent });

        // Reconstruct tool_use blocks from what we processed
        const finalMessage = await stream.finalMessage();
        messages.push({ role: "assistant", content: finalMessage.content });
        messages.push({ role: "user", content: toolResults });

        fullResponse += textContent;
        toolResults = [];
        textContent = "";

        // If stop_reason is end_turn, break
        if (finalMessage.stop_reason === "end_turn") break;
      } else {
        fullResponse += textContent;
        break;
      }
    }

    // Save assistant response to history
    history.push({ role: "assistant", content: fullResponse });

    res.write(`data: ${JSON.stringify({ type: "done", sessionId: sid })}\n\n`);
    res.end();
  } catch (err) {
    console.error("Chat error:", err);
    res.write(`data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`);
    res.end();
  }
});

// Get tool categories for UI
app.get("/api/tools", (req, res) => {
  res.json({ tools: TOOLS.map(t => ({ name: t.name, description: t.description })), categories: TOOL_CATEGORIES });
});

// Wallet mock endpoint
app.get("/api/wallet", (req, res) => {
  res.json({
    address: "SANO...demo",
    balance_usdc: 4250.00,
    balance_sol: 42.5,
    connected: true
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  ██████  █████  ███    ██  ██████  `);
  console.log(`  ██      ██   ██ ████   ██ ██    ██ `);
  console.log(`  ███████ ███████ ██ ██  ██ ██    ██ `);
  console.log(`       ██ ██   ██ ██  ██ ██ ██    ██ `);
  console.log(`  ██████  ██   ██ ██   ████  ██████  `);
  console.log(`\n  🟢 SANO Agent running → http://localhost:${PORT}\n`);
});
