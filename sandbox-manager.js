// SANO Sandbox Manager — per-user E2B isolated environments
// Each user gets their own sandbox with their own filesystem and state.
// Server is just an orchestrator. Nothing is shared between users.

const { Sandbox } = require("e2b");
const { Keypair } = require("@solana/web3.js");
const bs58 = require("bs58").default || require("bs58");

// In-flight sandbox connections (cached so we don't reconnect on every call)
const liveSandboxes = new Map(); // sandboxId -> { sbx, lastUsed }
const SANDBOX_IDLE_MS = 30 * 1000; // pause after 30s of inactivity

// File paths inside each user's sandbox
const PATHS = {
  wallet: "/home/user/wallet.json",
  memory: "/home/user/memory.md",
  state: "/home/user/state.json"
};

// ─── Lifecycle ───

// Create a brand new sandbox for a new user, generate their wallet inside it
async function createUserSandbox(email) {
  if (!process.env.E2B_API_KEY) {
    throw new Error("E2B_API_KEY not set");
  }

  console.log(`  [SBX] Creating sandbox for ${email}...`);
  const sbx = await Sandbox.create({
    timeoutMs: 5 * 60 * 1000 // 5 minutes max running time
  });
  const sandboxId = sbx.sandboxId;
  console.log(`  [SBX] Created ${sandboxId} for ${email}`);

  // Generate the user's wallet INSIDE the sandbox
  // We do it server-side then write to the sandbox so we don't have to install
  // Solana SDK in the sandbox (faster, smaller)
  const keypair = Keypair.generate();
  const walletData = {
    public_key: keypair.publicKey.toBase58(),
    secret_key: bs58.encode(keypair.secretKey),
    created: new Date().toISOString()
  };

  // Write the wallet file into the sandbox
  await sbx.files.write(PATHS.wallet, JSON.stringify(walletData, null, 2));

  // Initialize empty memory and state
  const initialMemory = `# Memory for ${email}

## Profile
- email: ${email}
- account created: ${new Date().toISOString()}

## Notes
`;
  await sbx.files.write(PATHS.memory, initialMemory);
  await sbx.files.write(PATHS.state, JSON.stringify({ created: new Date().toISOString() }));

  // Pause the sandbox to save resources
  await sbx.pause();
  console.log(`  [SBX] Initialized and paused ${sandboxId}`);

  return {
    sandboxId,
    wallet: walletData.public_key
  };
}

// Resume an existing user's sandbox (or noop if it's already cached)
async function getSandbox(sandboxId) {
  // Check cache first
  const cached = liveSandboxes.get(sandboxId);
  if (cached) {
    cached.lastUsed = Date.now();
    return cached.sbx;
  }

  // Reconnect (auto-resumes if paused)
  const sbx = await Sandbox.connect(sandboxId);
  liveSandboxes.set(sandboxId, { sbx, lastUsed: Date.now() });
  return sbx;
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
  if (!memory) {
    memory = `## ${section}\n`;
  }
  if (!memory.includes(`## ${section}`)) {
    memory += `\n\n## ${section}\n`;
  }
  // Insert under the section header
  const lines = memory.split("\n");
  const idx = lines.findIndex(l => l.trim() === `## ${section}`);
  if (idx === -1) {
    memory += `\n- ${fact}`;
  } else {
    lines.splice(idx + 1, 0, `- ${fact}`);
    memory = lines.join("\n");
  }
  await writeMemory(sandboxId, memory);
  return memory;
}

async function removeFromMemory(sandboxId, query) {
  let memory = await readMemory(sandboxId);
  if (!memory) return memory;
  const lines = memory.split("\n");
  const filtered = lines.filter(l => !l.toLowerCase().includes(query.toLowerCase()));
  memory = filtered.join("\n");
  await writeMemory(sandboxId, memory);
  return memory;
}

// ─── Generic state ops ───

async function readState(sandboxId) {
  try {
    const sbx = await getSandbox(sandboxId);
    const raw = await sbx.files.read(PATHS.state);
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

async function writeState(sandboxId, obj) {
  const sbx = await getSandbox(sandboxId);
  await sbx.files.write(PATHS.state, JSON.stringify(obj, null, 2));
}

// ─── Cleanup ───
// Pause sandboxes that have been idle for a while
setInterval(async () => {
  const now = Date.now();
  for (const [id, entry] of liveSandboxes) {
    if (now - entry.lastUsed > SANDBOX_IDLE_MS) {
      try {
        await entry.sbx.pause();
        liveSandboxes.delete(id);
        console.log(`  [SBX] Paused idle sandbox ${id}`);
      } catch (e) {
        console.log(`  [SBX] Failed to pause ${id}:`, e.message);
      }
    }
  }
}, 30 * 1000);

module.exports = {
  createUserSandbox,
  getSandbox,
  getWallet,
  getKeypair,
  getWalletAddress,
  readMemory,
  writeMemory,
  appendToMemory,
  removeFromMemory,
  readState,
  writeState,
  PATHS
};
