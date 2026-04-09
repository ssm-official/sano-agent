// SANO Sandbox Manager — per-user E2B DESKTOP sandboxes
// ONLY for desktop/browser/computer-use. Wallets are stored in wallet-vault.js,
// not in the sandbox. Sandboxes are disposable — losing one is no big deal.

const { Sandbox } = require("@e2b/desktop");

// Cache live sandboxes (don't reconnect on every call)
const liveSandboxes = new Map(); // sandboxId -> { sbx, lastUsed }
const SANDBOX_IDLE_MS = 60 * 1000;

// ─── Lifecycle ───

// Create a fresh desktop sandbox. Returns the sandbox ID.
// Lightweight — no wallet, no setup. Just a desktop ready to use.
async function createSandbox() {
  if (!process.env.E2B_API_KEY) {
    throw new Error("E2B_API_KEY not set");
  }
  console.log(`  [SBX] Creating desktop sandbox...`);
  const sbx = await Sandbox.create({
    timeoutMs: 60 * 60 * 1000,  // 1 hour max running time
    resolution: [1280, 800],
    dpi: 96
  });
  const sandboxId = sbx.sandboxId;

  // Cache the live connection so the next call doesn't reconnect
  liveSandboxes.set(sandboxId, { sbx, lastUsed: Date.now() });

  // Pause immediately so it persists across server restarts
  try {
    await sbx.pause();
    liveSandboxes.delete(sandboxId);
    console.log(`  [SBX] Created and paused ${sandboxId}`);
  } catch (e) {
    console.log(`  [SBX] Pause warning:`, e.message);
  }

  return sandboxId;
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

// ─── Computer Use: Desktop control ───

async function takeScreenshot(sandboxId) {
  const sbx = await getSandbox(sandboxId);
  const bytes = await sbx.screenshot();
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
  createSandbox, getSandbox, isSandboxAlive,
  takeScreenshot, leftClick, rightClick, doubleClick, moveMouse,
  typeText, pressKey, scroll, launchApp, openUrl, getStreamUrl
};
