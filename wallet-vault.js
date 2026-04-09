// SANO Wallet Vault — encrypted server-side storage for wallet secrets
// Wallets are stored encrypted with AES-256-GCM. Master key from env.
// One file per user keeps things isolated and easy to back up.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Keypair } = require("@solana/web3.js");
const bs58 = require("bs58").default || require("bs58");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const VAULT_DIR = path.join(DATA_DIR, "wallets");

// Master key handling:
// 1. If WALLET_MASTER_KEY env var is set, use it (production)
// 2. Otherwise, look for a persisted master.key file in the data dir
// 3. Otherwise, generate a new one and persist it
// This means master key survives restarts but you can also override via env.
let cachedMasterKey = null;

function getMasterKey() {
  if (cachedMasterKey) return cachedMasterKey;

  if (process.env.WALLET_MASTER_KEY) {
    const buf = Buffer.from(process.env.WALLET_MASTER_KEY, "base64");
    if (buf.length !== 32) {
      throw new Error("WALLET_MASTER_KEY must be 32 bytes base64. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"");
    }
    cachedMasterKey = buf;
    return buf;
  }

  // Persist a key in the data directory
  const dataDir = process.env.DATA_DIR || path.join(__dirname, "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const keyFile = path.join(dataDir, "master.key");

  if (fs.existsSync(keyFile)) {
    const buf = Buffer.from(fs.readFileSync(keyFile, "utf-8").trim(), "base64");
    if (buf.length === 32) {
      cachedMasterKey = buf;
      return buf;
    }
  }

  // Generate and save a new one
  const newKey = crypto.randomBytes(32);
  fs.writeFileSync(keyFile, newKey.toString("base64"));
  fs.chmodSync(keyFile, 0o600);
  console.warn("\n  [VAULT] Generated new master key at " + keyFile);
  console.warn("  [VAULT] BACK THIS UP. If lost, all wallets become unrecoverable.\n");
  cachedMasterKey = newKey;
  return newKey;
}

function ensureVault() {
  if (!fs.existsSync(VAULT_DIR)) fs.mkdirSync(VAULT_DIR, { recursive: true });
}

// Atomic write: write to .tmp then rename (POSIX guarantees rename is atomic)
function atomicWrite(filePath, content) {
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, filePath);
}

function emailToFilename(email) {
  return email.toLowerCase().replace(/[^a-z0-9@.]/g, "_") + ".vault";
}

// ─── Encryption ───

function encrypt(plaintext) {
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: encrypted.toString("base64")
  };
}

function decrypt(payload) {
  const key = getMasterKey();
  const iv = Buffer.from(payload.iv, "base64");
  const tag = Buffer.from(payload.tag, "base64");
  const data = Buffer.from(payload.data, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

// ─── Public API ───

// Create a brand-new wallet for a user. Returns the public key.
// The secret is encrypted and stored. Caller can also access it once via the second return.
function createWallet(email) {
  ensureVault();
  const keypair = Keypair.generate();
  const publicKey = keypair.publicKey.toBase58();
  const secretKey = bs58.encode(keypair.secretKey);

  const payload = {
    public_key: publicKey,
    secret: encrypt(secretKey),
    created: new Date().toISOString(),
    email: email.toLowerCase()
  };

  atomicWrite(path.join(VAULT_DIR, emailToFilename(email)), JSON.stringify(payload, null, 2));
  return { publicKey, secretKey };
}

// Get the wallet public key for a user (no decryption needed)
function getPublicKey(email) {
  ensureVault();
  const file = path.join(VAULT_DIR, emailToFilename(email));
  if (!fs.existsSync(file)) return null;
  try {
    const payload = JSON.parse(fs.readFileSync(file, "utf-8"));
    return payload.public_key;
  } catch (e) {
    return null;
  }
}

// Get the keypair for signing (decrypts on demand)
function getKeypair(email) {
  ensureVault();
  const file = path.join(VAULT_DIR, emailToFilename(email));
  if (!fs.existsSync(file)) return null;
  try {
    const payload = JSON.parse(fs.readFileSync(file, "utf-8"));
    const secretKey = decrypt(payload.secret);
    return Keypair.fromSecretKey(bs58.decode(secretKey));
  } catch (e) {
    console.error("[VAULT] Failed to decrypt wallet for", email, ":", e.message);
    return null;
  }
}

// Get raw secret key (for export/backup display only)
function exportSecret(email) {
  ensureVault();
  const file = path.join(VAULT_DIR, emailToFilename(email));
  if (!fs.existsSync(file)) return null;
  try {
    const payload = JSON.parse(fs.readFileSync(file, "utf-8"));
    return {
      public_key: payload.public_key,
      secret_key: decrypt(payload.secret),
      created: payload.created
    };
  } catch (e) {
    return null;
  }
}

// Check if a user has a wallet
function hasWallet(email) {
  ensureVault();
  return fs.existsSync(path.join(VAULT_DIR, emailToFilename(email)));
}

// Import a wallet (e.g. after recovery from external source)
function importWallet(email, secretKey) {
  ensureVault();
  const keypair = Keypair.fromSecretKey(bs58.decode(secretKey));
  const payload = {
    public_key: keypair.publicKey.toBase58(),
    secret: encrypt(secretKey),
    created: new Date().toISOString(),
    email: email.toLowerCase(),
    imported: true
  };
  atomicWrite(path.join(VAULT_DIR, emailToFilename(email)), JSON.stringify(payload, null, 2));
  return keypair.publicKey.toBase58();
}

module.exports = {
  createWallet,
  getPublicKey,
  getKeypair,
  exportSecret,
  hasWallet,
  importWallet,
  _getMasterKey: getMasterKey  // exported for credentials-vault to share
};
