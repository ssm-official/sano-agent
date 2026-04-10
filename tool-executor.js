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

// xStocks (tokenized stocks via Backed Finance / Jupiter) — known mints
// Note: many more are available via dynamic Jupiter token search; these are
// just the fast-path lookups for the most common tickers.
const XSTOCKS = {
  AAPL: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
  TSLA: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
  NVDA: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LYa1gNPhKy5KzwR",
  MSFT: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
  GOOGL: "XsmZuhVx1KXWSxcZTRy5pcLwAEpRdWGEMVoqkSWCLxY",
  GOOG: "XsmZuhVx1KXWSxcZTRy5pcLwAEpRdWGEMVoqkSWCLxY",
  AMZN: "Xs3eBt7uVfZLm3jAJfPkYW2XwTbpcnGNVnE8WoLwGmm",
  META: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu",
  COIN: "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1",
  MSTR: "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ",
  QQQ: "Xs151QeqTCiuYTbq4PNXTqEEbcdTydqEHnHy5BmsWZK",
};

// In-memory cache for dynamic stock lookups (5min TTL)
const stockMintCache = new Map();
function getCachedMint(symbol) {
  const entry = stockMintCache.get(symbol.toUpperCase());
  if (entry && Date.now() - entry.time < 5 * 60 * 1000) return entry.mint;
  return null;
}
function setCachedMint(symbol, mint) {
  stockMintCache.set(symbol.toUpperCase(), { mint, time: Date.now() });
}

// Look up a token via Jupiter's token search — covers thousands of tokens
// including ALL xStocks dynamically (not just the hardcoded ones)
async function findTokenBySymbol(symbol) {
  const upper = symbol.toUpperCase();

  // 1. Fast path: known xStocks
  if (XSTOCKS[upper]) return { mint: XSTOCKS[upper], symbol: upper, source: "xstocks" };

  // 2. Fast path: known crypto
  if (MINTS[upper]) return { mint: MINTS[upper], symbol: upper, source: "known" };

  // 3. Cache hit
  const cached = getCachedMint(upper);
  if (cached) return { mint: cached, symbol: upper, source: "cache" };

  // 4. Search for xStock variant (most common: SYMBOLx, xSYMBOL)
  // Backed Finance uses naming like "AAPLx", "TSLAx" for xStock variants
  for (const variant of [upper + "x", "x" + upper, upper + "X"]) {
    try {
      const res = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${variant}`);
      if (res.ok) {
        const data = await res.json();
        const tokens = Array.isArray(data) ? data : (data.tokens || data.data || []);
        // Find one whose symbol exactly matches the variant or starts with our symbol
        const match = tokens.find(t =>
          t.symbol?.toUpperCase() === variant.toUpperCase() ||
          (t.symbol?.toUpperCase().startsWith(upper) && (t.tags?.includes("xstock") || t.name?.toLowerCase().includes("xstock") || t.name?.toLowerCase().includes("backed")))
        );
        if (match && match.address) {
          setCachedMint(upper, match.address);
          return { mint: match.address, symbol: match.symbol, name: match.name, source: "jupiter_search" };
        }
      }
    } catch (e) {}
  }

  // 5. General search by the raw symbol
  try {
    const res = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${upper}`);
    if (res.ok) {
      const data = await res.json();
      const tokens = Array.isArray(data) ? data : (data.tokens || data.data || []);
      const exact = tokens.find(t => t.symbol?.toUpperCase() === upper);
      if (exact && exact.address) {
        setCachedMint(upper, exact.address);
        return { mint: exact.address, symbol: exact.symbol, name: exact.name, source: "jupiter_search" };
      }
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
    // Try the lite-api v3 first (has xStocks + regular tokens)
    const upper = input.token?.toUpperCase() || "";
    let mint = MINTS[upper] || XSTOCKS[upper] || resolveMint(upper);
    try {
      const res = await fetch(`https://lite-api.jup.ag/price/v3?ids=${mint}`);
      if (res.ok) {
        const data = await res.json();
        const entry = data[mint];
        if (entry?.usdPrice) {
          return {
            token: input.token,
            price_usd: parseFloat(entry.usdPrice),
            change_24h: entry.priceChange24h ? entry.priceChange24h.toFixed(2) + "%" : null,
            source: "live"
          };
        }
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
      const confirmation = await connection.confirmTransaction(signature, "processed");

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
        await connection.confirmTransaction(signature, "processed");

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
        await connection.confirmTransaction(signature, "processed");

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

    // Query BOTH the original SPL Token program AND Token-2022 program
    // (xStocks and many newer tokens use Token-2022)
    const SPL_TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

    const [splAccounts, t22Accounts] = await Promise.all([
      connection.getParsedTokenAccountsByOwner(pubkey, { programId: SPL_TOKEN }),
      connection.getParsedTokenAccountsByOwner(pubkey, { programId: TOKEN_2022 })
    ]);

    // Collect all non-zero token holdings from both programs
    const rawHoldings = [];
    for (const { account } of [...splAccounts.value, ...t22Accounts.value]) {
      const info = account.data.parsed?.info;
      if (!info) continue;
      const amount = parseFloat(info.tokenAmount?.uiAmountString || "0");
      if (amount === 0) continue;
      rawHoldings.push({ mint: info.mint, balance: amount });
    }

    // Identify each token: known crypto, known xStock, or look up via Jupiter
    const knownXStocks = Object.entries(XSTOCKS).reduce((acc, [sym, mint]) => { acc[mint] = sym; return acc; }, {});
    const knownCrypto = Object.entries(MINTS).reduce((acc, [sym, mint]) => { acc[mint] = sym; return acc; }, {});
    const unknownMints = [];

    const tokens = rawHoldings.map(h => {
      const xStock = knownXStocks[h.mint];
      if (xStock) return { token: xStock, mint: h.mint, balance: h.balance, type: "stock" };
      const crypto = knownCrypto[h.mint];
      if (crypto) return { token: crypto, mint: h.mint, balance: h.balance, type: "crypto" };
      unknownMints.push(h.mint);
      return { token: null, mint: h.mint, balance: h.balance, type: "unknown" };
    });

    // Look up unknown tokens via Jupiter token list (one batch call)
    if (unknownMints.length > 0) {
      try {
        const lookupUrl = `https://api.jup.ag/tokens/v1/mints/${unknownMints.join(",")}`;
        const lookupRes = await fetch(lookupUrl);
        if (lookupRes.ok) {
          const lookupData = await lookupRes.json();
          const tokenList = Array.isArray(lookupData) ? lookupData : lookupData.tokens || [];
          for (const t of tokens) {
            if (t.token) continue;
            const info = tokenList.find(x => x.address === t.mint);
            if (info) {
              t.token = info.symbol;
              t.name = info.name;
              t.type = "token";
            } else {
              t.token = t.mint.slice(0, 6) + "...";
            }
          }
        }
      } catch (e) {}
    }

    // Get prices for all tokens (batch) — use lite-api/price/v3 which has
    // xStocks AND regular tokens. The old api.jup.ag/price/v2 returns 404
    // for xStock mints.
    const allMints = [MINTS.SOL, ...rawHoldings.map(h => h.mint)];
    let solPrice = 0;
    const prices = {};
    try {
      const priceRes = await fetch(`https://lite-api.jup.ag/price/v3?ids=${allMints.join(",")}`);
      if (priceRes.ok) {
        const priceData = await priceRes.json();
        for (const mint of allMints) {
          const entry = priceData[mint];
          if (entry?.usdPrice) prices[mint] = parseFloat(entry.usdPrice);
        }
        solPrice = prices[MINTS.SOL] || 0;
      }
    } catch (e) {
      console.log("[PRICE] Error:", e.message);
    }

    // Compute USD values
    let totalUsd = solAmount * solPrice;
    for (const t of tokens) {
      const price = prices[t.mint] || 0;
      t.price_usd = price;
      t.value_usd = parseFloat((t.balance * price).toFixed(2));
      totalUsd += t.value_usd;
    }

    // Sort tokens by value descending
    tokens.sort((a, b) => (b.value_usd || 0) - (a.value_usd || 0));

    // Separate stock holdings from cash holdings for clarity
    const stockHoldings = tokens.filter(t => t.type === "stock");
    const cryptoHoldings = tokens.filter(t => t.type !== "stock");

    return {
      sol_balance: solAmount,
      sol_value_usd: parseFloat((solAmount * solPrice).toFixed(2)),
      cash_holdings: cryptoHoldings.map(t => ({ token: t.token, balance: t.balance, value_usd: t.value_usd })),
      stock_holdings: stockHoldings.map(t => ({ ticker: t.token, shares: t.balance, value_usd: t.value_usd })),
      total_usd: parseFloat(totalUsd.toFixed(2)),
      source: "live"
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
    const inputMint = input.side === "buy" ? MINTS.USDC : token.mint;
    const outputMint = input.side === "buy" ? token.mint : MINTS.USDC;

    let swapAmount;
    if (input.side === "buy") {
      // Buy: input is USDC (6 decimals), amount is the USD value
      swapAmount = Math.round(amount * (10 ** 6));
    } else {
      // Sell: input is the stock token. We need to convert USD value to share amount.
      // Read the user's actual balance + price, then calculate.
      try {
        // Get token decimals + user's balance from on-chain
        const userPubkey = new PublicKey(walletAddress);
        const stockMint = new PublicKey(token.mint);
        // xStocks live in Token-2022
        const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
        const SPL_TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
        const [t22Accounts, splAccounts] = await Promise.all([
          connection.getParsedTokenAccountsByOwner(userPubkey, { mint: stockMint, programId: TOKEN_2022 }).catch(() => ({ value: [] })),
          connection.getParsedTokenAccountsByOwner(userPubkey, { mint: stockMint, programId: SPL_TOKEN }).catch(() => ({ value: [] }))
        ]);
        const accounts = [...(t22Accounts.value || []), ...(splAccounts.value || [])];
        if (accounts.length === 0) {
          return { error: `You don't have any ${symbol} to sell.` };
        }
        const info = accounts[0].account.data.parsed?.info;
        const decimals = info?.tokenAmount?.decimals || 8;
        const userShares = parseFloat(info?.tokenAmount?.uiAmountString || "0");
        if (userShares === 0) {
          return { error: `You don't have any ${symbol} to sell.` };
        }

        // Get current price from lite-api/price/v3
        let currentPrice = 0;
        try {
          const priceRes = await fetch(`https://lite-api.jup.ag/price/v3?ids=${token.mint}`);
          if (priceRes.ok) {
            const priceData = await priceRes.json();
            currentPrice = parseFloat(priceData[token.mint]?.usdPrice || 0);
          }
        } catch (e) {}

        // Calculate how many shares to sell
        let sharesToSell;
        if (currentPrice > 0 && amount > 0) {
          const positionValueUsd = userShares * currentPrice;
          if (amount >= positionValueUsd * 0.99) {
            // Selling effectively all → use exact balance to avoid dust
            sharesToSell = userShares;
          } else {
            sharesToSell = amount / currentPrice;
          }
        } else {
          // No price available — sell whatever the user said (interpret as shares)
          sharesToSell = Math.min(amount, userShares);
        }

        // Convert to raw amount, capped at what they actually have
        const rawDesired = Math.floor(sharesToSell * (10 ** decimals));
        const rawBalance = parseInt(info.tokenAmount.amount, 10);
        swapAmount = Math.min(rawDesired, rawBalance);

        if (swapAmount <= 0) {
          return { error: `Calculated sell amount is too small.` };
        }
      } catch (e) {
        console.log("[STOCK SELL] Balance check failed:", e.message);
        // Fallback to old behavior
        swapAmount = Math.round(amount * (10 ** 8));
      }
    }

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

      const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
      // Use 'processed' instead of 'confirmed' for faster UX (~2s vs 10s)
      const confirmation = await connection.confirmTransaction(signature, "processed");

      if (confirmation.value?.err) {
        return {
          status: "failed",
          message: `Trade failed on-chain.`,
          signature, explorer: `https://solscan.io/tx/${signature}`
        };
      }

      const outputDecimals = input.side === "buy" ? 8 : 6;
      const received = parseInt(quote.outAmount) / (10 ** outputDecimals);

      // For SELL receipts, the actual USD value is what we got back, NOT
      // what the user originally typed. For BUY, the input amount is the USD.
      const actualUsdValue = input.side === "sell" ? received : amount;
      // Calculate actual shares involved in this trade
      const inputDecimals = input.side === "buy" ? 6 : 8;
      const sharesTraded = input.side === "buy" ? received : (swapAmount / (10 ** inputDecimals));

      console.log(`  [STOCK] ${input.side.toUpperCase()} ${symbol} | tx: ${signature}`);

      return {
        ui_type: "trade_receipt",
        status: "completed",
        side: input.side, symbol,
        amount_usd: parseFloat(actualUsdValue.toFixed(2)),
        shares: parseFloat(sharesTraded.toFixed(6)),
        shares_received: input.side === "buy" ? received : null,
        usd_received: input.side === "sell" ? received : null,
        signature,
        explorer: `https://solscan.io/tx/${signature}`,
        message: input.side === "buy"
          ? `Bought ${received.toFixed(6)} shares of ${symbol} for $${amount.toFixed(2)}.`
          : `Sold ${sharesTraded.toFixed(6)} shares of ${symbol} for $${received.toFixed(2)}.`
      };
    } catch (e) {
      if (e.message?.includes("insufficient") || e.message?.includes("0x1")) {
        return { error: `Not enough ${input.side === "buy" ? "USDC" : symbol} in your account.` };
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
      const upper = input.symbol?.toUpperCase() || "";
      const mint = MINTS[upper] || XSTOCKS[upper] || resolveMint(upper);
      const res = await fetch(`https://lite-api.jup.ag/price/v3?ids=${mint}`);
      if (res.ok) {
        const data = await res.json();
        const entry = data[mint];
        if (entry?.usdPrice) {
          return {
            symbol: input.symbol,
            price: "$" + parseFloat(entry.usdPrice).toLocaleString(),
            change_24h: entry.priceChange24h ? entry.priceChange24h.toFixed(2) + "%" : null,
            source: "live"
          };
        }
      }
    } catch (e) {}
    return { error: `Couldn't find price for "${input.symbol}".` };
  },

  // ─── Prediction Markets via Jupiter Prediction API (Solana-native) ───
  // Aggregates Polymarket + Kalshi liquidity directly on Solana — no bridging
  prediction_search: async (input) => {
    try {
      let events = [];

      if (input.query) {
        // QUERY PATH: /events/search finds matching event IDs across the FULL
        // catalog (not just top trending), then we fetch each event by ID with
        // markets included via /events/{eventId}.
        const searchParams = new URLSearchParams({ query: input.query, limit: "12" });
        const searchRes = await fetch(`https://api.jup.ag/prediction/v1/events/search?${searchParams}`);
        const searchData = await searchRes.json();
        const matchingIds = (searchData.data || []).slice(0, 10).map(e => e.eventId).filter(Boolean);

        // Fetch each in parallel — /events/{id} returns markets unlike /events/search
        const eventResponses = await Promise.all(
          matchingIds.map(id =>
            fetch(`https://api.jup.ag/prediction/v1/events/${id}`)
              .then(r => r.ok ? r.json() : null)
              .catch(() => null)
          )
        );
        events = eventResponses.filter(Boolean);
      } else {
        // BROWSE PATH: trending list with markets included
        const params = new URLSearchParams({
          filter: "trending",
          includeMarkets: "true",
          end: "30"
        });
        if (input.category) params.set("category", input.category);
        const res = await fetch(`https://api.jup.ag/prediction/v1/events?${params}`);
        const data = await res.json();
        events = data.data || data.events || [];
      }

      // Drop events with no open markets (closed sub-markets etc.)
      events = events.filter(ev => Array.isArray(ev.markets) && ev.markets.some(m => m.status === "open"));

      if (events.length === 0) {
        return {
          message: `No bettable markets found${input.query ? ' for "' + input.query + '"' : ""}. Try different keywords.`
        };
      }

      return {
        events: events.slice(0, 8).map(ev => {
          const m = ev.metadata || {};
          // Pick the first OPEN market for each event
          const openMarkets = (ev.markets || []).filter(mk => mk.status === "open");
          // For events with multiple sub-markets (like "what price will BTC hit"),
          // include all of them so the user can pick
          const eventTitle = m.title || "Untitled";
          const subMarkets = openMarkets.slice(0, 8).map(mk => ({
            market_id: mk.marketId,
            title: mk.title,
            event: eventTitle,  // so the agent knows which event this market belongs to
            yes_price: mk.pricing?.buyYesPriceUsd ? "$" + (mk.pricing.buyYesPriceUsd / 1_000_000).toFixed(2) : null,
            no_price: mk.pricing?.buyNoPriceUsd ? "$" + (mk.pricing.buyNoPriceUsd / 1_000_000).toFixed(2) : null
          }));

          return {
            event_id: ev.eventId,
            title: eventTitle,
            category: ev.category,
            volume_usd: ev.volumeUsd ? "$" + Math.round(parseFloat(ev.volumeUsd) / 1_000_000).toLocaleString() : null,
            markets: subMarkets,
            close_time: m.closeTime,
            image_url: m.imageUrl,
            note: `Use the market_id (e.g. ${subMarkets[0]?.market_id}) from the markets array when calling prediction_bet.`
          };
        }),
        source: "jupiter_predict"
      };
    } catch (e) {
      return { error: `Couldn't load prediction markets: ${e.message}` };
    }
  },

  // Place a real bet on a prediction market via Jupiter (Solana-native, no bridging)
  prediction_bet: async (input, walletAddress, keypair) => {
    if (!walletAddress) return { error: "Please sign in to place bets." };
    if (!keypair) return { error: "Account not ready. Please sign out and back in." };

    const solCheck = await checkSolBalance(walletAddress);
    if (solCheck) return solCheck;

    try {
      let marketId = input.market_id;

      // If no market_id but we have a query, find the right market automatically
      if (!marketId && input.query) {
        const searchRes = await fetch(`https://api.jup.ag/prediction/v1/events/search?query=${encodeURIComponent(input.query)}&limit=5`);
        const searchData = await searchRes.json();
        const eventIds = (searchData.data || []).map(e => e.eventId).filter(Boolean);

        // Fetch events with markets
        const events = (await Promise.all(
          eventIds.slice(0, 5).map(id =>
            fetch(`https://api.jup.ag/prediction/v1/events/${id}`)
              .then(r => r.ok ? r.json() : null).catch(() => null)
          )
        )).filter(Boolean);

        // Find the right sub-market by matching sub_market name
        const subQuery = (input.sub_market || "").toLowerCase();
        for (const ev of events) {
          const openMarkets = (ev.markets || []).filter(m => m.status === "open");
          if (subQuery) {
            const match = openMarkets.find(m =>
              m.title?.toLowerCase().includes(subQuery)
            );
            if (match) {
              marketId = match.marketId;
              console.log(`  [BET] Auto-resolved: "${input.query}" + "${input.sub_market}" -> ${marketId} (${match.title})`);
              break;
            }
          } else if (openMarkets.length === 1) {
            // Single market event (e.g., "Will X happen?")
            marketId = openMarkets[0].marketId;
            break;
          }
        }

        if (!marketId) {
          return {
            error: `Couldn't find a market matching "${input.query}"${subQuery ? ` + "${input.sub_market}"` : ""}. Try prediction_search first to see available markets.`
          };
        }
      }

      if (!marketId) {
        return { error: "Need either a market_id or a query + sub_market to place a bet." };
      }

      // 1. Get market details to validate and get pricing
      const marketRes = await fetch(`https://api.jup.ag/prediction/v1/markets/${marketId}`);
      const market = await marketRes.json();
      if (market.error || !market.marketId) {
        return { error: `Market ${marketId} not found.` };
      }
      if (market.status && market.status !== "open") {
        return { error: `Market is ${market.status}, can't bet right now.` };
      }

      const isYes = input.outcome?.toLowerCase() === "yes" ||
                    input.outcome?.toLowerCase() === "y" ||
                    input.outcome === true;

      // 2. Build the order request — Jupiter returns a base64 Solana tx
      const usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
      // Jupiter requires >$1 minimum — use $1.50 floor to account for fees/rounding
      const betAmount = Math.max(input.amount_usdc || 0, 1.5);
      const depositAmount = String(Math.round(betAmount * 1_000_000));
      console.log(`  [BET] Placing: $${betAmount} (${depositAmount} native) on ${isYes ? "YES" : "NO"} for ${marketId}`);

      const orderRes = await fetch("https://api.jup.ag/prediction/v1/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerPubkey: walletAddress,
          marketId: marketId,
          isYes,
          isBuy: true,
          depositAmount,
          depositMint: usdcMint
        })
      });

      const orderData = await orderRes.json();

      // Detect Jupiter's region restriction (US and South Korea blocked)
      if (orderData.code === "unsupported_region" || orderData.message?.includes("not available in your region")) {
        // Try to find the Polymarket slug for a deep link
        let polyUrl = "https://polymarket.com";
        try {
          const marketInfoRes = await fetch(`https://api.jup.ag/prediction/v1/markets/${marketId}`);
          const marketInfo = await marketInfoRes.json();
          // Search for the parent event
          if (marketInfo.eventId) {
            const eventRes = await fetch(`https://api.jup.ag/prediction/v1/events/${marketInfo.eventId}`);
            const event = await eventRes.json();
            if (event.metadata?.slug) {
              polyUrl = `https://polymarket.com/event/${event.metadata.slug}`;
            }
          }
        } catch (e) {}

        return {
          error: `Jupiter blocks bet placement from US/Korea IPs (regulatory restriction). The market exists and you can bet on it directly at Polymarket. Open: ${polyUrl}`,
          region_blocked: true,
          polymarket_url: polyUrl
        };
      }

      if (orderData.error || orderData.code) {
        const msg = orderData.message || (typeof orderData.error === "string" ? orderData.error : JSON.stringify(orderData));
        console.log(`  [BET] Order rejected: ${msg} (deposit: ${depositAmount})`);
        return { error: msg };
      }
      const txB64 = orderData.transaction || orderData.tx || orderData.serializedTransaction;
      if (!txB64) {
        console.log("  [BET] No transaction in response:", JSON.stringify(orderData).slice(0, 500));
        return { error: orderData.message || "Couldn't build the bet order. Try $1 or more." };
      }

      // 3. Sign and submit
      const txBuf = Buffer.from(txB64, "base64");
      const tx = VersionedTransaction.deserialize(txBuf);
      tx.sign([keypair]);

      const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
      await connection.confirmTransaction(signature, "processed");

      console.log(`  [BET] $${betAmount} on ${isYes ? "YES" : "NO"} ${marketId} | tx: ${signature}`);

      // 4. Format the receipt with potential payout
      const myPriceRaw = isYes ? market.pricing?.buyYesPriceUsd : market.pricing?.buyNoPriceUsd;
      const myPrice = myPriceRaw ? myPriceRaw / 1_000_000 : null;
      const contracts = myPrice && myPrice > 0 ? betAmount / myPrice : null;
      const potentialPayout = contracts ? contracts.toFixed(2) : null;

      return {
        ui_type: "trade_receipt",
        status: "completed",
        side: "buy",
        symbol: `${isYes ? "YES" : "NO"} bet`,
        amount_usd: betAmount,
        bet_price: myPrice ? `$${myPrice.toFixed(2)}` : null,
        contracts: contracts ? parseFloat(contracts.toFixed(2)) : null,
        potential_payout: potentialPayout ? `$${potentialPayout}` : null,
        signature,
        explorer: `https://solscan.io/tx/${signature}`,
        message: `Bet $${betAmount.toFixed(2)} on ${isYes ? "YES" : "NO"} at $${myPrice?.toFixed(2) || "?"} per contract.${potentialPayout ? ` ${parseFloat(potentialPayout).toFixed(1)} contracts = $${potentialPayout} payout if it wins.` : ""}`,
        order_pubkey: orderData.orderPubkey || orderData.order_pubkey
      };
    } catch (e) {
      if (e.message?.includes("insufficient") || e.message?.includes("0x1")) {
        return { error: `Not enough USDC for this bet.` };
      }
      console.error("  [BET] Error:", e.message);
      return { error: `Bet failed: ${e.message}` };
    }
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
      // 1. Search Bitrefill for ANY matching product (gift card, subscription,
      //    mobile top-up, e-wallet, gaming credit, etc.)
      const country = (input.country || "US").toUpperCase();
      const search = await bitrefill.searchProducts({
        query: input.merchant,
        country
        // No productType filter — covers giftcards, mobile top-ups, e-wallets, eSIMs, etc.
      });

      const product = bitrefill.pickBestProduct(search, input.merchant);
      if (!product) {
        return { error: `Couldn't find "${input.merchant}" on Bitrefill. It may not be supported in ${country}, or the name might need to be different.` };
      }

      // 2. Get product details to find the right package
      const productSlug = product.slug || product._id || product.id || product.product_id;
      const details = await bitrefill.getProductDetails({
        productId: productSlug,
        currency: "USD"
      });

      // Check if this product needs a recipient (phone number, account ID)
      const recipientType = details.recipient_type || "none";

      const pkg = bitrefill.pickBestPackage(details, input.amount_usd);
      if (!pkg) {
        return { error: `${product.name} doesn't have available packages right now.` };
      }

      // Build the cart item — package_id is the parsed value (number for numeric, string for named)
      const cartItem = {
        product_id: productSlug,
        package_id: pkg.package_id
      };

      // For products that need a recipient, check if user provided one
      if (recipientType !== "none") {
        if (!input.recipient_number) {
          return {
            error: `${product.name} needs a ${recipientType === "phone" ? "phone number" : "account ID"} to deliver to. Ask the user for it and call buy_product again with recipient_number set.`,
            needs_recipient: true,
            recipient_type: recipientType
          };
        }
        cartItem.number = input.recipient_number;
      }

      // 3. Buy with USDC on Solana
      const buyResult = await bitrefill.buyProducts({
        cartItems: [cartItem],
        paymentMethod: "usdc_solana",
        returnPaymentLink: false
      });

      if (buyResult.error) {
        return { error: buyResult.error };
      }

      // 4. Pay the invoice with USDC from user's wallet
      // Bitrefill CLI wraps the actual response in a 'response' field
      const invoice = buyResult.response || buyResult;
      const paymentInfo = invoice.payment_info || invoice;
      const paymentAddress = paymentInfo.address || paymentInfo.payTo;
      const paymentAmount = parseFloat(
        paymentInfo.altcoinPrice ||
        paymentInfo.amount ||
        paymentInfo.expected_amount ||
        pkg.payment_price_usd ||
        0
      );
      const invoiceId = invoice.invoice_id || invoice.id;

      if (!paymentAddress || !paymentAmount) {
        console.log("  [SHOP] Bad invoice response:", JSON.stringify(buyResult).slice(0, 500));
        return { error: `Couldn't get payment details from Bitrefill. Address: ${paymentAddress}, amount: ${paymentAmount}` };
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
      await connection.confirmTransaction(signature, "processed");

      // 5. Poll Bitrefill for the redemption code
      let redemptionCode = null;
      let redemptionLink = null;
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000));
        try {
          const inv = await bitrefill.getInvoice({ invoiceId, includeRedemption: true });
          const data = inv.response || inv;
          const orders = data.orders || [];
          for (const o of orders) {
            const ri = o.redemption_info || o.redemptionInfo || o;
            if (ri.code || ri.link || ri.url || ri.pin) {
              redemptionCode = ri.code || ri.pin || null;
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
