// SANO Agent Tool Definitions — 30+ tools for shopping, trading, DeFi, payments, and more

const TOOLS = [
  // ─── SHOPPING ───
  {
    name: "product_search",
    description: "Search for products across all stores — Google Shopping results include Amazon, Walmart, Target, Best Buy, eBay, and more. Use this for general product searches. Returns prices, ratings, store names, and links.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for (e.g. 'wireless earbuds under $50', 'Nike Air Max size 10')" },
        max_price: { type: "number", description: "Maximum price in USD" },
        sort_by: { type: "string", enum: ["relevance", "price_low", "price_high", "rating"], default: "relevance" }
      },
      required: ["query"]
    }
  },
  {
    name: "buy_product",
    description: "Buy or top up ANYTHING the user asks for, paid from their USDC balance. Bitrefill carries 1500+ products across 180+ countries: gift cards (Amazon, Walmart, Target, Nike, Sephora, etc.), subscriptions (Netflix, Spotify, Hulu, Apple, Google Play), gaming (Steam, PlayStation, Xbox, Roblox/Robux, Fortnite/V-Bucks, Riot/Valorant, League, Genshin), mobile top-ups (any carrier worldwide), e-wallets (GCash, GoPay, OVO, Dana, AliPay, Paytm, MercadoPago, etc.), eSIMs, food delivery (DoorDash, Uber Eats, Grubhub), travel (Airbnb, Hotels.com), bill payments, prepaid cards. If the user wants to buy/top up/fund/subscribe to ANYTHING, use this tool first. If the tool returns needs_recipient, ask the user for their phone number or account ID and try again with recipient_number set.",
    input_schema: {
      type: "object",
      properties: {
        product_name: { type: "string", description: "What the user is buying (e.g. 'Netflix subscription', 'Robux', 'GCash top-up')" },
        merchant: { type: "string", description: "Service or store name (e.g. 'Netflix', 'Roblox', 'GCash', 'GoPay', 'Amazon', 'Steam')" },
        amount_usd: { type: "number", description: "Approximate amount in USD. Bitrefill has fixed denominations — the closest matching one will be picked." },
        country: { type: "string", default: "US", description: "ISO country code: US, PH for Philippines, ID for Indonesia, BR for Brazil, IN for India, etc." },
        recipient_number: { type: "string", description: "Phone number or account ID for products that need it (mobile top-ups, e-wallets, etc.). Only include if the user has shared it." },
        product_url: { type: "string", description: "Optional: direct link to the product page" }
      },
      required: ["merchant", "amount_usd"]
    }
  },
  {
    name: "buy_gift_card",
    description: "Same as buy_product but specifically for traditional retail gift cards. Prefer buy_product unless the user explicitly says 'gift card'.",
    input_schema: {
      type: "object",
      properties: {
        merchant: { type: "string", description: "Store name" },
        amount_usd: { type: "number" },
        country: { type: "string", default: "US" }
      },
      required: ["merchant", "amount_usd"]
    }
  },
  {
    name: "list_gift_card_merchants",
    description: "List all merchants where the user can buy gift cards with USDC. Use when the user asks 'where can I shop' or 'what stores can I buy from'.",
    input_schema: {
      type: "object",
      properties: {
        category: { type: "string", description: "Filter by category (e.g. 'shopping', 'food', 'gaming', 'travel')" },
        country: { type: "string", default: "US" }
      },
      required: []
    }
  },

  // ─── TOKEN SWAPS & TRADING ───
  {
    name: "jupiter_swap",
    description: "Swap any SPL token instantly via Jupiter aggregator on Solana. Best price routing across all Solana DEXs.",
    input_schema: {
      type: "object",
      properties: {
        input_token: { type: "string", description: "Token to sell (e.g. 'USDC', 'SOL', or mint address)" },
        output_token: { type: "string", description: "Token to buy" },
        amount: { type: "number", description: "Amount of input token to swap" },
        slippage_bps: { type: "integer", default: 50, description: "Slippage tolerance in basis points" }
      },
      required: ["input_token", "output_token", "amount"]
    }
  },
  {
    name: "jupiter_quote",
    description: "Get a price quote for a token swap via Jupiter without executing. Shows route, price impact, and fees.",
    input_schema: {
      type: "object",
      properties: {
        input_token: { type: "string" },
        output_token: { type: "string" },
        amount: { type: "number" }
      },
      required: ["input_token", "output_token", "amount"]
    }
  },
  {
    name: "token_price",
    description: "Get current price, 24h change, market cap, and volume for any token.",
    input_schema: {
      type: "object",
      properties: {
        token: { type: "string", description: "Token symbol or mint address" },
        include_chart: { type: "boolean", default: false, description: "Include 24h price chart data" }
      },
      required: ["token"]
    }
  },
  {
    name: "limit_order",
    description: "Place a limit order on Jupiter. Executes automatically when price target is hit.",
    input_schema: {
      type: "object",
      properties: {
        input_token: { type: "string" },
        output_token: { type: "string" },
        amount: { type: "number" },
        target_price: { type: "number", description: "Execute when this price is reached" },
        expiry_hours: { type: "integer", default: 24 }
      },
      required: ["input_token", "output_token", "amount", "target_price"]
    }
  },

  // ─── STOCKS & COMMODITIES (via tokenized stocks on Solana) ───
  {
    name: "stock_trade",
    description: "Buy or sell tokenized stocks (xStocks) using the user's USDC balance. Real exposure to AAPL, TSLA, NVDA, MSFT, GOOGL, AMZN, META, COIN, MSTR, SPY, etc. as SPL tokens that track the underlying asset 1:1. Executes a real swap on Jupiter.",
    input_schema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Stock ticker (e.g. 'AAPL', 'TSLA', 'NVDA', 'SPY')" },
        side: { type: "string", enum: ["buy", "sell"] },
        amount_usd: { type: "number", description: "Amount in USD to buy/sell" }
      },
      required: ["symbol", "side", "amount_usd"]
    }
  },
  {
    name: "stock_quote",
    description: "Get real-time quote for stocks, commodities, or ETFs.",
    input_schema: {
      type: "object",
      properties: {
        symbol: { type: "string" }
      },
      required: ["symbol"]
    }
  },

  // ─── PREDICTION MARKETS ───
  // Both work end-to-end on Solana via Jupiter Predict (aggregates Polymarket + Kalshi liquidity)
  {
    name: "prediction_search",
    description: "Search prediction markets via Jupiter Predict (aggregated from Polymarket and Kalshi). Returns trending markets, live markets, or filtered by category. Markets cover crypto, sports, politics, esports, culture, economics, tech. Each market has YES/NO contracts you can buy.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search term (e.g. 'NBA finals', 'BTC above 150k', 'next president'). Leave empty to get trending markets." },
        category: { type: "string", enum: ["crypto", "sports", "politics", "esports", "culture", "economics", "tech"], description: "Filter by category" }
      },
      required: []
    }
  },
  {
    name: "prediction_bet",
    description: "Place a real bet on a prediction market via Jupiter Predict. You can pass EITHER a market_id from search results, OR a natural language query + sub_market to let the tool find the right market automatically. ALWAYS confirm the amount and outcome with the user before calling this tool.",
    input_schema: {
      type: "object",
      properties: {
        market_id: { type: "string", description: "Optional: exact marketId from prediction_search (e.g. 'POLY-568630')" },
        query: { type: "string", description: "Optional: natural language search if you don't have a market_id (e.g. 'masters', 'champions league')" },
        sub_market: { type: "string", description: "Optional: which sub-market to bet on (e.g. 'Rory McIlroy', 'Bayern Munich')" },
        outcome: { type: "string", description: "Which side: 'yes' or 'no'", enum: ["yes", "no"] },
        amount_usdc: { type: "number", description: "How much USDC to bet (minimum $1.50)" }
      },
      required: ["outcome", "amount_usdc"]
    }
  },

  // ─── PAYMENTS & TRANSFERS ───
  {
    name: "send_payment",
    description: "Send USDC or any SPL token to anyone on-chain. Supports Solana addresses, .sol domains, and usernames.",
    input_schema: {
      type: "object",
      properties: {
        recipient: { type: "string", description: "Wallet address, .sol domain, or username" },
        amount: { type: "number" },
        token: { type: "string", default: "USDC", description: "Token to send" },
        memo: { type: "string", description: "Optional on-chain memo" }
      },
      required: ["recipient", "amount"]
    }
  },
  {
    name: "request_payment",
    description: "Request a payment from someone. Generates a Solana Pay link or QR code.",
    input_schema: {
      type: "object",
      properties: {
        amount: { type: "number" },
        token: { type: "string", default: "USDC" },
        memo: { type: "string" },
        recipient_label: { type: "string", description: "Your name/label shown to payer" }
      },
      required: ["amount"]
    }
  },

  // ─── CREDENTIALS (encrypted vault for site logins) ───
  {
    name: "save_credential",
    description: "Save a website login (username + password) to the user's encrypted credentials vault. Use this when the user shares login info for a site they want you to access. The data is encrypted end-to-end.",
    input_schema: {
      type: "object",
      properties: {
        site: { type: "string", description: "The website (e.g. 'amazon.com', 'tokopedia.com')" },
        username: { type: "string", description: "The username or email used to log in" },
        password: { type: "string", description: "The password" },
        notes: { type: "string", description: "Any notes (e.g. 'has 2FA', 'use guest checkout')" }
      },
      required: ["site", "username", "password"]
    }
  },
  {
    name: "get_credential",
    description: "Retrieve saved credentials for a website. Use this when you need to log into a site on the user's behalf.",
    input_schema: {
      type: "object",
      properties: {
        site: { type: "string", description: "The website to look up" }
      },
      required: ["site"]
    }
  },
  {
    name: "list_credentials",
    description: "List all sites the user has saved credentials for (without showing passwords). Use this when the user asks what accounts you have access to.",
    input_schema: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "delete_credential",
    description: "Remove saved credentials for a site.",
    input_schema: {
      type: "object",
      properties: {
        site: { type: "string" },
        username: { type: "string", description: "Optional, if multiple accounts on same site" }
      },
      required: ["site"]
    }
  },

  // ─── MEMORY (per-user persistent agent memory) ───
  {
    name: "remember",
    description: "Save a fact about the user to your persistent memory. Use this whenever you learn something useful — their name, shipping address, preferences, sizes, important dates, recurring needs, things they've bought, anything that would help you serve them better in future conversations. Be specific and concise.",
    input_schema: {
      type: "object",
      properties: {
        fact: { type: "string", description: "The fact to remember (e.g. 'shipping address: 123 Main St, San Francisco, CA 94102', 'shoe size: 10', 'prefers Sony electronics over Apple', 'spending limit: $200 per purchase without confirmation')" },
        section: { type: "string", description: "Section to save under: 'Profile' for personal info (name, address, phone), 'Preferences' for likes/dislikes, 'Notes' for general notes and history.", default: "Notes" }
      },
      required: ["fact"]
    }
  },
  {
    name: "forget",
    description: "Remove a fact from memory. Use when info becomes outdated (old address, old preference). Provide a search term that uniquely identifies the entry.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text to find and remove from memory" }
      },
      required: ["query"]
    }
  },

  // ─── DeFi ───
  {
    name: "defi_stake",
    description: "Stake SOL or other tokens to earn yield. Routes to the best validator or liquid staking protocol.",
    input_schema: {
      type: "object",
      properties: {
        token: { type: "string", description: "Token to stake (e.g. 'SOL')" },
        amount: { type: "number" },
        protocol: { type: "string", enum: ["marinade", "jito", "blaze", "auto"], default: "auto", description: "'auto' picks the highest yield" }
      },
      required: ["token", "amount"]
    }
  },
  {
    name: "defi_lend",
    description: "Lend tokens to earn interest via DeFi protocols (Marginfi, Kamino, Solend).",
    input_schema: {
      type: "object",
      properties: {
        token: { type: "string" },
        amount: { type: "number" },
        protocol: { type: "string", enum: ["marginfi", "kamino", "solend", "auto"], default: "auto" }
      },
      required: ["token", "amount"]
    }
  },
  {
    name: "defi_borrow",
    description: "Borrow tokens against your deposited collateral on DeFi protocols.",
    input_schema: {
      type: "object",
      properties: {
        borrow_token: { type: "string", description: "Token to borrow" },
        amount: { type: "number" },
        collateral_token: { type: "string" },
        protocol: { type: "string", enum: ["marginfi", "kamino", "solend", "auto"], default: "auto" }
      },
      required: ["borrow_token", "amount"]
    }
  },
  {
    name: "defi_yield_search",
    description: "Find the best yield opportunities across Solana DeFi. Search by token, risk level, and protocol.",
    input_schema: {
      type: "object",
      properties: {
        token: { type: "string", description: "Token to find yield for" },
        risk_level: { type: "string", enum: ["low", "medium", "high"], default: "low" },
        min_apy: { type: "number" }
      },
      required: []
    }
  },

  // ─── WALLET & PORTFOLIO ───
  {
    name: "wallet_balance",
    description: "Check your wallet balances — all tokens, USDC, SOL, NFTs, and total portfolio value.",
    input_schema: {
      type: "object",
      properties: {
        include_nfts: { type: "boolean", default: false },
        include_defi_positions: { type: "boolean", default: true }
      },
      required: []
    }
  },
  {
    name: "portfolio_summary",
    description: "Get a full portfolio breakdown — holdings, P&L, DeFi positions, active orders, credit lines, and card balances.",
    input_schema: {
      type: "object",
      properties: {
        timeframe: { type: "string", enum: ["24h", "7d", "30d", "all"], default: "24h" }
      },
      required: []
    }
  },
  {
    name: "transaction_history",
    description: "View your recent transaction history — swaps, purchases, payments, and DeFi activity.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "integer", default: 20 },
        type: { type: "string", enum: ["all", "swaps", "purchases", "payments", "defi"], default: "all" }
      },
      required: []
    }
  },

  // ─── SUBSCRIPTIONS & RECURRING ───
  {
    name: "subscription_create",
    description: "Set up recurring payments — subscribe to services, auto-pay bills, or DCA into tokens.",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["payment", "dca", "bill"] },
        recipient: { type: "string", description: "Address or service" },
        amount: { type: "number" },
        token: { type: "string", default: "USDC" },
        frequency: { type: "string", enum: ["daily", "weekly", "biweekly", "monthly"] },
        description: { type: "string" }
      },
      required: ["type", "amount", "frequency"]
    }
  },
  {
    name: "subscription_list",
    description: "List all active subscriptions and recurring payments.",
    input_schema: {
      type: "object",
      properties: {},
      required: []
    }
  },

  // ─── NOTIFICATIONS & ALERTS ───
  {
    name: "price_alert",
    description: "Set a price alert for any token or stock. Get notified when it hits your target.",
    input_schema: {
      type: "object",
      properties: {
        asset: { type: "string", description: "Token symbol or stock ticker" },
        target_price: { type: "number" },
        direction: { type: "string", enum: ["above", "below"] },
        notify_via: { type: "string", enum: ["chat", "email", "both"], default: "chat" }
      },
      required: ["asset", "target_price", "direction"]
    }
  }
];

// Tool category mapping for UI
const TOOL_CATEGORIES = {
  "Shopping": ["product_search", "buy_product", "buy_gift_card", "list_gift_card_merchants"],
  "Stocks": ["stock_trade", "stock_quote"],
  "Trading": ["jupiter_swap", "jupiter_quote", "token_price", "limit_order"],
  "Prediction Markets": ["prediction_bet", "prediction_search"],
  "Payments": ["send_payment", "request_payment"],
  "Earn": ["defi_stake", "defi_lend", "defi_yield_search"],
  "Account": ["wallet_balance", "portfolio_summary", "transaction_history"],
  "Memory": ["remember", "forget"],
  "Alerts": ["price_alert"]
};

module.exports = { TOOLS, TOOL_CATEGORIES };
