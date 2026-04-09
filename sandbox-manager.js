// SANO Sandbox Manager — per-user E2B DESKTOP sandboxes
// Each user gets a real Linux desktop with browser, mouse, keyboard, screen.
// Server is just an orchestrator.

const { Sandbox } = require("@e2b/desktop");
const { Keypair } = require("@solana/web3.js");
const bs58 = require("bs58").default || require("bs58");

// Cache live sandboxes (don't reconnect on every call)
const liveSandboxes = new Map(); // sandboxId -> { sbx, lastUsed }
const SANDBOX_IDLE_MS = 60 * 1000; // pause after 60s of inactivity

// File paths inside each user's sandbox
const PATHS = {
  wallet: "/home/user/wallet.json",
  memory: "/home/user/memory.md",
  state: "/home/user/state.json"
};

// ─── Lifecycle ───

async function createUserSandbox(email) {
  if (!process.env.E2B_API_KEY) {
    throw new Error("E2B_API_KEY not set");
  }

  console.log(`  [SBX] Creating desktop sandbox for ${email}...`);
  // Use the maximum allowed timeout (1 hour) so sandbox stays alive longer
  const sbx = await Sandbox.create({
    timeoutMs: 60 * 60 * 1000,  // 1 hour max running time
    resolution: [1280, 800],
    dpi: 96
  });
  const sandboxId = sbx.sandboxId;
  console.log(`  [SBX] Created ${sandboxId} for ${email}`);

  // Generate the wallet keypair (fast, server-side)
  const keypair = Keypair.generate();
  const walletData = {
    public_key: keypair.publicKey.toBase58(),
    secret_key: bs58.encode(keypair.secretKey),
    created: new Date().toISOString()
  };

  await Promise.all([
    sbx.files.write(PATHS.wallet, JSON.stringify(walletData, null, 2)),
    sbx.files.write(PATHS.memory, `# Memory for ${email}\n\n## Profile\n- email: ${email}\n- account created: ${new Date().toISOString()}\n\n## Notes\n`),
    sbx.files.write(PATHS.state, JSON.stringify({ created: new Date().toISOString() }))
  ]);

  // Pause immediately so it persists across server restarts.
  // Paused sandboxes are kept indefinitely by E2B.
  try {
    await sbx.pause();
    console.log(`  [SBX] Paused ${sandboxId}`);
  } catch (e) {
    console.log(`  [SBX] Pause warning:`, e.message);
  }

  return {
    sandboxId,
    wallet: walletData.public_key
  };
}

// Resume an existing sandbox (or use cached connection)
async function getSandbox(sandboxId) {
  const cached = liveSandboxes.get(sandboxId);
  if (cached) {
    cached.lastUsed = Date.now();
    return cached.sbx;
  }
  const sbx = await Sandbox.connect(sandboxId);
  liveSandboxes.set(sandboxId, { sbx, lastUsed: Date.now() });
  return sbx;
}

// Check if a sandbox still exists and is reachable
async function isSandboxAlive(sandboxId) {
  if (!sandboxId) return false;
  try {
    const cached = liveSandboxes.get(sandboxId);
    if (cached) return true;
    // Try a quick reconnect
    const sbx = await Sandbox.connect(sandboxId);
    liveSandboxes.set(sandboxId, { sbx, lastUsed: Date.now() });
    return true;
  } catch (e) {
    return false;
  }
}

// ─── Wallet ops ───

async function getWallet(sandboxId) {
  const sbx = await getSandbox(sandboxId);
  const raw = await sbx.files.read(PATHS.wallet);
  return JSON.parse(raw);
}

async function getKeypair(sandboxId) {
  const wallet = await getWallet(sandboxId);
  return Keypair.fromSecretKey(bs58.decode(wallet.secret_key));
}

async function getWalletAddress(sandboxId) {
  const wallet = await getWallet(sandboxId);
  return wallet.public_key;
}

// ─── Memory ops ───

async function readMemory(sandboxId) {
  try {
    const sbx = await getSandbox(sandboxId);
    return await sbx.files.read(PATHS.memory);
  } catch (e) {
    return "";
  }
}

async function writeMemory(sandboxId, content) {
  const sbx = await getSandbox(sandboxId);
  await sbx.files.write(PATHS.memory, content);
}

async function appendToMemory(sandboxId, fact, section = "Notes") {
  let memory = await readMemory(sandboxId);
  if (!memory) memory = `## ${section}\n`;
  if (!memory.includes(`## ${section}`)) {
    memory += `\n\n## ${section}\n`;
  }
  const lines = memory.split("\n");
  const idx = lines.findIndex(l => l.trim() === `## ${section}`);
  if (idx === -1) memory += `\n- ${fact}`;
  else { lines.splice(idx + 1, 0, `- ${fact}`); memory = lines.join("\n"); }
  await writeMemory(sandboxId, memory);
  return memory;
}

async function removeFromMemory(sandboxId, query) {
  let memory = await readMemory(sandboxId);
  if (!memory) return memory;
  const lines = memory.split("\n");
  memory = lines.filter(l => !l.toLowerCase().includes(query.toLowerCase())).join("\n");
  await writeMemory(sandboxId, memory);
  return memory;
}

// ─── Generic state ops ───

async function readState(sandboxId) {
  try {
    const sbx = await getSandbox(sandboxId);
    return JSON.parse(await sbx.files.read(PATHS.state));
  } catch (e) { return {}; }
}

async function writeState(sandboxId, obj) {
  const sbx = await getSandbox(sandboxId);
  await sbx.files.write(PATHS.state, JSON.stringify(obj, null, 2));
}

// ─── Computer Use: Desktop control ───

async function takeScreenshot(sandboxId) {
  const sbx = await getSandbox(sandboxId);
  const bytes = await sbx.screenshot();
  // Return base64 PNG for sending to Claude
  return Buffer.from(bytes).toString("base64");
}

async function leftClick(sandboxId, x, y) {
  const sbx = await getSandbox(sandboxId);
  await sbx.leftClick(x, y);
}

async function rightClick(sandboxId, x, y) {
  const sbx = await getSandbox(sandboxId);
  await sbx.rightClick(x, y);
}

async function doubleClick(sandboxId, x, y) {
  const sbx = await getSandbox(sandboxId);
  await sbx.doubleClick(x, y);
}

async function moveMouse(sandboxId, x, y) {
  const sbx = await getSandbox(sandboxId);
  await sbx.moveMouse(x, y);
}

async function typeText(sandboxId, text) {
  const sbx = await getSandbox(sandboxId);
  await sbx.write(text);
}

async function pressKey(sandboxId, key) {
  const sbx = await getSandbox(sandboxId);
  await sbx.press(key);
}

async function scroll(sandboxId, direction = "down", amount = 3) {
  const sbx = await getSandbox(sandboxId);
  await sbx.scroll(direction, amount);
}

async function launchApp(sandboxId, appName, uri) {
  const sbx = await getSandbox(sandboxId);
  await sbx.launch(appName, uri);
}

// Open a URL in the default browser inside the sandbox
async function openUrl(sandboxId, url) {
  const sbx = await getSandbox(sandboxId);
  // Try launching firefox with the URL
  try {
    await sbx.launch("firefox", url);
  } catch (e) {
    // Fallback to xdg-open via command exec
    try {
      await sbx.commands.run(`xdg-open "${url}"`, { background: true });
    } catch (e2) {
      throw new Error("Couldn't open browser: " + e2.message);
    }
  }
  // Give it time to load
  await new Promise(r => setTimeout(r, 2000));
}

// Get the live stream URL so the user can watch their agent work
async function getStreamUrl(sandboxId) {
  const sbx = await getSandbox(sandboxId);
  try {
    const url = sbx.stream.getUrl({ viewOnly: true });
    return url;
  } catch (e) {
    return null;
  }
}

// ─── Cleanup ───
setInterval(async () => {
  const now = Date.now();
  for (const [id, entry] of liveSandboxes) {
    if (now - entry.lastUsed > SANDBOX_IDLE_MS) {
      try {
        await entry.sbx.pause();
        liveSandboxes.delete(id);
        console.log(`  [SBX] Paused idle sandbox ${id}`);
      } catch (e) {
        liveSandboxes.delete(id);
      }
    }
  }
}, 30 * 1000);

module.exports = {
  createUserSandbox, getSandbox, isSandboxAlive,
  getWallet, getKeypair, getWalletAddress,
  readMemory, writeMemory, appendToMemory, removeFromMemory,
  readState, writeState,
  takeScreenshot, leftClick, rightClick, doubleClick, moveMouse,
  typeText, pressKey, scroll, launchApp, openUrl, getStreamUrl,
  PATHS
};
