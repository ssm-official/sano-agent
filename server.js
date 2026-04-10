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
const store = require("./agent-store");
const sandbox = require("./sandbox-manager");
const vault = require("./wallet-vault");
const credentialsVault = require("./credentials-vault");

// Friendly action labels for the live computer preview
function describeAction(action, input) {
  switch (action) {
    case "screenshot": return "Looking at screen";
    case "left_click": return `Clicking`;
    case "right_click": return "Right-clicking";
    case "double_click": return "Double-clicking";
    case "mouse_move": return "Moving cursor";
    case "type": return `Typing "${(input.text || "").slice(0, 40)}${(input.text || "").length > 40 ? "..." : ""}"`;
    case "key": return `Pressing ${input.text}`;
    case "scroll": return `Scrolling ${input.scroll_direction || "down"}`;
    case "wait": return "Waiting";
    default: return action;
  }
}

// Per-user mutex queue (prevents concurrent chat handling for same user)
const userLocks = new Map(); // email -> Promise chain
function withUserLock(email, fn) {
  const prev = userLocks.get(email) || Promise.resolve();
  const next = prev.then(fn).catch(e => { console.error("[LOCK]", e); throw e; });
  userLocks.set(email, next.catch(() => {}));
  return next;
}

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

// ─── Auth: Email + OTP ───
const pendingAuth = new Map();  // email -> { code, expires, attempts } (in-memory, OTPs are short-lived)
const users = store.loadUsers(); // email -> { wallet, walletSecret, created, usage } (file-backed)
const sessions = new Map();     // sessionId -> { messages[] } (in-memory, regenerated)
console.log(`  [STORE] Loaded ${users.size} existing users`);

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

// Per-email OTP rate limit (prevents abuse)
const otpRequests = new Map(); // email -> [timestamps]
function checkOtpRateLimit(email) {
  const now = Date.now();
  const window = 60 * 60 * 1000; // 1 hour
  const maxRequests = 5;
  const reqs = (otpRequests.get(email) || []).filter(t => now - t < window);
  if (reqs.length >= maxRequests) return false;
  reqs.push(now);
  otpRequests.set(email, reqs);
  return true;
}

// Auth: Start (send OTP)
app.post("/api/auth/start", async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes("@") || email.length > 200) {
    return res.json({ error: "Valid email required." });
  }
  const key = email.toLowerCase().trim();

  if (!checkOtpRateLimit(key)) {
    return res.json({ error: "Too many code requests. Wait an hour and try again." });
  }

  const code = generateOTP();
  pendingAuth.set(key, {
    code,
    expires: Date.now() + 10 * 60 * 1000, // 10 min
    attempts: 0
  });

  await sendOTP(key, code);
  res.json({ ok: true, message: "Code sent." });
});

// Auth: Verify OTP — extend response timeout because sandbox creation can take 20-40s
app.post("/api/auth/verify", async (req, res) => {
  // Disable Node's default response timeout for this endpoint
  req.setTimeout(120000);
  res.setTimeout(120000);

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
  let firstSignin = false;

  if (!user) {
    // Brand new user
    user = {
      email: key,
      created: new Date().toISOString(),
      agent_name: "SANO"
    };
    firstSignin = true;
  }

  // Make sure they have a wallet in the vault
  if (!vault.hasWallet(key)) {
    const { publicKey, evmAddress } = vault.createWallet(key);
    user.wallet = publicKey;
    user.evm_wallet = evmAddress;
    firstSignin = true;
    console.log(`  [VAULT] Created wallets for ${key} -> SOL: ${publicKey}, EVM: ${evmAddress}`);
  } else {
    if (!user.wallet) user.wallet = vault.getPublicKey(key);
    // Migrate: ensure existing users have an EVM wallet too
    const evmAddr = vault.getEvmAddress(key);
    if (evmAddr && !user.evm_wallet) {
      user.evm_wallet = evmAddr;
      console.log(`  [VAULT] Added EVM wallet for ${key}: ${evmAddr}`);
    }
  }

  // Initialize memory if missing
  if (!store.loadMemory(key)) {
    store.saveMemory(key, `# Memory for ${key}\n\n## Profile\n- email: ${key}\n- account created: ${user.created}\n\n## Notes\n`);
  }

  // Sandbox creation is OPTIONAL and lazy.
  // We do NOT create a sandbox during signin anymore — that was slow and risky.
  // The chat handler will create one on first computer-use request, lazily.
  // If they have an old sandbox_id from legacy code, we'll keep it for now and
  // the chat handler will check liveness.

  users.set(key, user);
  store.saveUsers(users);
  console.log(`  [USER] ${firstSignin ? "Created" : "Logged in"}: ${key} -> ${user.wallet}`);

  // Create auth token
  const token = crypto.randomBytes(32).toString("hex");

  res.json({
    ok: true,
    email: key,
    wallet: user.wallet,
    token,
    first_signin: firstSignin
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

// ─── Chats: list, load, delete ───
app.get("/api/chats", (req, res) => {
  const email = req.query.email?.toLowerCase();
  if (!email) return res.json({ error: "Email required" });
  res.json({ chats: store.listChats(email) });
});

app.get("/api/chats/:id", (req, res) => {
  const email = req.query.email?.toLowerCase();
  if (!email) return res.json({ error: "Email required" });
  const chat = store.loadChat(email, req.params.id);
  if (!chat) return res.json({ error: "Not found" });
  res.json(chat);
});

app.delete("/api/chats/:id", (req, res) => {
  const email = req.query.email?.toLowerCase();
  if (!email) return res.json({ error: "Email required" });
  store.deleteChat(email, req.params.id);
  res.json({ ok: true });
});

// ─── Settings ───
app.get("/api/settings", (req, res) => {
  const email = req.query.email?.toLowerCase();
  if (!email) return res.json({ error: "Email required" });
  res.json(store.loadSettings(email));
});

app.post("/api/settings", (req, res) => {
  const { email, settings } = req.body;
  if (!email) return res.json({ error: "Email required" });
  store.saveSettings(email.toLowerCase(), settings || {});
  res.json({ ok: true });
});

// ─── Orders (from Bitrefill) ───
app.get("/api/orders", async (req, res) => {
  try {
    if (!process.env.BITREFILL_API_KEY) return res.json({ orders: [] });
    const bitrefill = require("./bitrefill-client");
    const result = await bitrefill.listOrders({ limit: 25, includeRedemption: true });
    const orders = (result.response || result).orders || result.orders || [];
    res.json({ orders });
  } catch (e) {
    res.json({ error: e.message, orders: [] });
  }
});

// ─── Withdraw (simple wrapper over send_payment) ───
app.post("/api/withdraw", async (req, res) => {
  try {
    const { email, token, amount, address } = req.body;
    const key = email?.toLowerCase();
    if (!key || !token || !amount || !address) {
      return res.json({ error: "Email, token, amount, and address required" });
    }
    const keypair = vault.getKeypair(key);
    if (!keypair) return res.json({ error: "Wallet not found" });

    const result = await executeTool("send_payment",
      { recipient: address, amount: parseFloat(amount), token },
      keypair.publicKey.toBase58(),
      keypair,
      { userEmail: key, store }
    );
    res.json(result);
  } catch (e) {
    res.json({ error: e.message });
  }
});

// ─── Account: Export all data (GDPR-style download) ───
app.post("/api/account/export", async (req, res) => {
  try {
    const { email } = req.body;
    const key = email?.toLowerCase();
    if (!key) return res.json({ error: "Email required" });
    const user = users.get(key);
    if (!user) return res.json({ error: "User not found" });

    const wallet = vault.exportSecret(key);
    const memory = store.loadMemory(key);
    const creds = credentialsVault.list(key);

    res.json({
      email: key,
      wallet,
      memory,
      saved_logins: creds, // no passwords in export by default
      account: {
        created: user.created,
        agent_name: user.agent_name
      },
      exported_at: new Date().toISOString()
    });
  } catch (e) {
    res.json({ error: e.message });
  }
});

// ─── Account: Delete everything ───
app.post("/api/account/delete", async (req, res) => {
  try {
    const { email, confirm } = req.body;
    if (confirm !== "DELETE") return res.json({ error: "Confirmation phrase required" });
    const key = email?.toLowerCase();
    if (!key) return res.json({ error: "Email required" });

    // Delete vault, memory, credentials, user record
    const fs = require("fs");
    const dataDir = process.env.DATA_DIR || path.join(__dirname, "data");
    const safe = key.replace(/[^a-z0-9@.]/g, "_");

    [
      path.join(dataDir, "wallets", safe + ".vault"),
      path.join(dataDir, "memory", safe + ".md"),
      path.join(dataDir, "credentials", safe + ".creds")
    ].forEach(f => {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (e) {}
    });

    users.delete(key);
    store.saveUsers(users);
    console.log(`  [ACCOUNT] Deleted everything for ${key}`);
    res.json({ status: "deleted", email: key });
  } catch (e) {
    res.json({ error: e.message });
  }
});

// ─── Export Private Key (for self-custody backup) ───
app.post("/api/wallet/export", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.json({ error: "Email required" });
    const exported = vault.exportSecret(email.toLowerCase());
    if (!exported) return res.json({ error: "Wallet not found" });
    res.json({
      wallet: exported.public_key,
      private_key: exported.secret_key,
      warning: "Anyone with this key controls your account. Save it somewhere safe and never share it."
    });
  } catch (e) {
    res.json({ error: e.message });
  }
});

// ─── Wallet Balance — full multi-chain holdings via wallet_balance tool ───
app.post("/api/wallet/balance", async (req, res) => {
  try {
    const { address } = req.body;
    if (!address) return res.json({ error: "No address" });

    // Use the proper tool which knows about Token-2022, xStocks, prices, etc.
    const result = await executeTool("wallet_balance", { address }, address, null, {});

    // Backward compat: flat sol/usdc fields for the sidebar balance display
    const usdcHolding = (result.cash_holdings || []).find(c => c.token === "USDC");
    res.json({
      ...result,
      sol: result.sol_balance || 0,
      usdc: usdcHolding?.balance || 0,
      sol_price: result.sol_balance > 0 ? (result.sol_value_usd / result.sol_balance) : 0,
      address
    });
  } catch (e) {
    res.json({ error: e.message });
  }
});

// ─── Prediction positions (Jupiter Predict) ───
app.get("/api/predictions/positions", async (req, res) => {
  try {
    const owner = req.query.owner;
    if (!owner) return res.json({ positions: [] });
    const r = await fetch(`https://api.jup.ag/prediction/v1/positions?ownerPubkey=${owner}`);
    const data = await r.json();
    res.json({ positions: data.data || data || [] });
  } catch (e) {
    res.json({ positions: [], error: e.message });
  }
});

// ─── Chat with agentic loop ───
const SYSTEM_PROMPT = `You are SANO, a helpful AI agent built for autonomous commerce.

WHAT IS SANO:
SANO is an AI agent with a real account that can shop, trade, send money, and do things for users — autonomously. Each user who signs up gets their own embedded multi-chain wallet (Solana + Ethereum/Base/Polygon/Arbitrum) that only they control via a backup key. SANO uses that wallet to pay for things the user asks for, all from chat.

Under the hood:
- Wallets: embedded Solana + EVM wallets per user, keys encrypted at rest
- Shopping: Bitrefill (1500+ merchants in 180+ countries) — Amazon, Netflix, Steam, Roblox, GCash, GoPay, mobile top-ups, etc.
- Stocks: tokenized stocks (xStocks) traded via Jupiter on Solana — AAPL, TSLA, NVDA, etc.
- Trading: Jupiter DEX aggregator for any Solana token swap
- Payments: native SOL/SPL transfers, cross-chain coming soon
- Computer use: each user has a private Linux desktop with Firefox that SANO can control to browse any website
- Memory: persistent per-user memory for preferences, addresses, recurring needs
- Credentials vault: encrypted per-user storage for saved site logins

WHAT WORKS TODAY (stable):
- Shopping via gift cards / top-ups / subscriptions for any merchant on Bitrefill
- Buying stocks (tokenized via Jupiter)
- Crypto swaps on Solana
- Sending money (SOL/SPL transfers)
- Product search across stores
- Prediction markets via Jupiter Predict (Polymarket + Kalshi liquidity, real betting on Solana — no bridging)
- Price checks, balance checks, transaction history
- Credential storage
- Persistent memory

IN BETA / COMING SOON (don't attempt these yet, but tell the user they're coming):
- Flights booking
- Hotels booking
- Event tickets / concerts
- Restaurant reservations
- Car rentals
- Airbnb / stays
- Real-time stock options / derivatives

If the user asks "what is SANO" or "what can you do", give them a short clear overview. If they ask about a beta feature, be honest: "That's coming soon. Right now I can help with X instead." Do NOT pretend beta features work.


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

PURCHASING — UNIVERSAL FLOW:
You can buy/fund/top up basically anything via buy_product. Don't say "I can't" — just try it. Bitrefill carries:
- Retail products: Amazon, Walmart, Target, Nike, etc. (search with product_search first, then buy_product)
- Subscriptions: Netflix, Spotify, Hulu, YouTube Premium, Apple Music, Disney+, Apple, Google Play
- Gaming: Steam, PlayStation, Xbox, Nintendo, Roblox/Robux, Fortnite/V-Bucks, Riot, Genshin, Minecraft
- E-wallets / mobile money: GCash, GoPay, OVO, Dana, AliPay, Paytm, MercadoPago, M-Pesa, Wise, etc.
- Mobile top-ups: any carrier worldwide
- Bill payments and prepaid cards
- Food delivery: DoorDash, Uber Eats, Grubhub, etc.
- Travel: Airbnb, Hotels.com, Booking.com, etc.

When the user asks "buy me X" / "top up my Y" / "subscribe to Z" / "get me some W":
1. JUST CALL buy_product with the merchant name and amount. Don't refuse, don't say it's not possible, don't ask permission.
2. Pass the country code if they mention a region (PH for Philippines GCash, ID for Indonesian GoPay, BR for Brazilian services, etc.)
3. If buy_product returns "Couldn't find X", THEN tell the user it's not available and suggest alternatives.
4. When successful, the receipt card shows the redemption code or top-up confirmation. Don't repeat the details in text.

SHOPPING (physical products):
1. User: "buy me wireless earbuds under $50"
2. Call product_search to find options
3. Frontend shows product cards — DON'T list them in text
4. User picks one ("the first one" / "the cheapest")
5. Call buy_product with that merchant and price
6. Done — receipt card shows the code

STOCK FLOW:
1. User says "buy $100 of Apple stock"
2. Use stock_trade with symbol="AAPL", side="buy", amount_usd=100
3. The trade executes for real — briefly confirm

CRITICAL UI RULES:
- When you call product_search, the frontend renders product cards. Do NOT list the products in your text reply. Just say something brief like "Here are the top options" and stop.
- When you call stock_trade or buy_product, the frontend shows a receipt card. Don't repeat the details — just confirm briefly.
- Keep your text replies SHORT. The UI does the heavy lifting.

MEMORY — IMPORTANT:
- You have persistent memory about each user across all conversations
- Whenever you learn something useful (their name, address, sizes, preferences, recurring needs), call the remember tool to save it
- If they tell you their address, remember it. If they mention a brand they love, remember it. If they say "I always want X under $Y", remember it.
- Use what you remember to skip questions ("I see your address is on file, want me to ship there?") and personalize ("Based on what you've told me before...")
- If something becomes outdated, call forget

If the user has insufficient USDC, tell them to add funds first.

HOW TO BEHAVE:
- Be EXTREMELY concise. 1-2 sentences usually. No preamble. No "I'll do X for you" — just do it
- The UI shows what tools you call, so don't restate them
- Format search results clearly with prices, ratings, key details (UI handles cards, you don't list them in text)
- Always confirm before spending any money
- Show the exact price/cost before any purchase or transaction
- NEVER make up explanations for missing data. If a tool returns null or empty, just say "no results" — don't invent reasons like "this market is closed because it filled up." If you don't know why, don't guess.
- If the user asks to bet/buy and you got valid results from the search, JUST PICK ONE and execute. Don't list 10 options and ask them to choose unless they specifically said to.
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
- You are a REAL agent that executes transactions. Swaps and payments happen for real on the Solana blockchain. Treat them seriously — always confirm amounts with the user before executing
- IMPORTANT: If a tool returns "needs_sol: true", the user has no SOL for network fees. Tell them clearly: "Your account needs a small amount of SOL (~$0.50) to pay network fees. Send any amount of SOL to your address: [their address]. After that, all operations work." Do NOT retry the action — they need to fund SOL first.

SAVED LOGINS — YOU REMEMBER PASSWORDS:
You have an encrypted credentials vault per user. When the user shares site login info ("my Amazon login is X / Y"), call save_credential to store it. When you need to log into a site for them, call get_credential first to retrieve the saved login. If you don't have credentials for a site they ask you to use, ask them to share the login (and remind them you'll save it encrypted so they don't need to share it again).

NEVER reveal passwords in chat unless the user explicitly asks "what's my password for X". Don't quote passwords in your text replies.

COMPUTER USE — YOU HAVE A REAL COMPUTER:
You have a real Linux desktop with browser via the "computer" tool. Screenshot, click, type, scroll. Use it for any task that needs the web.

CRITICAL: BE SILENT WHILE WORKING.
- Do NOT narrate what you're doing ("I'll take a screenshot now", "I see the search box", "Now I'll click")
- Do NOT explain each action — the UI shows the user what's happening live
- Do NOT describe screenshots
- Just perform the actions silently
- Only speak when you have:
  - The final result the user asked for
  - A question you need answered to proceed
  - An error you can't recover from
- Keep final responses short. 1-3 sentences is plenty.

Wrong: "I'll search Tokopedia for you. Let me take a screenshot first. I can see the homepage. Now I'll click on the search box. Now I'll type your query. Pressing enter. I see the results loading. Here are the results..."

Right: (perform all actions silently) → "Found these:" + brief list

Resolution: 1280x800. Browser: Firefox.`;

app.post("/api/chat", async (req, res) => {
  const { message, sessionId, walletAddress, userEmail: clientEmail } = req.body;
  const sid = sessionId || uuidv4();

  // Concurrency protection: serialize chats per user so memory writes don't race
  const lockKey = clientEmail?.toLowerCase() || walletAddress || sid;
  return withUserLock(lockKey, () => handleChat(req, res, message, sid, walletAddress, clientEmail));
});

async function handleChat(req, res, message, sid, walletAddress, clientEmail) {

  // Resolve userEmail: prefer the email sent by client, fall back to wallet lookup
  let userEmail = clientEmail?.toLowerCase() || null;

  if (!userEmail && walletAddress) {
    for (const [email, u] of users) {
      if (u.wallet === walletAddress) { userEmail = email; break; }
    }
  }

  // Auto-recover: if we have an email but no user record (data was wiped),
  // restore them so memory works. We can't recover the wallet keypair,
  // but we can at least keep memory functional.
  if (userEmail && !users.has(userEmail) && walletAddress) {
    console.log(`  [RECOVERY] Restoring user record for ${userEmail} (wallet from client)`);
    users.set(userEmail, {
      email: userEmail,
      wallet: walletAddress,
      walletSecret: null, // can't recover, signing will fail until re-auth
      created: new Date().toISOString(),
      recovered: true
    });
    store.saveUsers(users);

    // Initialize empty memory if missing
    if (!store.loadMemory(userEmail)) {
      store.saveMemory(userEmail, `# Memory for ${userEmail}\n\n## Profile\n- email: ${userEmail}\n\n## Notes\n`);
    }
  }

  // Validate user message — never push empty/invalid content to history
  if (!message || typeof message !== "string" || !message.trim()) {
    res.setHeader("Content-Type", "text/event-stream");
    res.write(`data: ${JSON.stringify({ type: "error", message: "Empty message" })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: "done", sessionId: sid })}\n\n`);
    return res.end();
  }

  // Load chat from disk if it exists and isn't in memory yet
  if (!sessions.has(sid) && userEmail) {
    const saved = store.loadChat(userEmail, sid);
    if (saved && Array.isArray(saved.messages)) {
      sessions.set(sid, saved.messages);
    } else {
      sessions.set(sid, []);
    }
  } else if (!sessions.has(sid)) {
    sessions.set(sid, []);
  }
  const history = sessions.get(sid);

  // Sanitize the existing history: drop any messages with empty/missing content
  // (defensive — old broken history from previous failed requests would corrupt the API call)
  const sanitizedHistory = history.filter(m => {
    if (!m || !m.role) return false;
    if (m.content === null || m.content === undefined) return false;
    if (typeof m.content === "string" && m.content.trim() === "") return false;
    if (Array.isArray(m.content) && m.content.length === 0) return false;
    return true;
  });
  if (sanitizedHistory.length !== history.length) {
    console.log(`  [HISTORY] Dropped ${history.length - sanitizedHistory.length} corrupted messages from session ${sid}`);
    sessions.set(sid, sanitizedHistory);
  }
  const cleanHistory = sessions.get(sid);
  cleanHistory.push({ role: "user", content: message });

  // Limit history to last 20 messages to control costs
  if (cleanHistory.length > 40) cleanHistory.splice(0, cleanHistory.length - 40);

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

  // Inject the user's memory from server file storage
  let userRecord = userEmail ? users.get(userEmail) : null;
  if (userEmail) {
    const memory = store.loadMemory(userEmail);
    if (memory) {
      systemPrompt += `\n\n=== YOUR MEMORY ABOUT THIS USER ===
This is what you remember about them from previous conversations. Use it to personalize your responses, skip questions you already know the answer to, and refer to past activity when relevant.

${memory}

=== END MEMORY ===

When you learn something new about the user that would be useful to remember (their name, preferences, sizes, important dates, recurring needs), call the remember tool to save it. When something becomes outdated, use forget. Keep memory clean and useful.`;
    }

    // Inject the user's settings (language, country, shipping address)
    try {
      const settings = store.loadSettings(userEmail);
      const ctx = [];
      if (settings.country) ctx.push(`Country: ${settings.country}`);
      if (settings.language && settings.language !== "en") ctx.push(`Preferred language: ${settings.language} — respond in this language`);
      if (settings.address && (settings.address.line1 || settings.address.name)) {
        const a = settings.address;
        const lines = [
          a.name,
          a.line1 + (a.line2 ? ", " + a.line2 : ""),
          [a.city, a.state, a.postal].filter(Boolean).join(", "),
          a.country,
          a.phone ? "Phone: " + a.phone : null
        ].filter(Boolean);
        ctx.push("Shipping address:\n" + lines.join("\n"));
      }
      if (ctx.length > 0) {
        systemPrompt += `\n\n=== USER SETTINGS ===\n${ctx.join("\n\n")}\n=== END SETTINGS ===\n\nUse this info automatically. Don't ask for shipping info or country if it's already here.`;
      }
    } catch (e) {}
  }

  try {
    // Strip old screenshots from history — they accumulate fast and blow the context window.
    // Image content blocks (from computer use tool results) get removed from past messages.
    const trimHistoryImages = (msgs) => msgs.map(m => {
      if (!Array.isArray(m.content)) return m;
      return {
        ...m,
        content: m.content.map(block => {
          if (block.type === "tool_result" && Array.isArray(block.content)) {
            return {
              ...block,
              content: block.content.map(c =>
                c.type === "image" ? { type: "text", text: "[screenshot from earlier — no longer shown]" } : c
              )
            };
          }
          return block;
        })
      };
    });
    let messages = trimHistoryImages([...cleanHistory]);
    let fullResponse = "";
    let toolResults = [];
    let loopCount = 0;
    // Computer use needs many more turns (each click+screenshot is one)
    const MAX_LOOPS = userRecord?.sandbox_id ? 30 : 5;

    // Computer use is enabled if E2B is configured
    // We don't create a sandbox until the agent actually uses the computer tool
    const useComputerUse = !!process.env.E2B_API_KEY && !!userEmail;
    const computerTool = useComputerUse ? [{
      type: "computer_20250124",
      name: "computer",
      display_width_px: 1280,
      display_height_px: 800,
      display_number: 0
    }] : [];

    // Helper to lazily create+resume the user's sandbox on first computer action
    async function ensureLiveSandbox() {
      if (!userRecord) return null;
      if (userRecord.sandbox_id) {
        const alive = await sandbox.isSandboxAlive(userRecord.sandbox_id);
        if (alive) return userRecord.sandbox_id;
        console.log(`  [SBX] Old sandbox ${userRecord.sandbox_id} is gone, creating fresh one`);
      }
      const newId = await sandbox.createSandbox();
      userRecord.sandbox_id = newId;
      users.set(userEmail, userRecord);
      store.saveUsers(users);
      return newId;
    }

    while (loopCount < MAX_LOOPS) {
      loopCount++;

      // Use the beta namespace for computer use (required by the SDK for beta tools)
      const streamArgs = {
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: systemPrompt,
        tools: [...TOOLS, ...computerTool],
        messages
      };

      const stream = useComputerUse
        ? anthropic.beta.messages.stream({ ...streamArgs, betas: ["computer-use-2025-01-24"] })
        : anthropic.messages.stream(streamArgs);

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

          // ─── COMPUTER USE: handle the native Anthropic computer tool ───
          if (currentToolUse.name === "computer" && userEmail) {
            const sbxId = await ensureLiveSandbox();
            if (!sbxId) {
              toolResults.push({
                type: "tool_result",
                tool_use_id: currentToolUse.id,
                content: "Could not create a sandbox for computer use",
                is_error: true
              });
              currentToolUse = null;
              toolInputJson = "";
              continue;
            }
            const action = toolInput.action;
            const coord = toolInput.coordinate;
            const text = toolInput.text;
            let resultBlock;

            try {
              switch (action) {
                case "screenshot":
                  break; // just take one
                case "left_click":
                  await sandbox.leftClick(sbxId, coord?.[0], coord?.[1]);
                  break;
                case "right_click":
                  await sandbox.rightClick(sbxId, coord?.[0], coord?.[1]);
                  break;
                case "double_click":
                  await sandbox.doubleClick(sbxId, coord?.[0], coord?.[1]);
                  break;
                case "mouse_move":
                  await sandbox.moveMouse(sbxId, coord?.[0], coord?.[1]);
                  break;
                case "type":
                  await sandbox.typeText(sbxId, text);
                  break;
                case "key":
                  // Anthropic sends keys like "Return", "ctrl+a"
                  const k = text.includes("+") ? text.split("+") : text.toLowerCase().replace("return", "enter");
                  await sandbox.pressKey(sbxId, k);
                  break;
                case "scroll":
                  const dir = toolInput.scroll_direction || "down";
                  const amt = toolInput.scroll_amount || 3;
                  if (coord) await sandbox.moveMouse(sbxId, coord[0], coord[1]);
                  await sandbox.scroll(sbxId, dir, amt);
                  break;
                case "wait":
                  await new Promise(r => setTimeout(r, (toolInput.duration || 1) * 1000));
                  break;
                case "cursor_position":
                  // No direct equivalent, just return screenshot
                  break;
                default:
                  console.log(`  [COMPUTER] Unknown action: ${action}`);
              }

              // Send action label to client immediately (don't wait for screenshot)
              const actionLabel = describeAction(action, toolInput);
              res.write(`data: ${JSON.stringify({
                type: "computer_action",
                action,
                label: actionLabel
              })}\n\n`);

              // Take screenshot for the model (skip the artificial 300ms wait)
              const screenshotB64 = await sandbox.takeScreenshot(sbxId);

              // Build the tool_result block for Anthropic with the screenshot as image
              resultBlock = {
                type: "tool_result",
                tool_use_id: currentToolUse.id,
                content: [{
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: "image/png",
                    data: screenshotB64
                  }
                }]
              };
            } catch (e) {
              console.error(`  [COMPUTER] Action ${action} failed:`, e.message);
              resultBlock = {
                type: "tool_result",
                tool_use_id: currentToolUse.id,
                content: `Error: ${e.message}`,
                is_error: true
              };
              res.write(`data: ${JSON.stringify({
                type: "tool_result", tool: "computer", input: toolInput, result: { error: e.message }
              })}\n\n`);
            }

            toolResults.push(resultBlock);
            currentToolUse = null;
            toolInputJson = "";
            continue;
          }

          // ─── REGULAR TOOLS ───
          // Load user's keypair from the encrypted server vault
          let userKeypair = null;
          if (userEmail) {
            try {
              userKeypair = vault.getKeypair(userEmail);
            } catch (e) {
              console.log("  [WARN] Could not load keypair from vault:", e.message);
            }
          }

          const toolResult = await executeTool(
            currentToolUse.name,
            toolInput,
            walletAddress,
            userKeypair,
            {
              userEmail,
              store,
              sandbox,
              sandboxId: userRecord?.sandbox_id || null
            }
          );

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
        // Validate before pushing — Anthropic requires non-empty content
        if (finalMessage.content && finalMessage.content.length > 0) {
          messages.push({ role: "assistant", content: finalMessage.content });
        }
        if (toolResults.length > 0) {
          messages.push({ role: "user", content: toolResults });
        }
        fullResponse += textContent;
        toolResults = [];

        // Keep only the last 2 screenshots in the messages array.
        // Older screenshots get replaced with text placeholders to prevent
        // the prompt from blowing past the 200K token limit during long
        // computer-use sessions.
        let imageCount = 0;
        for (let i = messages.length - 1; i >= 0; i--) {
          const m = messages[i];
          if (!Array.isArray(m.content)) continue;
          m.content = m.content.map(block => {
            if (block.type === "tool_result" && Array.isArray(block.content)) {
              const newContent = block.content.map(c => {
                if (c.type === "image") {
                  imageCount++;
                  if (imageCount > 2) {
                    return { type: "text", text: "[older screenshot removed to save context]" };
                  }
                }
                return c;
              });
              return { ...block, content: newContent };
            }
            return block;
          });
        }

        if (finalMessage.stop_reason === "end_turn") break;
      } else {
        fullResponse += textContent;
        break;
      }
    }

    // Only persist non-empty assistant responses to history
    if (fullResponse && fullResponse.trim()) {
      cleanHistory.push({ role: "assistant", content: fullResponse });
    }

    // Persist chat to disk so it survives restarts and shows in chat list
    if (userEmail && cleanHistory.length > 0) {
      try {
        // Generate a title from the first user message if none exists
        const firstUser = cleanHistory.find(m => m.role === "user" && typeof m.content === "string");
        const title = firstUser ? firstUser.content.slice(0, 60) : "New chat";
        store.saveChat(userEmail, sid, {
          id: sid,
          title,
          messages: cleanHistory,
          created: store.loadChat(userEmail, sid)?.created || new Date().toISOString()
        });
      } catch (e) {
        console.log("  [CHAT] Save error:", e.message);
      }
    }

    res.write(`data: ${JSON.stringify({ type: "done", sessionId: sid })}\n\n`);
    res.end();
  } catch (err) {
    console.error("Chat error:", err.message);
    // Drop the failed user message from history so the next request doesn't repeat the failure
    if (cleanHistory && cleanHistory.length > 0 && cleanHistory[cleanHistory.length - 1]?.role === "user") {
      cleanHistory.pop();
    }
    res.write(`data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: "done", sessionId: sid })}\n\n`);
    res.end();
  }
}

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
