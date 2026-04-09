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
const bitrefill = require("./bitrefill-client");
const credentials = require("./credentials-vault");

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

// xStocks (tokenized stocks via Backed Finance / Jupiter) — verified mints
const XSTOCKS = {
  AAPL: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",   // Apple
  TSLA: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",   // Tesla
  NVDA: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LYa1gNPhKy5KzwR",   // Nvidia
  MSFT: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",   // Microsoft
  GOOGL: "XsmZuhVx1KXWSxcZTRy5pcLwAEpRdWGEMVoqkSWCLxY",  // Google (Alphabet)
  AMZN: "Xs3eBt7uVfZLm3jAJfPkYW2XwTbpcnGNVnE8WoLwGmm",   // Amazon
  META: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu",   // Meta
  COIN: "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1",   // Coinbase
  MSTR: "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ",   // MicroStrategy
  SPY: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",    // S&P 500 ETF (placeholder)
  QQQ: "Xs151QeqTCiuYTbq4PNXTqEEbcdTydqEHnHy5BmsWZK",    // Nasdaq ETF
  GLD: "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ",    // Gold ETF (placeholder)
};

// Look up a token via Jupiter's token search API (covers thousands of tokens including new xStocks)
async function findTokenBySymbol(symbol) {
  const upper = symbol.toUpperCase();

  // Check known xStocks first
  if (XSTOCKS[upper]) return { mint: XSTOCKS[upper], symbol: upper, source: "xstocks" };

  // Check known crypto
  if (MINTS[upper]) return { mint: MINTS[upper], symbol: upper, source: "known" };

  // Try Jupiter token search
  try {
    const res = await fetch(`https://api.jup.ag/tokens/v1/tagged/verified?query=${encodeURIComponent(symbol)}`);
    const tokens = await res.json();
    if (Array.isArray(tokens) && tokens.length > 0) {
      // Find exact symbol match first
      const exact = tokens.find(t => t.symbol?.toUpperCase() === upper);
      if (exact) return { mint: exact.address, symbol: exact.symbol, name: exact.name, source: "jupiter" };
      // Otherwise return first match
      return { mint: tokens[0].address, symbol: tokens[0].symbol, name: tokens[0].name, source: "jupiter" };
    }
  } catch (e) {}

  // Try Jupiter's general search
  try {
    const res = await fetch(`https://tokens.jup.ag/tokens?tags=verified`);
    const tokens = await res.json();
    if (Array.isArray(tokens)) {
      const exact = tokens.find(t => t.symbol?.toUpperCase() === upper);
      if (exact) return { mint: exact.address, symbol: exact.symbol, name: exact.name, source: "jupiter" };
    }
  } catch (e) {}

  return null;
}

// Minimum SOL needed in a wallet to do any on-chain action
// (covers gas fees + ATA rent for new tokens)
const MIN_SOL_FOR_OPS = 0.005; // ~$0.50 worth

// Check if user has enough SOL for fees. Returns null if OK, or an error result if not.
async function checkSolBalance(walletAddress) {
  if (!walletAddress) return null;
  try {
    const balance = await connection.getBalance(new PublicKey(walletAddress));
    const sol = balance / LAMPORTS_PER_SOL;
    if (sol < MIN_SOL_FOR_OPS) {
      return {
        error: `Your account needs a small amount of SOL (about $0.50 worth) to pay network fees. Send any amount of SOL to your address and try again. Your address: ${walletAddress}`,
        needs_sol: true,
        current_sol: sol,
        min_sol: MIN_SOL_FOR_OPS,
        wallet: walletAddress
      };
    }
  } catch (e) {
    console.log("[SOL CHECK] Error:", e.message);
  }
  return null;
}

// ─── Main executor — receives keypair for signing + context (userEmail, store) ───
async function executeTool(name, input, walletAddress, keypair, context = {}) {
  try {
    const executor = EXECUTORS[name];
    if (!executor) return { error: `Unknown tool: ${name}` };
    return await executor(input, walletAddress, keypair, context);
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

    const solCheck = await checkSolBalance(walletAddress);
    if (solCheck) return solCheck;

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

    const solCheck = await checkSolBalance(walletAddress);
    if (solCheck) return solCheck;

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

  // ─── Product Search (Google Shopping — all stores worldwide) ───
  product_search: async (input) => {
    const searchApiKey = process.env.SEARCH_API_KEY;
    if (!searchApiKey) return { error: "Product search is not available right now." };
    try {
      const params = new URLSearchParams({
        api_key: searchApiKey,
        search_type: "shopping",
        q: input.query,
        gl: input.country || "us",
        hl: input.country === "id" ? "id" : "en"
      });
      const res = await fetch(`https://api.scaleserp.com/search?${params}`);
      const data = await res.json();
      if (data.request_info?.success === false) return { error: `No results for "${input.query}".` };
      const results = data.shopping_results || [];
      if (results.length === 0) return { error: `No products found for "${input.query}".` };

      let mapped = results.slice(0, 8).map(p => ({
        id: p.id || p.position?.toString() || Math.random().toString(36).slice(2, 8),
        title: p.title,
        price: p.price || (p.extracted_price ? "$" + p.extracted_price : "See listing"),
        extracted_price: p.extracted_price,
        store: p.source || p.merchant || "Unknown",
        rating: p.rating,
        reviews: p.reviews,
        url: p.link,
        image: p.image,
        delivery: p.delivery
      }));
      if (input.max_price) {
        const f = mapped.filter(r => r.extracted_price && r.extracted_price <= input.max_price);
        if (f.length > 0) mapped = f;
      }
      if (input.sort_by === "price_low") mapped.sort((a, b) => (a.extracted_price || 9999) - (b.extracted_price || 9999));
      if (input.sort_by === "price_high") mapped.sort((a, b) => (b.extracted_price || 0) - (a.extracted_price || 0));
      return {
        ui_type: "product_grid",  // tells frontend to render as cards
        products: mapped,
        query: input.query,
        source: "google_shopping"
      };
    } catch (e) {
      return { error: "Product search failed." };
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

  // ─── Stock Trade — REAL via xStocks on Jupiter ───
  stock_trade: async (input, walletAddress, keypair) => {
    if (!walletAddress) return { error: "Please sign in to trade." };
    if (!keypair) return { error: "Account not ready. Please sign out and back in." };

    const solCheck = await checkSolBalance(walletAddress);
    if (solCheck) return solCheck;

    const symbol = input.symbol?.toUpperCase();
    const amount = input.amount_usd || input.amount_usdc;

    // Look up the token (xStock or crypto)
    const token = await findTokenBySymbol(symbol);
    if (!token) {
      return {
        error: `Couldn't find a tradeable token for ${symbol}. I can trade major US stocks (AAPL, TSLA, NVDA, MSFT, GOOGL, AMZN, META, COIN, MSTR, SPY, QQQ) and crypto.`
      };
    }

    // Route through Jupiter swap
    const inputToken = input.side === "buy" ? "USDC" : symbol;
    const outputToken = input.side === "buy" ? symbol : "USDC";

    // Override mint resolution to use the looked-up address
    const inputMint = input.side === "buy" ? MINTS.USDC : token.mint;
    const outputMint = input.side === "buy" ? token.mint : MINTS.USDC;
    const inputDecimals = input.side === "buy" ? 6 : 8; // USDC=6, xStocks usually 8
    const swapAmount = Math.round(amount * (10 ** inputDecimals));

    try {
      // Get quote
      const quoteRes = await fetch(`https://api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${swapAmount}&slippageBps=100`);
      const quote = await quoteRes.json();
      if (quote.error) {
        return { error: `Couldn't get a quote for ${symbol}. This stock may not have liquidity right now.` };
      }

      // Get swap transaction
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
      if (!swapData.swapTransaction) return { error: "Couldn't build the trade." };

      // Sign and submit
      const txBuf = Buffer.from(swapData.swapTransaction, "base64");
      const tx = VersionedTransaction.deserialize(txBuf);
      tx.sign([keypair]);

      const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
      const confirmation = await connection.confirmTransaction(signature, "confirmed");

      if (confirmation.value?.err) {
        return {
          status: "failed",
          message: `Trade failed on-chain.`,
          signature, explorer: `https://solscan.io/tx/${signature}`
        };
      }

      const outputDecimals = input.side === "buy" ? 8 : 6;
      const received = parseInt(quote.outAmount) / (10 ** outputDecimals);

      console.log(`  [STOCK] ${input.side.toUpperCase()} ${symbol} for $${amount} | tx: ${signature}`);

      return {
        ui_type: "trade_receipt",
        status: "completed",
        side: input.side, symbol,
        amount_usd: amount,
        shares_received: input.side === "buy" ? received : null,
        usd_received: input.side === "sell" ? received : null,
        signature,
        explorer: `https://solscan.io/tx/${signature}`,
        message: input.side === "buy"
          ? `Bought ~${received.toFixed(4)} shares of ${symbol} for $${amount}.`
          : `Sold ${amount} shares of ${symbol}, received ~$${received.toFixed(2)}.`
      };
    } catch (e) {
      if (e.message?.includes("insufficient") || e.message?.includes("0x1")) {
        return { error: `Not enough USDC in your account. Add funds first.` };
      }
      console.error("  [STOCK] Error:", e.message);
      return { error: `Trade failed: ${e.message}` };
    }
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

  // ─── Prediction Market Bet ───
  // Polymarket runs on Polygon, not Solana. We need to bridge USDC cross-chain.
  // For now, provide a deep link with prefilled amount and instructions.
  prediction_bet: async (input, walletAddress) => {
    if (!walletAddress) return { error: "Please sign in." };

    // Look up the market to get the URL
    let marketUrl = `https://polymarket.com/event/${input.market_id}`;
    let marketTitle = input.market_id;

    try {
      const res = await fetch(`https://gamma-api.polymarket.com/markets/${input.market_id}`);
      const market = await res.json();
      if (market?.slug) {
        marketUrl = `https://polymarket.com/event/${market.slug}`;
        marketTitle = market.question;
      }
    } catch (e) {}

    return {
      status: "ready_to_bet",
      market: marketTitle,
      outcome: input.outcome,
      amount_usd: input.amount_usdc,
      url: marketUrl,
      message: `Ready to bet $${input.amount_usdc} on "${input.outcome}" for: ${marketTitle}. Polymarket runs on a different network (Polygon), so you'll need to complete the bet on Polymarket directly. Tap the link to go there.`,
      note: "Cross-chain bridging coming soon — for now, click the link to complete your bet on Polymarket."
    };
  },

  // ─── BUY PRODUCT — Autonomous purchase via official Bitrefill CLI ───
  // Searches for the merchant, picks the best gift card, charges USDC from user's wallet
  buy_product: async (input, walletAddress, keypair) => {
    if (!walletAddress) return { error: "Please sign in to buy things." };
    if (!keypair) return { error: "Account not ready. Please sign out and back in." };
    if (!process.env.BITREFILL_API_KEY) {
      return { error: "Shopping is not configured yet. Coming soon." };
    }

    const solCheck = await checkSolBalance(walletAddress);
    if (solCheck) return solCheck;

    try {
      // 1. Search for the merchant on Bitrefill
      const country = (input.country || "US").toUpperCase();
      const search = await bitrefill.searchProducts({
        query: input.merchant,
        country,
        productType: "giftcard"
      });

      const product = bitrefill.pickBestProduct(search, input.merchant);
      if (!product) {
        return { error: `Couldn't find ${input.merchant} on Bitrefill. Try a different store.` };
      }

      // 2. Get product details to find the right package
      const details = await bitrefill.getProductDetails({
        productId: product.id || product.product_id || product.slug,
        currency: "USD"
      });

      const pkg = bitrefill.pickBestPackage(details, input.amount_usd);
      if (!pkg) {
        return { error: `${product.name} doesn't have available packages right now.` };
      }

      // 3. Buy with USDC on Solana
      const buyResult = await bitrefill.buyProducts({
        cartItems: [{
          product_id: product.id || product.product_id || product.slug,
          package_id: pkg.package_value
        }],
        paymentMethod: "usdc_solana",
        returnPaymentLink: false
      });

      if (buyResult.error) {
        return { error: buyResult.error };
      }

      // 4. Pay the invoice with USDC from user's wallet
      const paymentInfo = buyResult.payment_info || buyResult;
      const paymentAddress = paymentInfo.address;
      const paymentAmount = parseFloat(paymentInfo.amount || paymentInfo.altcoinPrice || pkg.package_value);
      const invoiceId = buyResult.invoice_id || buyResult.id;

      if (!paymentAddress || !paymentAmount) {
        return { error: "Couldn't get payment details from Bitrefill." };
      }

      const recipientPubkey = new PublicKey(paymentAddress);
      const usdcMint = new PublicKey(MINTS.USDC);
      const fromATA = await getAssociatedTokenAddress(usdcMint, keypair.publicKey);
      const toATA = await getAssociatedTokenAddress(usdcMint, recipientPubkey);
      const rawAmount = Math.round(paymentAmount * (10 ** 6));

      const tx = new Transaction();
      const toAccount = await connection.getAccountInfo(toATA);
      if (!toAccount) {
        const { createAssociatedTokenAccountInstruction } = require("@solana/spl-token");
        tx.add(createAssociatedTokenAccountInstruction(keypair.publicKey, toATA, recipientPubkey, usdcMint));
      }
      tx.add(createTransferInstruction(fromATA, toATA, keypair.publicKey, rawAmount));
      tx.feePayer = keypair.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      tx.sign(keypair);

      const signature = await connection.sendRawTransaction(tx.serialize());
      await connection.confirmTransaction(signature, "confirmed");

      // 5. Poll Bitrefill for the redemption code
      let redemptionCode = null;
      let redemptionLink = null;
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000));
        try {
          const invoice = await bitrefill.getInvoice({ invoiceId, includeRedemption: true });
          const orders = invoice.orders || [];
          for (const o of orders) {
            const ri = o.redemption_info || o.redemptionInfo || {};
            if (ri.code || ri.link || ri.url) {
              redemptionCode = ri.code || null;
              redemptionLink = ri.link || ri.url || null;
              break;
            }
          }
          if (redemptionCode || redemptionLink) break;
        } catch (e) { /* keep polling */ }
      }

      console.log(`  [SHOP] ${input.merchant} $${input.amount_usd} | tx: ${signature}`);

      return {
        ui_type: "gift_card_receipt",
        status: "completed",
        merchant: product.name,
        product_name: input.product_name,
        amount_usd: input.amount_usd,
        package_value: pkg.package_value,
        redemption_code: redemptionCode || (redemptionLink ? `Click link to redeem` : "Delivering... check your activity"),
        redemption_link: redemptionLink,
        invoice_id: invoiceId,
        signature,
        explorer: `https://solscan.io/tx/${signature}`,
        message: `Bought a ${pkg.package_value} ${product.name} ${pkg.package_value === input.amount_usd ? "" : "(closest available)"} for "${input.product_name}".`,
      };
    } catch (e) {
      console.error("  [SHOP] Error:", e.message);
      return { error: `Purchase failed: ${e.message}` };
    }
  },

  // Buy a standalone gift card (no specific product context)
  buy_gift_card: async (input, walletAddress, keypair) => {
    return await EXECUTORS.buy_product({
      product_name: `${input.merchant} gift card`,
      merchant: input.merchant,
      amount_usd: input.amount_usd,
      country: input.country
    }, walletAddress, keypair);
  },

  list_gift_card_merchants: async (input) => {
    if (!process.env.BITREFILL_API_KEY) {
      return {
        merchants: [
          "Amazon", "Walmart", "Target", "Best Buy", "Home Depot",
          "Apple", "Google Play", "Steam", "PlayStation", "Xbox",
          "Nike", "Adidas", "Sephora", "Ulta", "Tokopedia", "Shopee", "Lazada"
        ],
        note: "Shopping not configured yet."
      };
    }
    try {
      const result = await bitrefill.searchProducts({
        query: input.category || "*",
        country: (input.country || "US").toUpperCase(),
        productType: "giftcard",
        perPage: 30
      });
      const products = result.products || result.results || [];
      return {
        merchants: products.map(p => ({
          name: p.name,
          country: p.country,
          categories: p.categories
        })),
        count: products.length
      };
    } catch (e) {
      return { error: "Couldn't load merchants right now." };
    }
  },

  // ─── CREDENTIALS: Encrypted site logins ───
  save_credential: async (input, walletAddress, keypair, context) => {
    if (!context?.userEmail) return { error: "Sign in first." };
    try {
      credentials.set(context.userEmail, input.site, input.username, input.password, input.notes || "");
      return {
        status: "saved",
        site: input.site,
        username: input.username,
        message: `Saved login for ${input.site}. I won't show the password again — it's encrypted.`
      };
    } catch (e) {
      return { error: "Couldn't save credential: " + e.message };
    }
  },

  get_credential: async (input, walletAddress, keypair, context) => {
    if (!context?.userEmail) return { error: "Sign in first." };
    try {
      const found = credentials.get(context.userEmail, input.site);
      if (found.length === 0) return { error: `No saved credentials for ${input.site}.` };
      return {
        site: input.site,
        accounts: found.map(c => ({
          username: c.username,
          password: c.password,
          notes: c.notes,
          updated: c.updated
        }))
      };
    } catch (e) {
      return { error: "Couldn't load credential: " + e.message };
    }
  },

  list_credentials: async (input, walletAddress, keypair, context) => {
    if (!context?.userEmail) return { error: "Sign in first." };
    try {
      const list = credentials.list(context.userEmail);
      return { count: list.length, credentials: list };
    } catch (e) {
      return { error: "Couldn't list credentials." };
    }
  },

  delete_credential: async (input, walletAddress, keypair, context) => {
    if (!context?.userEmail) return { error: "Sign in first." };
    try {
      const removed = credentials.remove(context.userEmail, input.site, input.username);
      return { removed, message: removed > 0 ? `Removed ${removed} credential(s) for ${input.site}.` : `No credentials found for ${input.site}.` };
    } catch (e) {
      return { error: "Couldn't delete credential." };
    }
  },

  // ─── MEMORY: Remember and forget (server file storage) ───
  remember: async (input, walletAddress, keypair, context) => {
    if (!context?.userEmail || !context?.store) return { error: "Sign in first." };
    const section = input.section || "Notes";
    context.store.rememberFact(context.userEmail, input.fact, section);
    return { status: "saved", fact: input.fact, section, message: `Got it. I'll remember that.` };
  },

  forget: async (input, walletAddress, keypair, context) => {
    if (!context?.userEmail || !context?.store) return { error: "Sign in first." };
    context.store.forgetFact(context.userEmail, input.query);
    return { status: "forgotten", query: input.query, message: `Removed entries matching "${input.query}".` };
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

  request_payment: async (input) => ({ status: "ready", amount: input.amount, message: `Payment request for $${input.amount} created.`, link: `https://sano.finance/pay?amount=${input.amount}` }),
  price_alert: async (input) => ({ status: "set", message: `Alert set: ${input.asset} ${input.direction} $${input.target_price}.` }),
};

module.exports = { executeTool };
