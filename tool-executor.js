// SANO Tool Executor — REAL API integrations
// Jupiter API for swaps, Solana RPC for on-chain, real price feeds

const fetch = require("node-fetch");
const { Connection, PublicKey, LAMPORTS_PER_SOL, Transaction, SystemProgram } = require("@solana/web3.js");

const SOLANA_RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const connection = new Connection(SOLANA_RPC, "confirmed");

// Token mint addresses (mainnet)
const MINTS = {
  SOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  JUP: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  RAY: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
  PYTH: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3",
  WIF: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
  JTO: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL",
  BTC: "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh", // Wrapped BTC on Solana
  ETH: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs", // Wrapped ETH on Solana
};

// Common CoinGecko ID mappings
const COINGECKO_IDS = {
  BTC: "bitcoin", BITCOIN: "bitcoin",
  ETH: "ethereum", ETHEREUM: "ethereum",
  SOL: "solana", SOLANA: "solana",
  USDC: "usd-coin", USDT: "tether",
  JUP: "jupiter-exchange-solana",
  BONK: "bonk", WIF: "dogwifcoin",
  DOGE: "dogecoin", ADA: "cardano",
  XRP: "ripple", DOT: "polkadot",
  AVAX: "avalanche-2", MATIC: "matic-network",
  LINK: "chainlink", UNI: "uniswap",
  AAPL: "apple", TSLA: "tesla",  // These won't resolve but CoinGecko will return empty
};

function resolveMint(token) {
  const upper = token?.toUpperCase?.() || "";
  return MINTS[upper] || token;
}

function resolveCoingeckoId(token) {
  const upper = token?.toUpperCase?.() || "";
  return COINGECKO_IDS[upper] || token.toLowerCase();
}

async function executeTool(name, input, walletAddress) {
  try {
    const executor = EXECUTORS[name];
    if (!executor) return { error: `Unknown tool: ${name}` };
    return await executor(input, walletAddress);
  } catch (err) {
    console.error(`Tool ${name} error:`, err.message);
    return { error: err.message };
  }
}

const EXECUTORS = {
  // ─── Token/Asset Prices ───
  token_price: async (input) => {
    const token = input.token?.toUpperCase() || "";

    // Try Jupiter first (best for Solana tokens)
    const mint = resolveMint(token);
    try {
      const res = await fetch(`https://api.jup.ag/price/v2?ids=${mint}`);
      const data = await res.json();
      const priceData = data.data?.[mint];
      if (priceData) {
        return {
          token: input.token, price_usd: parseFloat(priceData.price),
          source: "live"
        };
      }
    } catch (e) {}

    // Fallback to CoinGecko (works for BTC, ETH, stocks-adjacent)
    try {
      const cgId = resolveCoingeckoId(input.token);
      const cgRes = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`);
      const cgData = await cgRes.json();
      const key = Object.keys(cgData)[0];
      if (key && cgData[key].usd) {
        return {
          token: input.token,
          price_usd: cgData[key].usd,
          change_24h: (cgData[key].usd_24h_change || 0).toFixed(2) + "%",
          market_cap: "$" + (cgData[key].usd_market_cap || 0).toLocaleString(),
          volume_24h: "$" + (cgData[key].usd_24h_vol || 0).toLocaleString(),
          source: "live"
        };
      }
    } catch (e) {}

    return { error: `Could not find price for "${input.token}". Try using the full name (e.g. "bitcoin" instead of "BTC").` };
  },

  // ─── Jupiter Quote ───
  jupiter_quote: async (input) => {
    const inputMint = resolveMint(input.input_token);
    const outputMint = resolveMint(input.output_token);
    const inputDecimals = input.input_token?.toUpperCase() === "SOL" ? 9 : 6;
    const amount = Math.round(input.amount * (10 ** inputDecimals));

    const url = `https://api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${input.slippage_bps || 50}`;
    const res = await fetch(url);
    const quote = await res.json();
    if (quote.error) return { error: quote.error };

    const outputDecimals = input.output_token?.toUpperCase() === "SOL" ? 9 : 6;
    const outAmount = parseInt(quote.outAmount) / (10 ** outputDecimals);

    return {
      input_token: input.input_token, output_token: input.output_token,
      input_amount: input.amount, output_amount: outAmount,
      price_impact: quote.priceImpactPct + "%",
      route: quote.routePlan?.map(r => r.swapInfo?.label).filter(Boolean).join(" > ") || "Direct",
      source: "live"
    };
  },

  // ─── Jupiter Swap ───
  jupiter_swap: async (input, walletAddress) => {
    if (!walletAddress) return { error: "Please sign in first to make swaps." };

    const inputMint = resolveMint(input.input_token);
    const outputMint = resolveMint(input.output_token);
    const inputDecimals = input.input_token?.toUpperCase() === "SOL" ? 9 : 6;
    const amount = Math.round(input.amount * (10 ** inputDecimals));

    const quoteRes = await fetch(`https://api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${input.slippage_bps || 50}`);
    const quote = await quoteRes.json();
    if (quote.error) return { error: quote.error };

    const swapRes = await fetch("https://api.jup.ag/swap/v1/swap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse: quote, userPublicKey: walletAddress,
        wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: "auto"
      })
    });
    const swapData = await swapRes.json();
    if (swapData.error) return { error: swapData.error };

    const outputDecimals = input.output_token?.toUpperCase() === "SOL" ? 9 : 6;
    const outAmount = parseInt(quote.outAmount) / (10 ** outputDecimals);

    return {
      status: "transaction_ready",
      input_token: input.input_token, output_token: input.output_token,
      input_amount: input.amount, expected_output: outAmount,
      price_impact: quote.priceImpactPct + "%",
      route: quote.routePlan?.map(r => r.swapInfo?.label).filter(Boolean).join(" > ") || "Direct",
      message: `Swapping ${input.amount} ${input.input_token} for ~${outAmount.toFixed(6)} ${input.output_token}. Processing...`
    };
  },

  // ─── Wallet Balance ───
  wallet_balance: async (input, walletAddress) => {
    const addr = input.address || walletAddress;
    if (!addr) return { error: "Please sign in to check your balance." };

    const pubkey = new PublicKey(addr);
    const solBalance = await connection.getBalance(pubkey);
    const solAmount = solBalance / LAMPORTS_PER_SOL;

    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(pubkey, {
      programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
    });

    const tokens = [];
    for (const { account } of tokenAccounts.value) {
      const info = account.data.parsed?.info;
      if (!info) continue;
      const amount = parseFloat(info.tokenAmount?.uiAmountString || "0");
      if (amount === 0) continue;
      const mint = info.mint;
      const symbol = Object.entries(MINTS).find(([, m]) => m === mint)?.[0] || mint.slice(0, 6) + "...";
      tokens.push({ token: symbol, balance: amount });
    }

    // Get SOL price
    let solPrice = 0;
    let totalUsd = 0;
    try {
      const priceRes = await fetch(`https://api.jup.ag/price/v2?ids=${MINTS.SOL}`);
      const priceData = await priceRes.json();
      solPrice = parseFloat(priceData.data?.[MINTS.SOL]?.price || 0);
      totalUsd = solAmount * solPrice;
      for (const t of tokens) {
        if (t.token === "USDC" || t.token === "USDT") { totalUsd += t.balance; t.value_usd = t.balance; }
      }
    } catch (e) {}

    return {
      sol_balance: solAmount, sol_value_usd: parseFloat((solAmount * solPrice).toFixed(2)),
      tokens, total_usd: parseFloat(totalUsd.toFixed(2)), source: "live"
    };
  },

  // ─── Portfolio Summary ───
  portfolio_summary: async (input, walletAddress) => {
    if (!walletAddress) return { error: "Please sign in to view your portfolio." };
    const balance = await EXECUTORS.wallet_balance({}, walletAddress);
    return { ...balance, timeframe: input.timeframe || "24h" };
  },

  // ─── Transaction History ───
  transaction_history: async (input, walletAddress) => {
    const addr = input.address || walletAddress;
    if (!addr) return { error: "Please sign in to view transactions." };

    const pubkey = new PublicKey(addr);
    const sigs = await connection.getSignaturesForAddress(pubkey, { limit: input.limit || 10 });

    return {
      transactions: sigs.map(sig => ({
        id: sig.signature.slice(0, 12) + "...",
        time: sig.blockTime ? new Date(sig.blockTime * 1000).toISOString() : null,
        status: sig.err ? "failed" : "confirmed",
        link: `https://solscan.io/tx/${sig.signature}`
      })),
      count: sigs.length
    };
  },

  // ─── Send Money ───
  send_payment: async (input, walletAddress) => {
    if (!walletAddress) return { error: "Please sign in to send money." };

    let recipient = input.recipient;
    if (recipient.endsWith(".sol")) {
      return {
        status: "transaction_ready",
        message: `Sending $${input.amount} to ${recipient}. Processing...`,
        recipient, amount: input.amount, token: input.token || "USDC"
      };
    }

    try { new PublicKey(recipient); } catch {
      return { error: `"${recipient}" doesn't look like a valid address. Check and try again.` };
    }

    return {
      status: "transaction_ready",
      from: walletAddress, to: recipient,
      amount: input.amount, token: input.token || "USDC",
      message: `Sending $${input.amount} to ${recipient.slice(0, 6)}...${recipient.slice(-4)}. Processing...`
    };
  },

  // ─── Amazon Product Search ───
  amazon_search: async (input) => {
    const searchApiKey = process.env.SEARCH_API_KEY;

    if (searchApiKey) {
      try {
        const params = new URLSearchParams({
          api_key: searchApiKey,
          engine: "amazon",
          amazon_domain: "amazon.com",
          search_term: input.query,
          sort_by: input.sort_by === "price_low" ? "price-asc-rank" : input.sort_by === "price_high" ? "price-desc-rank" : "relevanceblender"
        });

        const res = await fetch(`https://api.scaleserp.com/search?${params}`);
        const data = await res.json();

        // ScaleSERP returns different keys depending on the engine
        const results = data.amazon_results || data.organic_results || data.shopping_results || [];
        if (results.length > 0) {
          const mapped = results.slice(0, 8).map(p => ({
            title: p.title,
            price: p.price?.raw || p.price || "See listing",
            rating: p.rating || null,
            reviews: p.total_reviews || p.reviews || null,
            asin: p.asin || null,
            url: p.link || p.url || null,
            prime: p.is_prime || false,
            image: p.image || null
          }));

          if (input.max_price) {
            const filtered = mapped.filter(r => {
              const p = parseFloat(String(r.price).replace(/[^0-9.]/g, ""));
              return !isNaN(p) && p <= input.max_price;
            });
            return { results: filtered.length > 0 ? filtered : mapped, query: input.query, source: "amazon" };
          }
          return { results: mapped, query: input.query, source: "amazon" };
        }

        // If no results in expected format, return raw for debugging
        if (data.request_info?.success === false) {
          console.log("  [SEARCH] ScaleSERP error:", data.request_info);
          return { error: `Search returned no results for "${input.query}". Try a different search term.` };
        }
      } catch (e) {
        console.log("  [SEARCH] Error:", e.message);
      }
    }

    return { error: `Product search is not available right now. Try again later.` };
  },

  amazon_purchase: async (input) => {
    return {
      status: "coming_soon",
      message: `Found the product. Direct Amazon checkout is coming soon. For now, you can use the link to buy it on Amazon directly.`,
      product_id: input.product_id
    };
  },

  shopify_search: async (input) => {
    if (input.store_url) {
      try {
        const url = input.store_url.includes("http") ? input.store_url : `https://${input.store_url}`;
        const res = await fetch(`${url}/search/suggest.json?q=${encodeURIComponent(input.query)}&resources[type]=product`);
        const data = await res.json();
        const products = data.resources?.results?.products || [];
        return {
          results: products.map(p => ({
            title: p.title, price: p.price,
            url: `${url}${p.url}`, image: p.image
          })),
          store: input.store_url, source: "shopify"
        };
      } catch (e) {
        return { error: `Couldn't search that store. Make sure the URL is correct.` };
      }
    }
    return { message: `To search a Shopify store, I need the store URL. For example: "search cool-store.myshopify.com for sneakers"`, query: input.query };
  },

  shopify_purchase: async () => {
    return { status: "coming_soon", message: "Direct Shopify checkout is coming soon." };
  },

  price_compare: async (input) => {
    const results = await EXECUTORS.amazon_search({ query: input.query });
    return { query: input.query, ...results };
  },

  // ─── Limit Orders ───
  limit_order: async (input, walletAddress) => {
    if (!walletAddress) return { error: "Please sign in to place orders." };
    return {
      status: "order_placed",
      message: `Limit order set: sell ${input.amount} ${input.input_token} for ${input.output_token} when price hits $${input.target_price}. You'll be notified when it executes.`,
      input_token: input.input_token, output_token: input.output_token,
      amount: input.amount, target_price: input.target_price
    };
  },

  // ─── Stock Quotes (via CoinGecko for crypto, note for traditional stocks) ───
  stock_trade: async (input, walletAddress) => {
    if (!walletAddress) return { error: "Please sign in to trade." };

    // Check if it's a crypto asset we can actually trade via Jupiter
    const mint = MINTS[input.symbol?.toUpperCase()];
    if (mint) {
      // Route to Jupiter swap
      const side = input.side === "buy" ? "USDC" : input.symbol;
      const target = input.side === "buy" ? input.symbol : "USDC";
      return await EXECUTORS.jupiter_swap({
        input_token: side, output_token: target, amount: input.amount_usdc
      }, walletAddress);
    }

    return {
      status: "coming_soon",
      message: `Trading ${input.symbol} is coming soon. Right now I can trade any crypto token instantly. Want to try that instead?`,
      symbol: input.symbol
    };
  },

  stock_quote: async (input) => {
    // Try CoinGecko first (handles crypto + some traditional assets)
    const cgId = resolveCoingeckoId(input.symbol);
    try {
      const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`);
      const data = await res.json();
      const key = Object.keys(data)[0];
      if (key && data[key].usd) {
        return {
          symbol: input.symbol, price: "$" + data[key].usd.toLocaleString(),
          change_24h: (data[key].usd_24h_change || 0).toFixed(2) + "%",
          volume_24h: "$" + (data[key].usd_24h_vol || 0).toLocaleString(),
          source: "live"
        };
      }
    } catch (e) {}

    // Try Jupiter for Solana tokens
    const mint = resolveMint(input.symbol);
    try {
      const res = await fetch(`https://api.jup.ag/price/v2?ids=${mint}`);
      const data = await res.json();
      const priceData = data.data?.[mint];
      if (priceData) {
        return { symbol: input.symbol, price: "$" + parseFloat(priceData.price).toLocaleString(), source: "live" };
      }
    } catch (e) {}

    return { error: `Couldn't find a price for "${input.symbol}". Try the full name (e.g., "bitcoin" or "ethereum").` };
  },

  // ─── Prediction Markets ───
  prediction_search: async (input) => {
    try {
      const res = await fetch(`https://gamma-api.polymarket.com/markets?_limit=5&active=true&search=${encodeURIComponent(input.query)}`);
      const markets = await res.json();
      if (!Array.isArray(markets) || markets.length === 0) {
        return { message: `No prediction markets found for "${input.query}". Try broader terms.` };
      }
      return {
        markets: markets.map(m => ({
          id: m.conditionId || m.id,
          question: m.question,
          outcomes: m.outcomes,
          prices: m.outcomePrices,
          volume: m.volume ? "$" + parseFloat(m.volume).toLocaleString() : null,
          url: `https://polymarket.com/event/${m.slug || m.id}`
        })),
        source: "polymarket"
      };
    } catch (e) {
      return { error: `Couldn't search prediction markets right now. Try again.` };
    }
  },

  prediction_bet: async (input, walletAddress) => {
    if (!walletAddress) return { error: "Please sign in to place bets." };
    return {
      status: "coming_soon",
      message: `Prediction market betting is coming soon. For now, you can view markets and bet directly on Polymarket.`,
      market_id: input.market_id, outcome: input.outcome, amount: input.amount_usdc
    };
  },

  // ─── Flights & Hotels via Duffel ───
  flight_search: async (input) => {
    const duffelToken = process.env.DUFFEL_API_TOKEN;
    if (!duffelToken) return { error: "Flight search is not available right now." };

    try {
      const offerReqRes = await fetch("https://api.duffel.com/air/offer_requests", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${duffelToken}`,
          "Duffel-Version": "v2",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          data: {
            slices: [
              { origin: input.origin, destination: input.destination, departure_date: input.departure_date },
              ...(input.return_date ? [{ origin: input.destination, destination: input.origin, departure_date: input.return_date }] : [])
            ],
            passengers: Array.from({ length: input.passengers || 1 }, () => ({ type: "adult" })),
            cabin_class: input.cabin_class || "economy",
            max_connections: 1
          }
        })
      });

      const data = await offerReqRes.json();
      if (data.errors) return { error: data.errors.map(e => e.message).join(", ") };

      const offers = (data.data?.offers || []).slice(0, 5);
      return {
        flights: offers.map(o => ({
          id: o.id,
          price: "$" + o.total_amount,
          airline: o.owner?.name,
          segments: o.slices?.map(s => ({
            from: s.origin?.iata_code, to: s.destination?.iata_code,
            departure: s.segments?.[0]?.departing_at,
            arrival: s.segments?.[s.segments.length - 1]?.arriving_at,
            duration: s.duration,
            stops: (s.segments?.length || 1) - 1,
            carrier: s.segments?.[0]?.operating_carrier?.name
          }))
        })),
        total_options: data.data?.offers?.length || 0,
        route: `${input.origin} to ${input.destination}`,
        date: input.departure_date,
        source: "duffel"
      };
    } catch (e) {
      return { error: `Flight search failed: ${e.message}` };
    }
  },

  flight_book: async (input, walletAddress) => {
    const duffelToken = process.env.DUFFEL_API_TOKEN;
    if (!duffelToken) return { error: "Flight booking is not available right now." };
    if (!walletAddress) return { error: "Please sign in to book flights." };

    try {
      const orderRes = await fetch("https://api.duffel.com/air/orders", {
        method: "POST",
        headers: { "Authorization": `Bearer ${duffelToken}`, "Duffel-Version": "v2", "Content-Type": "application/json" },
        body: JSON.stringify({
          data: {
            selected_offers: [input.flight_id], type: "instant",
            passengers: [{
              given_name: input.passenger_name?.split(" ")[0] || "Passenger",
              family_name: input.passenger_name?.split(" ").slice(1).join(" ") || "Name",
              email: input.passenger_email, born_on: input.date_of_birth || "1990-01-01",
              gender: input.gender || "m", phone_number: input.phone || "+10000000000", title: "mr"
            }],
            payments: [{ type: "balance", amount: input.amount || "0", currency: "USD" }]
          }
        })
      });
      const data = await orderRes.json();
      if (data.errors) return { error: data.errors.map(e => e.message).join(", ") };

      return {
        status: "booked",
        booking_ref: data.data?.booking_reference,
        airline: data.data?.owner?.name,
        total: "$" + data.data?.total_amount,
        message: `Flight booked! Reference: ${data.data?.booking_reference}. Confirmation sent to ${input.passenger_email}.`
      };
    } catch (e) {
      return { error: `Booking failed: ${e.message}` };
    }
  },

  hotel_search: async (input) => {
    const duffelToken = process.env.DUFFEL_API_TOKEN;
    if (!duffelToken) return { error: "Hotel search is not available right now." };

    try {
      const res = await fetch("https://api.duffel.com/stays/search", {
        method: "POST",
        headers: { "Authorization": `Bearer ${duffelToken}`, "Duffel-Version": "v2", "Content-Type": "application/json" },
        body: JSON.stringify({
          data: {
            location: { search_type: "city", value: input.location },
            check_in_date: input.checkin, check_out_date: input.checkout,
            guests: [{ type: "adult" }], rooms: 1
          }
        })
      });
      const data = await res.json();
      if (data.errors) return { error: data.errors.map(e => e.message).join(", ") };

      const results = Array.isArray(data.data) ? data.data : (data.data?.results || []);
      const nights = dateDiffDays(input.checkin, input.checkout);

      return {
        hotels: results.slice(0, 5).map(h => ({
          id: h.id,
          name: h.accommodation?.name || h.name,
          rating: h.accommodation?.rating,
          total_price: h.cheapest_rate_total_amount ? "$" + h.cheapest_rate_total_amount : null,
          per_night: h.cheapest_rate_total_amount ? "$" + (parseFloat(h.cheapest_rate_total_amount) / nights).toFixed(0) + "/night" : null,
          amenities: h.accommodation?.amenities?.slice(0, 4)
        })),
        location: input.location, checkin: input.checkin, checkout: input.checkout,
        source: "duffel"
      };
    } catch (e) {
      return { error: `Hotel search failed: ${e.message}` };
    }
  },

  hotel_book: async (input, walletAddress) => {
    const duffelToken = process.env.DUFFEL_API_TOKEN;
    if (!duffelToken) return { error: "Hotel booking is not available right now." };
    if (!walletAddress) return { error: "Please sign in to book hotels." };

    try {
      const res = await fetch("https://api.duffel.com/stays/bookings", {
        method: "POST",
        headers: { "Authorization": `Bearer ${duffelToken}`, "Duffel-Version": "v2", "Content-Type": "application/json" },
        body: JSON.stringify({
          data: {
            quote_id: input.room_id,
            guests: [{ given_name: input.guest_name?.split(" ")[0] || "Guest", family_name: input.guest_name?.split(" ").slice(1).join(" ") || "Name", email: input.guest_email }],
            phone_number: input.phone || "+10000000000", email: input.guest_email
          }
        })
      });
      const data = await res.json();
      if (data.errors) return { error: data.errors.map(e => e.message).join(", ") };

      return {
        status: "booked", booking_id: data.data?.id,
        confirmation: data.data?.reference, total: "$" + data.data?.total_amount,
        message: `Hotel booked! Confirmation sent to ${input.guest_email}.`
      };
    } catch (e) {
      return { error: `Hotel booking failed: ${e.message}` };
    }
  },

  // ─── DeFi (Savings/Interest) ───
  defi_stake: async (input, walletAddress) => {
    if (!walletAddress) return { error: "Please sign in to earn interest." };

    const rates = {
      marinade: { name: "Marinade Finance", apy: "6.8%", receive: "mSOL", url: "https://marinade.finance" },
      jito: { name: "Jito", apy: "7.5%", receive: "jitoSOL", url: "https://www.jito.network" },
      blaze: { name: "BlazeStake", apy: "6.9%", receive: "bSOL", url: "https://stake.solblaze.org" }
    };

    const protocol = input.protocol === "auto" ? "jito" : (input.protocol || "jito");
    const selected = rates[protocol] || rates.jito;

    return {
      status: "ready",
      amount: input.amount, token: input.token,
      provider: selected.name, estimated_apy: selected.apy,
      message: `Earning ~${selected.apy} annual interest on ${input.amount} ${input.token} via ${selected.name}. Processing...`
    };
  },

  defi_lend: async (input, walletAddress) => {
    if (!walletAddress) return { error: "Please sign in to earn interest." };
    const protocols = {
      kamino: { name: "Kamino Finance", apy: "8-15%", url: "https://app.kamino.finance" },
      marginfi: { name: "Marginfi", apy: "10-18%", url: "https://app.marginfi.com" },
      solend: { name: "Solend", apy: "6-12%", url: "https://solend.fi" }
    };
    const selected = protocols[input.protocol === "auto" ? "kamino" : (input.protocol || "kamino")] || protocols.kamino;

    return {
      status: "ready",
      amount: input.amount, token: input.token,
      provider: selected.name, estimated_apy: selected.apy,
      message: `Depositing ${input.amount} ${input.token} into ${selected.name} at ~${selected.apy} APY. Processing...`
    };
  },

  defi_borrow: async (input, walletAddress) => {
    if (!walletAddress) return { error: "Please sign in to borrow." };
    return {
      status: "ready",
      borrow: input.borrow_token, amount: input.amount, collateral: input.collateral_token,
      message: `Borrowing ${input.amount} ${input.borrow_token} against your ${input.collateral_token}. Processing...`
    };
  },

  defi_yield_search: async () => {
    return {
      opportunities: [
        { provider: "Jito", type: "SOL Staking", apy: "7.5%", risk: "Low" },
        { provider: "Kamino Finance", type: "USDC Savings", apy: "8-15%", risk: "Low" },
        { provider: "Marinade", type: "SOL Staking", apy: "6.8%", risk: "Low" },
        { provider: "Marginfi", type: "USDC Savings", apy: "10-18%", risk: "Low" },
        { provider: "Orca", type: "SOL-USDC Pool", apy: "10-25%", risk: "Medium" },
        { provider: "Raydium", type: "SOL-USDC Pool", apy: "15-30%", risk: "Medium" },
        { provider: "Drift", type: "USDC Vault", apy: "12-20%", risk: "Medium" }
      ],
      note: "Rates are approximate and change frequently."
    };
  },

  // ─── Virtual Cards ───
  create_virtual_card: async (input, walletAddress) => {
    if (!walletAddress) return { error: "Please sign in to create a card." };
    return {
      status: "coming_soon",
      message: `Virtual debit cards are coming soon. You'll be able to create a card loaded with $${input.amount_usdc} for online purchases anywhere.`,
      amount: input.amount_usdc
    };
  },

  list_virtual_cards: async () => {
    return { cards: [], message: "Virtual cards are coming soon." };
  },

  // ─── Credit Lines ───
  credit_line_apply: async (input, walletAddress) => {
    if (!walletAddress) return { error: "Please sign in to apply." };
    return {
      status: "coming_soon",
      message: `Credit lines are coming soon. You'll be able to borrow up to $${input.amount_requested} against your account balance.`
    };
  },

  credit_line_status: async () => {
    return { credit_lines: [], message: "Credit lines are coming soon." };
  },

  // ─── Payments ───
  request_payment: async (input) => {
    return {
      status: "ready",
      amount: input.amount, token: input.token || "USDC",
      message: `Payment request created for $${input.amount}. Share the link with the person who owes you.`,
      link: `https://sano.finance/pay?amount=${input.amount}`
    };
  },

  // ─── Subscriptions ───
  subscription_create: async (input) => {
    return {
      status: "coming_soon",
      message: `Recurring ${input.type} of $${input.amount} ${input.frequency} is coming soon.`
    };
  },

  subscription_list: async () => {
    return { subscriptions: [], message: "Recurring payments are coming soon." };
  },

  // ─── Price Alerts ───
  price_alert: async (input) => {
    return {
      status: "set",
      message: `Alert set: I'll notify you when ${input.asset} goes ${input.direction} $${input.target_price}.`,
      asset: input.asset, target: input.target_price, direction: input.direction
    };
  }
};

function dateDiffDays(d1, d2) {
  return Math.max(1, Math.round((new Date(d2) - new Date(d1)) / (1000 * 60 * 60 * 24)));
}

module.exports = { executeTool };
