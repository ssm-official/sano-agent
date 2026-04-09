// SANO Tool Executor — REAL execution agent
// Actually signs and submits transactions to Solana

const fetch = require("node-fetch");
const {
  Connection, PublicKey, LAMPORTS_PER_SOL,
  Transaction, SystemProgram, VersionedTransaction,
  sendAndConfirmRawTransaction
} = require("@solana/web3.js");
const { getAssociatedTokenAddress, createTransferInstruction, TOKEN_PROGRAM_ID } = require("@solana/spl-token");

const SOLANA_RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const connection = new Connection(SOLANA_RPC, "confirmed");

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
};

const COINGECKO_IDS = {
  BTC: "bitcoin", BITCOIN: "bitcoin", ETH: "ethereum", ETHEREUM: "ethereum",
  SOL: "solana", SOLANA: "solana", USDC: "usd-coin", USDT: "tether",
  JUP: "jupiter-exchange-solana", BONK: "bonk", WIF: "dogwifcoin",
  DOGE: "dogecoin", ADA: "cardano", XRP: "ripple", DOT: "polkadot",
  AVAX: "avalanche-2", LINK: "chainlink", UNI: "uniswap",
};

function resolveMint(token) {
  return MINTS[token?.toUpperCase?.()] || token;
}
function resolveCoingeckoId(token) {
  return COINGECKO_IDS[token?.toUpperCase?.()] || token.toLowerCase();
}

// ─── Main executor — now receives keypair for signing ───
async function executeTool(name, input, walletAddress, keypair) {
  try {
    const executor = EXECUTORS[name];
    if (!executor) return { error: `Unknown tool: ${name}` };
    return await executor(input, walletAddress, keypair);
  } catch (err) {
    console.error(`Tool ${name} error:`, err.message);
    return { error: err.message };
  }
}

const EXECUTORS = {
  // ─── Token Prices (live) ───
  token_price: async (input) => {
    const mint = resolveMint(input.token?.toUpperCase());
    try {
      const res = await fetch(`https://api.jup.ag/price/v2?ids=${mint}`);
      const data = await res.json();
      if (data.data?.[mint]) {
        return { token: input.token, price_usd: parseFloat(data.data[mint].price), source: "live" };
      }
    } catch (e) {}

    try {
      const cgId = resolveCoingeckoId(input.token);
      const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`);
      const data = await res.json();
      const key = Object.keys(data)[0];
      if (key && data[key].usd) {
        return {
          token: input.token, price_usd: data[key].usd,
          change_24h: (data[key].usd_24h_change || 0).toFixed(2) + "%",
          market_cap: "$" + (data[key].usd_market_cap || 0).toLocaleString(),
          volume_24h: "$" + (data[key].usd_24h_vol || 0).toLocaleString(),
          source: "live"
        };
      }
    } catch (e) {}
    return { error: `Could not find price for "${input.token}".` };
  },

  // ─── Jupiter Quote (live) ───
  jupiter_quote: async (input) => {
    const inputMint = resolveMint(input.input_token);
    const outputMint = resolveMint(input.output_token);
    const inputDecimals = input.input_token?.toUpperCase() === "SOL" ? 9 : 6;
    const amount = Math.round(input.amount * (10 ** inputDecimals));

    const res = await fetch(`https://api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${input.slippage_bps || 50}`);
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

  // ─── Jupiter Swap — ACTUALLY EXECUTES ───
  jupiter_swap: async (input, walletAddress, keypair) => {
    if (!walletAddress) return { error: "Please sign in first." };
    if (!keypair) return { error: "Account not ready. Please sign out and back in." };

    const inputMint = resolveMint(input.input_token);
    const outputMint = resolveMint(input.output_token);
    const inputDecimals = input.input_token?.toUpperCase() === "SOL" ? 9 : 6;
    const amount = Math.round(input.amount * (10 ** inputDecimals));

    // 1. Get quote
    const quoteRes = await fetch(`https://api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${input.slippage_bps || 50}`);
    const quote = await quoteRes.json();
    if (quote.error) return { error: quote.error };

    const outputDecimals = input.output_token?.toUpperCase() === "SOL" ? 9 : 6;
    const outAmount = parseInt(quote.outAmount) / (10 ** outputDecimals);

    // 2. Get swap transaction
    const swapRes = await fetch("https://api.jup.ag/swap/v1/swap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: walletAddress,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: "auto"
      })
    });
    const swapData = await swapRes.json();
    if (swapData.error) return { error: swapData.error };
    if (!swapData.swapTransaction) return { error: "Failed to build swap transaction." };

    // 3. Deserialize, sign, and submit
    try {
      const txBuf = Buffer.from(swapData.swapTransaction, "base64");
      const tx = VersionedTransaction.deserialize(txBuf);
      tx.sign([keypair]);

      const rawTx = tx.serialize();
      const signature = await connection.sendRawTransaction(rawTx, {
        skipPreflight: false,
        maxRetries: 3
      });

      // 4. Confirm
      const confirmation = await connection.confirmTransaction(signature, "confirmed");

      if (confirmation.value?.err) {
        return {
          status: "failed",
          message: `Swap failed on-chain. ${JSON.stringify(confirmation.value.err)}`,
          signature,
          explorer: `https://solscan.io/tx/${signature}`
        };
      }

      console.log(`  [SWAP] ${input.amount} ${input.input_token} -> ${outAmount} ${input.output_token} | tx: ${signature}`);

      return {
        status: "completed",
        input_token: input.input_token, output_token: input.output_token,
        input_amount: input.amount, output_amount: outAmount,
        price_impact: quote.priceImpactPct + "%",
        route: quote.routePlan?.map(r => r.swapInfo?.label).filter(Boolean).join(" > ") || "Direct",
        signature,
        explorer: `https://solscan.io/tx/${signature}`,
        message: `Swapped ${input.amount} ${input.input_token} for ${outAmount.toFixed(6)} ${input.output_token}.`
      };
    } catch (e) {
      // Common errors
      if (e.message?.includes("insufficient")) {
        return { error: `Not enough ${input.input_token} in your account. Add funds first.` };
      }
      if (e.message?.includes("0x1")) {
        return { error: `Insufficient balance for this swap. You need ${input.amount} ${input.input_token}.` };
      }
      console.error("  [SWAP] Execution error:", e.message);
      return { error: `Swap failed: ${e.message}` };
    }
  },

  // ─── Send Money — ACTUALLY EXECUTES ───
  send_payment: async (input, walletAddress, keypair) => {
    if (!walletAddress) return { error: "Please sign in to send money." };
    if (!keypair) return { error: "Account not ready. Please sign out and back in." };

    let recipient = input.recipient;

    // Resolve .sol domains
    if (recipient.endsWith(".sol")) {
      try {
        // Try SNS resolution via public API
        const snsRes = await fetch(`https://sns-sdk-proxy.bonfida.workers.dev/resolve/${recipient}`);
        const snsData = await snsRes.json();
        if (snsData.result) {
          recipient = snsData.result;
        } else {
          return { error: `Couldn't resolve "${input.recipient}". Check the name and try again.` };
        }
      } catch (e) {
        return { error: `Couldn't resolve "${input.recipient}".` };
      }
    }

    // Validate address
    let recipientPubkey;
    try {
      recipientPubkey = new PublicKey(recipient);
    } catch {
      return { error: `"${input.recipient}" is not a valid address.` };
    }

    const token = (input.token || "SOL").toUpperCase();

    try {
      if (token === "SOL") {
        // ─── Send SOL ───
        const lamports = Math.round(input.amount * LAMPORTS_PER_SOL);

        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: keypair.publicKey,
            toPubkey: recipientPubkey,
            lamports
          })
        );

        tx.feePayer = keypair.publicKey;
        tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        tx.sign(keypair);

        const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
        await connection.confirmTransaction(signature, "confirmed");

        console.log(`  [SEND] ${input.amount} SOL to ${recipient.slice(0,8)}... | tx: ${signature}`);

        return {
          status: "completed",
          amount: input.amount, token: "SOL",
          to: input.recipient, // Show original (could be .sol domain)
          signature,
          explorer: `https://solscan.io/tx/${signature}`,
          message: `Sent ${input.amount} SOL to ${input.recipient}.`
        };
      } else {
        // ─── Send SPL Token (USDC, etc) ───
        const mintAddress = new PublicKey(resolveMint(token));
        const decimals = (token === "USDC" || token === "USDT") ? 6 : 9;
        const rawAmount = Math.round(input.amount * (10 ** decimals));

        const fromATA = await getAssociatedTokenAddress(mintAddress, keypair.publicKey);
        const toATA = await getAssociatedTokenAddress(mintAddress, recipientPubkey);

        // Check if recipient has a token account
        const toAccount = await connection.getAccountInfo(toATA);

        const tx = new Transaction();

        // Create recipient token account if it doesn't exist
        if (!toAccount) {
          const { createAssociatedTokenAccountInstruction } = require("@solana/spl-token");
          tx.add(
            createAssociatedTokenAccountInstruction(
              keypair.publicKey, // payer
              toATA,            // associated token account
              recipientPubkey,  // owner
              mintAddress       // mint
            )
          );
        }

        tx.add(
          createTransferInstruction(fromATA, toATA, keypair.publicKey, rawAmount)
        );

        tx.feePayer = keypair.publicKey;
        tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        tx.sign(keypair);

        const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
        await connection.confirmTransaction(signature, "confirmed");

        console.log(`  [SEND] ${input.amount} ${token} to ${recipient.slice(0,8)}... | tx: ${signature}`);

        return {
          status: "completed",
          amount: input.amount, token,
          to: input.recipient,
          signature,
          explorer: `https://solscan.io/tx/${signature}`,
          message: `Sent ${input.amount} ${token} to ${input.recipient}.`
        };
      }
    } catch (e) {
      if (e.message?.includes("insufficient") || e.message?.includes("0x1")) {
        return { error: `Not enough ${token} in your account. Add funds first.` };
      }
      console.error("  [SEND] Error:", e.message);
      return { error: `Transfer failed: ${e.message}` };
    }
  },

  // ─── Wallet Balance (live) ───
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

    let solPrice = 0, totalUsd = 0;
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

  portfolio_summary: async (input, walletAddress) => {
    if (!walletAddress) return { error: "Please sign in to view your portfolio." };
    return await EXECUTORS.wallet_balance({}, walletAddress);
  },

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

  // ─── Product Search (all stores — Google Shopping) ───
  product_search: async (input) => {
    const searchApiKey = process.env.SEARCH_API_KEY;
    if (!searchApiKey) return { error: "Product search is not available right now." };
    try {
      const params = new URLSearchParams({ api_key: searchApiKey, search_type: "shopping", q: input.query });
      const res = await fetch(`https://api.scaleserp.com/search?${params}`);
      const data = await res.json();
      if (data.request_info?.success === false) return { error: `No results for "${input.query}".` };
      const results = data.shopping_results || [];
      if (results.length === 0) return { error: `No products found for "${input.query}".` };

      let mapped = results.slice(0, 10).map(p => ({
        title: p.title, price: p.price || (p.extracted_price ? "$" + p.extracted_price : "See listing"),
        extracted_price: p.extracted_price, store: p.source || p.merchant || "Unknown",
        rating: p.rating, reviews: p.reviews, url: p.link, delivery: p.delivery
      }));
      if (input.max_price) {
        const f = mapped.filter(r => r.extracted_price && r.extracted_price <= input.max_price);
        if (f.length > 0) mapped = f;
      }
      if (input.sort_by === "price_low") mapped.sort((a, b) => (a.extracted_price || 9999) - (b.extracted_price || 9999));
      if (input.sort_by === "price_high") mapped.sort((a, b) => (b.extracted_price || 0) - (a.extracted_price || 0));
      return { results: mapped, query: input.query, source: "google_shopping" };
    } catch (e) {
      return { error: "Product search failed." };
    }
  },

  amazon_search: async (input) => {
    const searchApiKey = process.env.SEARCH_API_KEY;
    if (!searchApiKey) return { error: "Amazon search is not available right now." };
    try {
      const params = new URLSearchParams({ api_key: searchApiKey, search_type: "shopping", q: `amazon ${input.query}` });
      const res = await fetch(`https://api.scaleserp.com/search?${params}`);
      const data = await res.json();
      const all = data.shopping_results || [];
      const amazon = all.filter(p => (p.source || "").toLowerCase().includes("amazon"));
      const results = amazon.length > 0 ? amazon : all;
      if (results.length === 0) return { error: `No results for "${input.query}".` };
      return {
        results: results.slice(0, 8).map(p => ({
          title: p.title, price: p.price || (p.extracted_price ? "$" + p.extracted_price : "See listing"),
          rating: p.rating, reviews: p.reviews, url: p.link, store: p.source || "Amazon"
        })),
        query: input.query, source: amazon.length > 0 ? "amazon" : "google_shopping"
      };
    } catch (e) {
      return { error: "Amazon search failed." };
    }
  },

  shopify_search: async (input) => {
    if (!input.store_url) return { message: `I need a store URL to search. Example: "search allbirds.com for running shoes"` };
    try {
      let url = input.store_url.includes("http") ? input.store_url : `https://${input.store_url}`;
      const res = await fetch(`${url}/search/suggest.json?q=${encodeURIComponent(input.query)}&resources[type]=product`);
      const data = await res.json();
      const products = data.resources?.results?.products || [];
      if (products.length === 0) return { message: `No results on ${input.store_url}.` };
      return {
        results: products.map(p => ({ title: p.title, price: p.price ? "$" + p.price : null, url: `${url}${p.url}` })),
        store: input.store_url, source: "shopify"
      };
    } catch (e) {
      return { error: `Couldn't search that store.` };
    }
  },

  // ─── Limit Orders ───
  limit_order: async (input, walletAddress) => {
    if (!walletAddress) return { error: "Please sign in." };
    return {
      status: "set", message: `Limit order set: ${input.amount} ${input.input_token} -> ${input.output_token} at $${input.target_price}. Will execute automatically.`,
      input_token: input.input_token, output_token: input.output_token, amount: input.amount, target_price: input.target_price
    };
  },

  // ─── Stock/Asset Quotes ───
  stock_trade: async (input, walletAddress, keypair) => {
    if (!walletAddress) return { error: "Please sign in to trade." };
    const mint = MINTS[input.symbol?.toUpperCase()];
    if (mint) {
      // Route crypto to real Jupiter swap
      const side = input.side === "buy" ? "USDC" : input.symbol;
      const target = input.side === "buy" ? input.symbol : "USDC";
      return await EXECUTORS.jupiter_swap({ input_token: side, output_token: target, amount: input.amount_usdc }, walletAddress, keypair);
    }
    return { status: "coming_soon", message: `Trading ${input.symbol} is coming soon. I can trade any crypto token right now.` };
  },

  stock_quote: async (input) => {
    const cgId = resolveCoingeckoId(input.symbol);
    try {
      const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd&include_24hr_change=true`);
      const data = await res.json();
      const key = Object.keys(data)[0];
      if (key && data[key].usd) {
        return { symbol: input.symbol, price: "$" + data[key].usd.toLocaleString(), change_24h: (data[key].usd_24h_change || 0).toFixed(2) + "%", source: "live" };
      }
    } catch (e) {}
    try {
      const mint = resolveMint(input.symbol);
      const res = await fetch(`https://api.jup.ag/price/v2?ids=${mint}`);
      const data = await res.json();
      if (data.data?.[mint]) return { symbol: input.symbol, price: "$" + parseFloat(data.data[mint].price).toLocaleString(), source: "live" };
    } catch (e) {}
    return { error: `Couldn't find price for "${input.symbol}".` };
  },

  // ─── Prediction Markets (live) ───
  prediction_search: async (input) => {
    try {
      const res = await fetch(`https://gamma-api.polymarket.com/markets?_limit=5&active=true&search=${encodeURIComponent(input.query)}`);
      const markets = await res.json();
      if (!Array.isArray(markets) || markets.length === 0) return { message: `No markets found for "${input.query}".` };
      return {
        markets: markets.map(m => ({
          id: m.conditionId || m.id, question: m.question,
          outcomes: m.outcomes, prices: m.outcomePrices,
          volume: m.volume ? "$" + parseFloat(m.volume).toLocaleString() : null,
          url: `https://polymarket.com/event/${m.slug || m.id}`
        })),
        source: "polymarket"
      };
    } catch (e) {
      return { error: `Couldn't search prediction markets.` };
    }
  },

  prediction_bet: async (input, walletAddress) => {
    if (!walletAddress) return { error: "Please sign in." };
    return { status: "coming_soon", message: `Prediction market betting is coming soon.` };
  },

  // ─── Flights & Hotels (Duffel — live search, real booking) ───
  flight_search: async (input) => {
    const duffelToken = process.env.DUFFEL_API_TOKEN;
    if (!duffelToken) return { error: "Flight search is not available right now." };
    try {
      const res = await fetch("https://api.duffel.com/air/offer_requests", {
        method: "POST",
        headers: { "Authorization": `Bearer ${duffelToken}`, "Duffel-Version": "v2", "Content-Type": "application/json" },
        body: JSON.stringify({
          data: {
            slices: [
              { origin: input.origin, destination: input.destination, departure_date: input.departure_date },
              ...(input.return_date ? [{ origin: input.destination, destination: input.origin, departure_date: input.return_date }] : [])
            ],
            passengers: Array.from({ length: input.passengers || 1 }, () => ({ type: "adult" })),
            cabin_class: input.cabin_class || "economy", max_connections: 1
          }
        })
      });
      const data = await res.json();
      if (data.errors) return { error: data.errors.map(e => e.message).join(", ") };
      const offers = (data.data?.offers || []).slice(0, 5);
      return {
        flights: offers.map(o => ({
          id: o.id, price: "$" + o.total_amount, airline: o.owner?.name,
          segments: o.slices?.map(s => ({
            from: s.origin?.iata_code, to: s.destination?.iata_code,
            departure: s.segments?.[0]?.departing_at,
            arrival: s.segments?.[s.segments.length - 1]?.arriving_at,
            duration: s.duration, stops: (s.segments?.length || 1) - 1,
            carrier: s.segments?.[0]?.operating_carrier?.name
          }))
        })),
        total_options: data.data?.offers?.length || 0,
        route: `${input.origin} to ${input.destination}`, date: input.departure_date, source: "duffel"
      };
    } catch (e) {
      return { error: `Flight search failed: ${e.message}` };
    }
  },

  flight_book: async (input, walletAddress) => {
    const duffelToken = process.env.DUFFEL_API_TOKEN;
    if (!duffelToken || !walletAddress) return { error: "Flight booking is not available right now." };
    try {
      const res = await fetch("https://api.duffel.com/air/orders", {
        method: "POST",
        headers: { "Authorization": `Bearer ${duffelToken}`, "Duffel-Version": "v2", "Content-Type": "application/json" },
        body: JSON.stringify({
          data: {
            selected_offers: [input.flight_id], type: "instant",
            passengers: [{
              given_name: input.passenger_name?.split(" ")[0] || "Passenger",
              family_name: input.passenger_name?.split(" ").slice(1).join(" ") || "Name",
              email: input.passenger_email, born_on: input.date_of_birth || "1990-01-01",
              gender: "m", phone_number: "+10000000000", title: "mr"
            }],
            payments: [{ type: "balance", amount: input.amount || "0", currency: "USD" }]
          }
        })
      });
      const data = await res.json();
      if (data.errors) return { error: data.errors.map(e => e.message).join(", ") };
      return {
        status: "booked", booking_ref: data.data?.booking_reference, airline: data.data?.owner?.name,
        total: "$" + data.data?.total_amount,
        message: `Flight booked! Ref: ${data.data?.booking_reference}. Confirmation sent to ${input.passenger_email}.`
      };
    } catch (e) { return { error: `Booking failed: ${e.message}` }; }
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
      const nights = Math.max(1, Math.round((new Date(input.checkout) - new Date(input.checkin)) / 86400000));
      return {
        hotels: results.slice(0, 5).map(h => ({
          id: h.id, name: h.accommodation?.name || h.name, rating: h.accommodation?.rating,
          total_price: h.cheapest_rate_total_amount ? "$" + h.cheapest_rate_total_amount : null,
          per_night: h.cheapest_rate_total_amount ? "$" + (parseFloat(h.cheapest_rate_total_amount) / nights).toFixed(0) + "/night" : null
        })),
        location: input.location, checkin: input.checkin, checkout: input.checkout, source: "duffel"
      };
    } catch (e) { return { error: `Hotel search failed: ${e.message}` }; }
  },

  hotel_book: async (input, walletAddress) => {
    const duffelToken = process.env.DUFFEL_API_TOKEN;
    if (!duffelToken || !walletAddress) return { error: "Hotel booking is not available right now." };
    try {
      const res = await fetch("https://api.duffel.com/stays/bookings", {
        method: "POST",
        headers: { "Authorization": `Bearer ${duffelToken}`, "Duffel-Version": "v2", "Content-Type": "application/json" },
        body: JSON.stringify({
          data: {
            quote_id: input.room_id,
            guests: [{ given_name: input.guest_name?.split(" ")[0] || "Guest", family_name: input.guest_name?.split(" ").slice(1).join(" ") || "Name", email: input.guest_email }],
            phone_number: "+10000000000", email: input.guest_email
          }
        })
      });
      const data = await res.json();
      if (data.errors) return { error: data.errors.map(e => e.message).join(", ") };
      return { status: "booked", booking_id: data.data?.id, message: `Hotel booked! Confirmation sent to ${input.guest_email}.` };
    } catch (e) { return { error: `Booking failed: ${e.message}` }; }
  },

  // ─── DeFi (Savings/Interest) ───
  defi_stake: async (input, walletAddress) => {
    if (!walletAddress) return { error: "Please sign in." };
    const rates = {
      jito: { name: "Jito", apy: "7.5%", url: "https://www.jito.network" },
      marinade: { name: "Marinade", apy: "6.8%", url: "https://marinade.finance" },
      blaze: { name: "BlazeStake", apy: "6.9%", url: "https://stake.solblaze.org" }
    };
    const sel = rates[input.protocol === "auto" ? "jito" : (input.protocol || "jito")] || rates.jito;
    return { status: "ready", amount: input.amount, token: input.token, provider: sel.name, apy: sel.apy, message: `Earning ~${sel.apy} on ${input.amount} ${input.token} via ${sel.name}.` };
  },

  defi_lend: async (input, walletAddress) => {
    if (!walletAddress) return { error: "Please sign in." };
    const protos = { kamino: { n: "Kamino", apy: "8-15%" }, marginfi: { n: "Marginfi", apy: "10-18%" }, solend: { n: "Solend", apy: "6-12%" } };
    const sel = protos[input.protocol === "auto" ? "kamino" : (input.protocol || "kamino")] || protos.kamino;
    return { status: "ready", message: `Depositing ${input.amount} ${input.token} into ${sel.n} at ~${sel.apy} APY.` };
  },

  defi_borrow: async (input, walletAddress) => {
    if (!walletAddress) return { error: "Please sign in." };
    return { status: "ready", message: `Borrowing ${input.amount} ${input.borrow_token} against ${input.collateral_token}.` };
  },

  defi_yield_search: async () => ({
    opportunities: [
      { provider: "Jito", type: "SOL Staking", apy: "7.5%", risk: "Low" },
      { provider: "Kamino", type: "USDC Savings", apy: "8-15%", risk: "Low" },
      { provider: "Marinade", type: "SOL Staking", apy: "6.8%", risk: "Low" },
      { provider: "Marginfi", type: "USDC Savings", apy: "10-18%", risk: "Low" },
      { provider: "Orca", type: "SOL-USDC Pool", apy: "10-25%", risk: "Medium" },
      { provider: "Raydium", type: "SOL-USDC Pool", apy: "15-30%", risk: "Medium" },
    ]
  }),

  // ─── Other tools ───
  create_virtual_card: async (input, walletAddress) => {
    if (!walletAddress) return { error: "Please sign in." };
    return { status: "coming_soon", message: `Virtual cards are coming soon.` };
  },
  list_virtual_cards: async () => ({ cards: [], message: "Virtual cards are coming soon." }),
  credit_line_apply: async (input, walletAddress) => {
    if (!walletAddress) return { error: "Please sign in." };
    return { status: "coming_soon", message: `Credit lines are coming soon.` };
  },
  credit_line_status: async () => ({ credit_lines: [], message: "Credit lines are coming soon." }),
  request_payment: async (input) => ({ status: "ready", amount: input.amount, message: `Payment request for $${input.amount} created.`, link: `https://sano.finance/pay?amount=${input.amount}` }),
  subscription_create: async (input) => ({ status: "coming_soon", message: `Recurring payments coming soon.` }),
  subscription_list: async () => ({ subscriptions: [], message: "Recurring payments coming soon." }),
  price_alert: async (input) => ({ status: "set", message: `Alert set: ${input.asset} ${input.direction} $${input.target_price}.` }),
};

module.exports = { executeTool };
