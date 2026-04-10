// SANO Orders Engine — limit orders, stop loss, take profit, price alerts
// Persists to data/orders.json. Polls Jupiter prices every 30s and fires triggers.

const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");

const DATA_DIR = path.join(__dirname, "data");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, "[]");

function load() {
  try { return JSON.parse(fs.readFileSync(ORDERS_FILE, "utf-8")); }
  catch { return []; }
}
function save(orders) {
  const tmp = ORDERS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(orders, null, 2));
  fs.renameSync(tmp, ORDERS_FILE);
}

function newId() {
  return "ord_" + Math.random().toString(36).slice(2, 10);
}

// kind: "limit_buy" | "limit_sell" | "stop_loss" | "take_profit" | "alert"
// trigger: { direction: "above"|"below", price: number }
function addOrder({ email, walletAddress, kind, symbol, mint, amount_usd, trigger, note }) {
  const orders = load();
  const order = {
    id: newId(),
    email,
    walletAddress,
    kind,
    symbol: symbol?.toUpperCase(),
    mint: mint || null,
    amount_usd: amount_usd || null,
    trigger,
    note: note || null,
    status: "active",
    createdAt: Date.now(),
    triggeredAt: null,
    result: null
  };
  orders.push(order);
  save(orders);
  return order;
}

function listOrders(email) {
  return load().filter(o => o.email === email && o.status === "active");
}

function listAllOrders(email) {
  return load().filter(o => o.email === email).sort((a, b) => b.createdAt - a.createdAt);
}

function cancelOrder(email, id) {
  const orders = load();
  const idx = orders.findIndex(o => o.email === email && o.id === id);
  if (idx === -1) return null;
  if (orders[idx].status !== "active") return orders[idx];
  orders[idx].status = "cancelled";
  save(orders);
  return orders[idx];
}

function describeOrder(o) {
  const dir = o.trigger?.direction === "above" ? ">=" : "<=";
  const px = o.trigger?.price ? "$" + o.trigger.price : "?";
  switch (o.kind) {
    case "limit_buy":   return `Buy $${o.amount_usd} when ${o.symbol} ${dir} ${px}`;
    case "limit_sell":  return `Sell $${o.amount_usd} when ${o.symbol} ${dir} ${px}`;
    case "stop_loss":   return `Stop loss: sell ${o.symbol} if price <= ${px}`;
    case "take_profit": return `Take profit: sell ${o.symbol} if price >= ${px}`;
    case "alert":       return `Alert when ${o.symbol} ${dir} ${px}`;
    default:            return `${o.kind} ${o.symbol}`;
  }
}

// Fetch a price from Jupiter (works for crypto + xStocks)
async function fetchPrice(mint) {
  try {
    const res = await fetch(`https://lite-api.jup.ag/price/v3?ids=${mint}`);
    if (!res.ok) return null;
    const data = await res.json();
    return parseFloat(data[mint]?.usdPrice || 0) || null;
  } catch { return null; }
}

// Triggered? Compare price to trigger.
function isTriggered(price, trigger) {
  if (!price || !trigger) return false;
  if (trigger.direction === "above") return price >= trigger.price;
  if (trigger.direction === "below") return price <= trigger.price;
  return false;
}

// Execute a triggered order. Lazy-requires tool-executor + wallet-vault to dodge cycles.
async function executeOrder(order) {
  const walletVault = require("./wallet-vault");
  const { executeTool } = require("./tool-executor");

  if (order.kind === "alert") {
    return { kind: "alert", message: `${order.symbol} hit ${order.trigger.direction} $${order.trigger.price}.` };
  }

  let keypair;
  try { keypair = walletVault.getKeypair(order.email); }
  catch (e) { return { error: `No keypair: ${e.message}` }; }
  if (!keypair) return { error: "No keypair available" };

  const side = (order.kind === "limit_buy") ? "buy" : "sell";
  const result = await executeTool(
    "stock_trade",
    { symbol: order.symbol, side, amount_usd: order.amount_usd },
    order.walletAddress,
    keypair,
    { userEmail: order.email }
  );
  return result;
}

// Poll all active orders. Group by mint to minimize API calls.
async function pollOnce() {
  const orders = load();
  const active = orders.filter(o => o.status === "active" && o.mint);
  if (active.length === 0) return { checked: 0, fired: 0 };

  // Unique mints
  const mints = [...new Set(active.map(o => o.mint))];
  const prices = {};
  // Batch up to 10 mints per request
  for (let i = 0; i < mints.length; i += 10) {
    const batch = mints.slice(i, i + 10);
    try {
      const res = await fetch(`https://lite-api.jup.ag/price/v3?ids=${batch.join(",")}`);
      if (res.ok) {
        const data = await res.json();
        for (const m of batch) {
          if (data[m]?.usdPrice) prices[m] = parseFloat(data[m].usdPrice);
        }
      }
    } catch {}
  }

  let fired = 0;
  for (const o of active) {
    const price = prices[o.mint];
    if (!isTriggered(price, o.trigger)) continue;

    console.log(`[ORDERS] Triggered ${o.id} (${o.kind} ${o.symbol} @ $${price})`);
    let result;
    try { result = await executeOrder(o); }
    catch (e) { result = { error: e.message }; }

    // Reload + update (orders may have changed during await)
    const fresh = load();
    const idx = fresh.findIndex(x => x.id === o.id);
    if (idx !== -1 && fresh[idx].status === "active") {
      fresh[idx].status = result?.error ? "failed" : "filled";
      fresh[idx].triggeredAt = Date.now();
      fresh[idx].triggerPrice = price;
      fresh[idx].result = result;
      save(fresh);
      fired++;
    }
  }
  return { checked: active.length, fired };
}

let pollerStarted = false;
function startPoller(intervalMs = 30000) {
  if (pollerStarted) return;
  pollerStarted = true;
  console.log(`[ORDERS] Poller started (every ${intervalMs / 1000}s)`);
  setInterval(() => {
    pollOnce().catch(e => console.error("[ORDERS] Poll error:", e.message));
  }, intervalMs);
}

module.exports = {
  addOrder,
  listOrders,
  listAllOrders,
  cancelOrder,
  describeOrder,
  fetchPrice,
  pollOnce,
  startPoller
};
