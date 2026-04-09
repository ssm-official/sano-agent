// SANO Bitrefill Client — wraps the official @bitrefill/cli
// Each call shells out to the CLI with --json for machine-readable output

const { spawn } = require("child_process");
const path = require("path");

const BITREFILL_BIN = path.join(__dirname, "node_modules", ".bin",
  process.platform === "win32" ? "bitrefill.cmd" : "bitrefill");

function runCli(args, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.BITREFILL_API_KEY;
    if (!apiKey) {
      return reject(new Error("BITREFILL_API_KEY not set"));
    }

    // CLI v0.2.0-beta supports --json for machine-readable output.
    // --api-key bypasses browser OAuth. Globals before the subcommand.
    const proc = spawn(BITREFILL_BIN, ["--api-key", apiKey, "--json", ...args], {
      env: { ...process.env, BITREFILL_API_KEY: apiKey, CI: "true" },
      shell: false
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", d => stdout += d.toString());
    proc.stderr.on("data", d => stderr += d.toString());

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("Bitrefill CLI timeout"));
    }, timeoutMs);

    proc.on("close", code => {
      clearTimeout(timer);
      if (code !== 0) {
        const errMsg = (stderr || stdout).trim() || `bitrefill exited with code ${code}`;
        try {
          const errJson = JSON.parse(stderr);
          return reject(new Error(errJson.error || errJson.message || errMsg));
        } catch {
          return reject(new Error(errMsg));
        }
      }
      // Output is pretty-printed JSON. Strip any non-JSON prelude (auth messages etc.)
      let trimmed = stdout.trim();
      // Find the first { or [ — that's where JSON starts
      const jsonStart = trimmed.search(/[\[\{]/);
      if (jsonStart > 0) trimmed = trimmed.slice(jsonStart);
      try {
        resolve(JSON.parse(trimmed));
      } catch (e) {
        resolve({ raw: stdout });
      }
    });

    proc.on("error", err => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ─── High-level wrappers ───

async function searchProducts({ query, country = "US", productType, category, perPage = 15 }) {
  const args = ["search-products", "--query", query, "--country", country, "--per_page", String(perPage)];
  // Only filter by product_type if explicitly given. Bitrefill carries
  // gift cards, mobile top-ups, e-wallets (GoPay, OVO, Dana), eSIMs, and more.
  // Filtering would exclude valid matches.
  if (productType) args.push("--product_type", productType);
  if (category) args.push("--category", category);
  return await runCli(args);
}

async function getProductDetails({ productId, currency = "USDC" }) {
  return await runCli(["get-product-details", "--product_id", productId, "--currency", currency]);
}

async function buyProducts({ cartItems, paymentMethod = "usdc_solana", returnPaymentLink = false }) {
  const args = [
    "buy-products",
    "--cart_items", JSON.stringify(cartItems),
    "--payment_method", paymentMethod,
    "--return_payment_link", String(returnPaymentLink)
  ];
  return await runCli(args);
}

async function getInvoice({ invoiceId, includeRedemption = true, includeOrders = true }) {
  return await runCli([
    "get-invoice-by-id",
    "--invoice_id", invoiceId,
    "--include_redemption_info", String(includeRedemption),
    "--include_orders", String(includeOrders)
  ]);
}

async function getOrder({ orderId, includeRedemption = true }) {
  return await runCli([
    "get-order-by-id",
    "--order_id", orderId,
    "--include_redemption_info", String(includeRedemption)
  ]);
}

async function listOrders({ limit = 10, includeRedemption = true }) {
  return await runCli([
    "list-orders",
    "--limit", String(limit),
    "--include_redemption_info", String(includeRedemption)
  ]);
}

// ─── Helper: pick the best matching product from search results ───
function pickBestProduct(searchResult, merchantQuery) {
  const products = searchResult.products || searchResult.results || [];
  if (products.length === 0) return null;

  const ml = merchantQuery.toLowerCase();
  // Prefer exact name match
  let best = products.find(p => p.name?.toLowerCase() === ml);
  // Then fuzzy match
  if (!best) best = products.find(p => p.name?.toLowerCase().includes(ml));
  // Otherwise first result
  if (!best) best = products[0];
  return best;
}

// ─── Helper: pick the best package for a given USD amount ───
// Returns: { package_id, payment_price_usd, package_value, package_currency, raw }
function pickBestPackage(productDetails, amountUsd) {
  const packages = productDetails.packages || [];
  if (packages.length === 0) return null;

  // Normalize each package — package_value can be a string number ("50000")
  // or a duration/name string ("1 Month"). payment_price is the USD cost.
  const normalized = packages.map(p => {
    const numericValue = parseFloat(p.package_value);
    const isNumeric = !isNaN(numericValue) && String(numericValue) === String(p.package_value).trim();
    return {
      package_id: isNumeric ? numericValue : p.package_value,  // number for numeric, string for named/duration
      payment_price_usd: parseFloat(p.payment_price || "0"),
      package_value: p.package_value,
      package_currency: p.package_currency,
      raw: p,
      is_numeric: isNumeric
    };
  });

  // Sort by USD price ascending
  normalized.sort((a, b) => a.payment_price_usd - b.payment_price_usd);

  // Find closest match to requested amount in USD
  // Prefer the smallest package that's >= amountUsd (so user gets at least what they asked for)
  // If everything is below, return the largest
  // If everything is above, return the smallest
  const atOrAbove = normalized.filter(p => p.payment_price_usd >= amountUsd);
  if (atOrAbove.length > 0) {
    // Smallest one that meets or exceeds the request
    return atOrAbove[0];
  }
  // Otherwise largest available
  return normalized[normalized.length - 1];
}

module.exports = {
  searchProducts,
  getProductDetails,
  buyProducts,
  getInvoice,
  getOrder,
  listOrders,
  pickBestProduct,
  pickBestPackage,
  runCli
};
