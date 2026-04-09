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
    description: "AUTONOMOUSLY buy a product the user asked for. This is the main purchasing tool. Pass the product details and the merchant — the agent will charge the user's USDC balance and complete the purchase via the appropriate fulfillment method (gift card for retail stores, direct payment for crypto-friendly merchants). Works for Amazon, Walmart, Target, Best Buy, Home Depot, Apple, Nike, Tokopedia, Shopee, Lazada, Steam, PlayStation, Xbox, and 600+ retailers globally.",
    input_schema: {
      type: "object",
      properties: {
        product_name: { type: "string", description: "What the user is buying (e.g. 'Sony WH-1000XM5 headphones')" },
        merchant: { type: "string", description: "Store to buy from (e.g. 'Amazon', 'Tokopedia', 'Walmart')" },
        product_url: { type: "string", description: "Direct link to the product page" },
        amount_usd: { type: "number", description: "Total price in USD (or USD equivalent)" },
        country: { type: "string", default: "US", description: "ISO country code (US, ID for Indonesia, etc.)" }
      },
      required: ["product_name", "merchant", "amount_usd"]
    }
  },
  {
    name: "buy_gift_card",
    description: "Buy a standalone gift card (not tied to a specific product) from any retailer using USDC. Use this when user explicitly asks for a gift card as a gift, or when buy_product needs to fall back to gift card flow.",
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
  {
    name: "prediction_bet",
    description: "Place a bet on prediction markets (Polymarket, Drift, etc). Bet on elections, crypto prices, sports, world events.",
    input_schema: {
      type: "object",
      properties: {
        market_id: { type: "string" },
        outcome: { type: "string", description: "The outcome you're betting on (e.g. 'Yes', 'No', team name)" },
        amount_usdc: { type: "number" },
        platform: { type: "string", enum: ["polymarket", "drift", "hedgehog"], default: "polymarket" }
      },
      required: ["market_id", "outcome", "amount_usdc"]
    }
  },
  {
    name: "prediction_search",
    description: "Search active prediction markets. Find markets on politics, crypto, sports, tech, and world events.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for (e.g. 'BTC above 100k', 'next US president')" },
        category: { type: "string", enum: ["crypto", "politics", "sports", "tech", "entertainment", "world"] }
      },
      required: ["query"]
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
  "Alerts": ["price_alert"]
};

module.exports = { TOOLS, TOOL_CATEGORIES };
