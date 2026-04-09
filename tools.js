// SANO Agent Tool Definitions — 30+ tools for shopping, trading, DeFi, payments, and more

const TOOLS = [
  // ─── SHOPPING ───
  {
    name: "amazon_search",
    description: "Search Amazon's 1B+ product catalog. Returns top results with prices, ratings, reviews, and Prime eligibility.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (e.g. 'wireless earbuds under $50')" },
        sort_by: { type: "string", enum: ["relevance", "price_low", "price_high", "rating", "reviews"], default: "relevance" },
        max_price: { type: "number", description: "Maximum price in USD" },
        min_rating: { type: "number", description: "Minimum star rating (1-5)" },
        prime_only: { type: "boolean", default: false }
      },
      required: ["query"]
    }
  },
  {
    name: "amazon_purchase",
    description: "Purchase a product from Amazon using USDC from the user's wallet. Handles checkout, shipping address, and payment.",
    input_schema: {
      type: "object",
      properties: {
        product_id: { type: "string", description: "Amazon product ASIN" },
        quantity: { type: "integer", default: 1 },
        shipping_speed: { type: "string", enum: ["standard", "expedited", "one_day", "same_day"], default: "standard" }
      },
      required: ["product_id"]
    }
  },
  {
    name: "shopify_search",
    description: "Search across Shopify stores for products. Great for indie brands, niche items, and DTC products.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        category: { type: "string" },
        max_price: { type: "number" },
        store_url: { type: "string", description: "Optional: search a specific Shopify store" }
      },
      required: ["query"]
    }
  },
  {
    name: "shopify_purchase",
    description: "Purchase from a Shopify store using USDC.",
    input_schema: {
      type: "object",
      properties: {
        product_id: { type: "string" },
        variant_id: { type: "string" },
        quantity: { type: "integer", default: 1 },
        store_url: { type: "string" }
      },
      required: ["product_id", "store_url"]
    }
  },
  {
    name: "price_compare",
    description: "Compare prices for a product across Amazon, Shopify, and other retailers to find the best deal.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Product to compare" },
        product_ids: { type: "array", items: { type: "string" }, description: "Specific product IDs to compare" }
      },
      required: ["query"]
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

  // ─── STOCKS & COMMODITIES ───
  {
    name: "stock_trade",
    description: "Buy or sell 170+ stocks, commodities, and ETFs as tokenized assets. Includes AAPL, TSLA, GOLD, SPY, etc.",
    input_schema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Ticker symbol (e.g. 'AAPL', 'GOLD', 'SPY')" },
        side: { type: "string", enum: ["buy", "sell"] },
        amount_usdc: { type: "number", description: "Amount in USDC to invest" },
        order_type: { type: "string", enum: ["market", "limit"], default: "market" },
        limit_price: { type: "number", description: "Limit price (required for limit orders)" }
      },
      required: ["symbol", "side", "amount_usdc"]
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
  "Shopping": ["amazon_search", "amazon_purchase", "shopify_search", "shopify_purchase", "price_compare"],
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
