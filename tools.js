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
    name: "amazon_search",
    description: "Search specifically on Amazon. Only use this when the user explicitly mentions Amazon. Returns prices, ratings, reviews, and Prime eligibility.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        max_price: { type: "number", description: "Maximum price in USD" },
        sort_by: { type: "string", enum: ["relevance", "price_low", "price_high", "rating"], default: "relevance" }
      },
      required: ["query"]
    }
  },
  {
    name: "shopify_search",
    description: "Search a specific Shopify store for products. Use when the user provides a store URL or asks about a specific brand's Shopify store.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        store_url: { type: "string", description: "The Shopify store URL (e.g. allbirds.com, gymshark.com)" }
      },
      required: ["query"]
    }
  },
  {
    name: "buy_gift_card",
    description: "Buy a gift card from any major retailer (Amazon, Walmart, Target, Best Buy, Home Depot, etc.) using the user's USDC balance. The user receives a redeemable code they can use on the retailer's site. Use this to actually buy products — generate a gift card for the right amount, then send the code.",
    input_schema: {
      type: "object",
      properties: {
        merchant: { type: "string", description: "Store name (e.g. 'Amazon', 'Walmart', 'Target', 'Best Buy', 'Steam', 'Apple', 'Nike')" },
        amount_usd: { type: "number", description: "Gift card amount in USD" },
        country: { type: "string", default: "US", description: "ISO country code" }
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

  // ─── VIRTUAL VISA CARDS ───
  {
    name: "create_virtual_card",
    description: "Create a virtual Visa card funded with USDC for online purchases anywhere Visa is accepted.",
    input_schema: {
      type: "object",
      properties: {
        amount_usdc: { type: "number", description: "Amount to load onto the card" },
        label: { type: "string", description: "Label for the card (e.g. 'Netflix', 'Shopping')" },
        single_use: { type: "boolean", default: false, description: "Burn after first transaction" },
        spending_limit: { type: "number", description: "Max spend per transaction" }
      },
      required: ["amount_usdc"]
    }
  },
  {
    name: "list_virtual_cards",
    description: "List all your active virtual Visa cards with balances and recent transactions.",
    input_schema: {
      type: "object",
      properties: {},
      required: []
    }
  },

  // ─── CREDIT LINES ───
  {
    name: "credit_line_apply",
    description: "Apply for a USDC credit line backed by your on-chain assets. Instant approval based on wallet history.",
    input_schema: {
      type: "object",
      properties: {
        amount_requested: { type: "number", description: "Credit line amount in USDC" },
        collateral_token: { type: "string", description: "Token to use as collateral (e.g. 'SOL', 'ETH')" }
      },
      required: ["amount_requested"]
    }
  },
  {
    name: "credit_line_status",
    description: "Check your active credit lines — balance, available credit, payments due, and interest rate.",
    input_schema: {
      type: "object",
      properties: {},
      required: []
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

  // ─── TRAVEL ───
  {
    name: "flight_search",
    description: "Search for flights. Compare prices across airlines. Pay with USDC.",
    input_schema: {
      type: "object",
      properties: {
        origin: { type: "string", description: "Departure airport code (e.g. 'LAX')" },
        destination: { type: "string", description: "Arrival airport code (e.g. 'JFK')" },
        departure_date: { type: "string", description: "YYYY-MM-DD" },
        return_date: { type: "string", description: "YYYY-MM-DD (omit for one-way)" },
        passengers: { type: "integer", default: 1 },
        cabin_class: { type: "string", enum: ["economy", "premium_economy", "business", "first"], default: "economy" }
      },
      required: ["origin", "destination", "departure_date"]
    }
  },
  {
    name: "flight_book",
    description: "Book a flight and pay with USDC from your wallet.",
    input_schema: {
      type: "object",
      properties: {
        flight_id: { type: "string" },
        passenger_name: { type: "string" },
        passenger_email: { type: "string" }
      },
      required: ["flight_id", "passenger_name", "passenger_email"]
    }
  },
  {
    name: "hotel_search",
    description: "Search hotels by location, dates, and preferences. Pay with USDC.",
    input_schema: {
      type: "object",
      properties: {
        location: { type: "string" },
        checkin: { type: "string", description: "YYYY-MM-DD" },
        checkout: { type: "string", description: "YYYY-MM-DD" },
        guests: { type: "integer", default: 1 },
        max_price_per_night: { type: "number" }
      },
      required: ["location", "checkin", "checkout"]
    }
  },
  {
    name: "hotel_book",
    description: "Book a hotel room and pay with USDC.",
    input_schema: {
      type: "object",
      properties: {
        hotel_id: { type: "string" },
        room_id: { type: "string" },
        guest_name: { type: "string" },
        guest_email: { type: "string" }
      },
      required: ["hotel_id", "room_id", "guest_name", "guest_email"]
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
  "Shopping": ["product_search", "amazon_search", "shopify_search", "buy_gift_card", "list_gift_card_merchants"],
  "Token Swaps": ["jupiter_swap", "jupiter_quote", "token_price", "limit_order"],
  "Stocks & ETFs": ["stock_trade", "stock_quote"],
  "Prediction Markets": ["prediction_bet", "prediction_search"],
  "Payments": ["send_payment", "request_payment"],
  "Virtual Cards": ["create_virtual_card", "list_virtual_cards"],
  "Credit": ["credit_line_apply", "credit_line_status"],
  "DeFi": ["defi_stake", "defi_lend", "defi_borrow", "defi_yield_search"],
  "Travel": ["flight_search", "flight_book", "hotel_search", "hotel_book"],
  "Wallet": ["wallet_balance", "portfolio_summary", "transaction_history"],
  "Subscriptions": ["subscription_create", "subscription_list"],
  "Alerts": ["price_alert"]
};

module.exports = { TOOLS, TOOL_CATEGORIES };
