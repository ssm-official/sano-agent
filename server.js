require("dotenv").config();
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const Anthropic = require("@anthropic-ai/sdk").default;
const rateLimit = require("express-rate-limit");
const { TOOLS, TOOL_CATEGORIES } = require("./tools");
const { executeTool } = require("./tool-executor");
const { v4: uuidv4 } = require("uuid");
const fetch = require("node-fetch");
const { Connection, PublicKey, LAMPORTS_PER_SOL, Keypair } = require("@solana/web3.js");
const bs58 = require("bs58").default || require("bs58");

const app = express();
app.set("trust proxy", 1); // Trust Railway's reverse proxy
app.use(express.json());

// ─── Config ───
const SOLANA_RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const connection = new Connection(SOLANA_RPC, "confirmed");
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Rate Limiting (per IP) ───
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  max: 20,                    // 20 messages/min per IP
  message: { error: "Too many requests. Wait a moment." },
  standardHeaders: true,
  legacyHeaders: false
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 10,                    // 10 auth attempts per 15 min
  message: { error: "Too many attempts. Try again later." }
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,                    // 60 API calls/min per IP
  message: { error: "Rate limited." }
});

app.use("/api/chat", chatLimiter);
app.use("/api/auth", authLimiter);
app.use("/api/wallet", apiLimiter);

// ─── Price Cache (avoids hammering external APIs) ───
const priceCache = new Map();
const PRICE_CACHE_TTL = 30 * 1000; // 30 seconds

function getCachedPrice(key) {
  const entry = priceCache.get(key);
  if (entry && Date.now() - entry.time < PRICE_CACHE_TTL) return entry.data;
  return null;
}

function setCachedPrice(key, data) {
  priceCache.set(key, { data, time: Date.now() });
  // Clean old entries periodically
  if (priceCache.size > 500) {
    const now = Date.now();
    for (const [k, v] of priceCache) {
      if (now - v.time > PRICE_CACHE_TTL * 2) priceCache.delete(k);
    }
  }
}

// ─── Auth: Email + OTP (self-contained, no Privy dependency) ───
// In production: replace with Privy server SDK or add Redis for OTP storage
const pendingAuth = new Map();  // email -> { code, expires, attempts }
const users = new Map();        // email -> { wallet, walletSecret, created }
const sessions = new Map();     // sessionId -> { messages[] }

// Generate OTP
function generateOTP() {
  return crypto.randomInt(100000, 999999).toString();
}

// Send OTP via email (uses Privy or fallback)
async function sendOTP(email, code) {
  // If Privy is configured, use their auth
  if (process.env.PRIVY_APP_ID && process.env.PRIVY_APP_SECRET) {
    try {
      const res = await fetch("https://auth.privy.io/api/v1/otp/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "privy-app-id": process.env.PRIVY_APP_ID,
          "Authorization": `Basic ${Buffer.from(`${process.env.PRIVY_APP_ID}:${process.env.PRIVY_APP_SECRET}`).toString("base64")}`
        },
        body: JSON.stringify({ email })
      });
      if (res.ok) return true;
    } catch (e) {
      console.log("Privy OTP fallback:", e.message);
    }
  }

  // Send via Resend
  if (process.env.RESEND_API_KEY) {
    try {
      // Use onboarding@resend.dev if no custom domain verified
      const fromAddr = process.env.FROM_EMAIL || "SANO <onboarding@resend.dev>";
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.RESEND_API_KEY}`
        },
        body: JSON.stringify({
          from: fromAddr,
          to: email,
          subject: "Your SANO verification code",
          html: `<div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:40px 20px;color:#111">
            <h2 style="margin-bottom:20px;font-size:20px">Sign in to SANO</h2>
            <p style="color:#666;margin-bottom:24px;font-size:14px">Enter this code to continue:</p>
            <div style="font-size:32px;font-weight:700;letter-spacing:8px;text-align:center;padding:20px;background:#f5f5f5;border-radius:8px;margin-bottom:24px">${code}</div>
            <p style="color:#999;font-size:13px">This code expires in 10 minutes. If you didn't request this, ignore this email.</p>
          </div>`
        })
      });
      const resData = await res.json();
      if (res.ok) {
        console.log(`  [EMAIL] Sent to ${email} via Resend`);
        return true;
      } else {
        console.log(`  [EMAIL] Resend error:`, resData);
      }
    } catch (e) {
      console.log("  [EMAIL] Resend failed:", e.message);
    }
  }

  // Dev fallback: log to console
  console.log(`\n  [AUTH] Code for ${email}: ${code}\n`);
  return true;
}

// Auth: Start (send OTP)
app.post("/api/auth/start", async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes("@")) {
    return res.json({ error: "Valid email required." });
  }

  const code = generateOTP();
  pendingAuth.set(email.toLowerCase(), {
    code,
    expires: Date.now() + 10 * 60 * 1000, // 10 min
    attempts: 0
  });

  await sendOTP(email.toLowerCase(), code);
  res.json({ ok: true, message: "Code sent." });
});

// Auth: Verify OTP
app.post("/api/auth/verify", async (req, res) => {
  const { email, code } = req.body;
  const key = email?.toLowerCase();

  if (!key || !code) return res.json({ error: "Email and code required." });

  const pending = pendingAuth.get(key);
  if (!pending) return res.json({ error: "No code sent. Start over." });
  if (Date.now() > pending.expires) {
    pendingAuth.delete(key);
    return res.json({ error: "Code expired. Request a new one." });
  }

  pending.attempts++;
  if (pending.attempts > 5) {
    pendingAuth.delete(key);
    return res.json({ error: "Too many attempts. Request a new code." });
  }

  // Check code (or bypass in dev if no email service)
  const validCode = pending.code === code;
  const devBypass = !process.env.RESEND_API_KEY && !process.env.PRIVY_APP_SECRET;

  if (!validCode && !devBypass) {
    return res.json({ error: "Invalid code. Try again." });
  }

  pendingAuth.delete(key);

  // Get or create user
  let user = users.get(key);
  if (!user) {
    // Create embedded Solana wallet
    const keypair = Keypair.generate();
    user = {
      email: key,
      wallet: keypair.publicKey.toBase58(),
      walletSecret: bs58.encode(keypair.secretKey), // encrypted in production
      created: new Date().toISOString()
    };
    users.set(key, user);
    console.log(`  [USER] New user: ${key} -> wallet ${user.wallet}`);
  }

  // Create auth token
  const token = crypto.randomBytes(32).toString("hex");

  res.json({
    ok: true,
    email: key,
    wallet: user.wallet,
    token
  });
});

// ─── Inject config into frontend ───
app.get("/", (req, res) => {
  const fs = require("fs");
  let html = fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf-8");
  const config = `<script>window.__SANO_CONFIG__ = {
    PRIVY_APP_ID: "${process.env.PRIVY_APP_ID || ""}",
    MOONPAY_KEY: "${process.env.MOONPAY_API_KEY || "pk_test_123"}"
  };</script>`;
  html = html.replace("</head>", `${config}\n</head>`);
  res.send(html);
});

app.use(express.static("public", { index: false }));

// ─── Wallet Balance (with caching) ───
app.post("/api/wallet/balance", async (req, res) => {
  try {
    const { address } = req.body;
    if (!address) return res.json({ error: "No address" });

    // Check cache
    const cached = getCachedPrice(`balance:${address}`);
    if (cached) return res.json(cached);

    const pubkey = new PublicKey(address);
    const balance = await connection.getBalance(pubkey);
    const solAmount = balance / LAMPORTS_PER_SOL;

    // USDC
    const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    let usdcBalance = 0;
    try {
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(pubkey, { mint: USDC_MINT });
      if (tokenAccounts.value.length > 0) {
        usdcBalance = parseFloat(tokenAccounts.value[0].account.data.parsed.info.tokenAmount.uiAmountString || "0");
      }
    } catch (e) {}

    // SOL price
    let solPrice = 0;
    const cachedSolPrice = getCachedPrice("sol_price");
    if (cachedSolPrice) {
      solPrice = cachedSolPrice;
    } else {
      try {
        const priceRes = await fetch("https://api.jup.ag/price/v2?ids=So11111111111111111111111111111111111111112");
        const priceData = await priceRes.json();
        solPrice = parseFloat(priceData.data?.["So11111111111111111111111111111111111111112"]?.price || 0);
        setCachedPrice("sol_price", solPrice);
      } catch (e) {}
    }

    const result = { sol: solAmount, usdc: usdcBalance, sol_price: solPrice, address };
    setCachedPrice(`balance:${address}`, result);
    res.json(result);
  } catch (e) {
    res.json({ error: e.message });
  }
});

// ─── Chat with agentic loop ───
const SYSTEM_PROMPT = `You are SANO, a helpful assistant that can shop, book travel, trade, send money, and manage finances.

You speak in plain, simple English. The user may know nothing about crypto. Never use jargon. Say "balance" not "wallet balance", "send money" not "send payment", "dollars" or "$" not "USDC". Show all prices in $.

WHAT YOU CAN DO (everything is real, all transactions execute for real):
- Search products across 600+ stores worldwide (Amazon, Walmart, Target, Tokopedia, Shopee, Lazada, etc.) with product_search
- BUY any product autonomously: use buy_product with the merchant and price. The agent charges the user's USDC and completes the purchase via gift card delivery from that store. Works globally including Indonesia (Tokopedia, Shopee, Lazada), Europe, Asia.
- Buy/sell stocks (AAPL, TSLA, NVDA, MSFT, GOOGL, AMZN, META, COIN, MSTR, SPY, QQQ) — REAL trading via tokenized stocks
- Send money to anyone instantly (real on-chain)
- Swap between any tokens (real Jupiter swaps)
- Check live prices for any asset
- Earn interest on savings
- Search prediction markets (Polymarket)
- Track balances and transactions

SHOPPING — THE CRITICAL FLOW:
1. User says "buy me wireless earbuds under $50"
2. Call product_search with their query
3. The frontend will show product cards automatically — DO NOT repeat the products in text
4. Just briefly summarize what you found ("Found a few options. Which one do you want?") and let the cards do the work
5. When the user picks one (or says "the cheapest" / "first one"), call buy_product with:
   - product_name: the product title
   - merchant: the store name (e.g. "Amazon", "Walmart", "Tokopedia")
   - amount_usd: the price
   - product_url: the link
6. The buy_product tool charges their USDC and returns a gift card code
7. Tell the user briefly: "Done. Here's your code." and let the receipt card show the details

STOCK FLOW:
1. User says "buy $100 of Apple stock"
2. Use stock_trade with symbol="AAPL", side="buy", amount_usd=100
3. The trade executes for real — briefly confirm

CRITICAL UI RULES:
- When you call product_search, the frontend renders product cards. Do NOT list the products in your text reply. Just say something brief like "Here are the top options" and stop.
- When you call stock_trade or buy_product, the frontend shows a receipt card. Don't repeat the details — just confirm briefly.
- Keep your text replies SHORT. The UI does the heavy lifting.

If the user has insufficient USDC, tell them to add funds first.

HOW TO BEHAVE:
- Be concise and direct. Short sentences. No filler
- Format search results clearly with prices, ratings, key details
- Always confirm before spending any money
- Show the exact price/cost before any purchase or transaction
- NEVER mention API keys, configuration, setup, or technical issues to the user. If a tool returns an error about missing keys or "requires_integration", just say "This feature is coming soon" or "I can't do that yet" — keep it simple
- NEVER mention "Solana", "USDC", "SPL tokens", "RPC", "on-chain", "mint address", "transaction signature" unless the user specifically asks about crypto
- Say "your account" not "your wallet"
- Say "send" not "transfer"
- Say "savings" or "interest" not "DeFi" or "staking" or "lending protocol"
- When showing a balance, just show the dollar amount
- When a tool returns a transaction_ready status, tell the user it's being processed

IMPORTANT:
- Use tools for real data. Never make up prices or results
- The user's account address is provided — pass it to balance/payment/swap tools automatically
- If the user asks to buy a product, search for it first, show options, then confirm before purchase
- If the user asks about something you can't do yet, be honest but brief: "I can't do that yet, but I can help you with X instead"
- When a swap or payment completes successfully, always show the explorer link so they can verify
- After a successful transaction, mention the new balance or suggest checking it
- You are a REAL agent that executes transactions. Swaps and payments happen for real on the Solana blockchain. Treat them seriously — always confirm amounts with the user before executing`;

app.post("/api/chat", async (req, res) => {
  const { message, sessionId, walletAddress } = req.body;
  const sid = sessionId || uuidv4();

  if (!sessions.has(sid)) sessions.set(sid, []);
  const history = sessions.get(sid);
  history.push({ role: "user", content: message });

  // Limit history to last 20 messages to control costs
  if (history.length > 40) history.splice(0, history.length - 40);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const now = new Date();
  const days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const todayStr = now.toISOString().split("T")[0]; // YYYY-MM-DD
  const dayName = days[now.getDay()];

  // Calculate next Friday, next Monday, etc. for relative date context
  const nextFriday = new Date(now);
  nextFriday.setDate(now.getDate() + ((5 - now.getDay() + 7) % 7 || 7));
  const nextMonday = new Date(now);
  nextMonday.setDate(now.getDate() + ((1 - now.getDay() + 7) % 7 || 7));

  let systemPrompt = SYSTEM_PROMPT + `\n\nCONTEXT:
- Today is ${dayName}, ${todayStr}
- Next Friday is ${nextFriday.toISOString().split("T")[0]}
- Next Monday is ${nextMonday.toISOString().split("T")[0]}
- When the user says "next Friday", "this weekend", "tomorrow", etc., calculate the correct date yourself. NEVER ask the user to provide a date in YYYY-MM-DD format. Just figure it out.`;

  if (walletAddress) {
    systemPrompt += `\nUser's account address: ${walletAddress}`;
  }

  try {
    let messages = [...history];
    let fullResponse = "";
    let toolResults = [];
    let loopCount = 0;
    const MAX_LOOPS = 5; // Prevent runaway tool loops

    while (loopCount < MAX_LOOPS) {
      loopCount++;

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
        if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
          hasToolUse = true;
          currentToolUse = { id: event.content_block.id, name: event.content_block.name };
          toolInputJson = "";
          res.write(`data: ${JSON.stringify({ type: "tool_start", tool: currentToolUse.name })}\n\n`);
        } else if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            textContent += event.delta.text;
            res.write(`data: ${JSON.stringify({ type: "text", content: event.delta.text })}\n\n`);
          } else if (event.delta.type === "input_json_delta") {
            toolInputJson += event.delta.partial_json;
          }
        } else if (event.type === "content_block_stop" && currentToolUse) {
          const toolInput = toolInputJson ? JSON.parse(toolInputJson) : {};
          // Look up user's keypair for signing transactions
          let userKeypair = null;
          if (walletAddress) {
            for (const [, u] of users) {
              if (u.wallet === walletAddress && u.walletSecret) {
                try {
                  userKeypair = Keypair.fromSecretKey(bs58.decode(u.walletSecret));
                } catch (e) { console.log("  [WARN] Could not load keypair:", e.message); }
                break;
              }
            }
          }
          const toolResult = await executeTool(currentToolUse.name, toolInput, walletAddress, userKeypair);

          res.write(`data: ${JSON.stringify({
            type: "tool_result", tool: currentToolUse.name, input: toolInput, result: toolResult
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
    console.error("Chat error:", err.message);
    res.write(`data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`);
    res.end();
  }
});

// ─── Tool list for UI ───
app.get("/api/tools", (req, res) => {
  res.json({ tools: TOOLS.map(t => ({ name: t.name, description: t.description })), categories: TOOL_CATEGORIES });
});

// ─── Health check ───
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// ─── Cleanup stale sessions every 30 min ───
setInterval(() => {
  const maxAge = 2 * 60 * 60 * 1000; // 2 hours
  const now = Date.now();
  // Sessions don't have timestamps so just cap size
  if (sessions.size > 1000) {
    const keys = [...sessions.keys()];
    keys.slice(0, keys.length - 500).forEach(k => sessions.delete(k));
  }
  // Clean expired auth
  for (const [k, v] of pendingAuth) {
    if (now > v.expires) pendingAuth.delete(k);
  }
}, 30 * 60 * 1000);

// ─── Start ───
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  SANO Agent`);
  console.log(`  ─────────`);
  console.log(`  URL:      http://localhost:${PORT}`);
  console.log(`  RPC:      ${SOLANA_RPC.includes("helius") ? "Helius" : SOLANA_RPC.includes("quicknode") ? "QuickNode" : "Public"}`);
  console.log(`  Email:    ${process.env.RESEND_API_KEY ? "Resend" : process.env.PRIVY_APP_SECRET ? "Privy" : "Console (dev)"}`);
  console.log(`  Duffel:   ${process.env.DUFFEL_API_TOKEN ? "Yes" : "No"}`);
  console.log(`  MoonPay:  ${process.env.MOONPAY_API_KEY ? "Yes" : "No"}`);
  console.log(`  Search:   ${process.env.SEARCH_API_KEY ? "Yes" : "No"}\n`);
});
