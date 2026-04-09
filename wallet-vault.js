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

// Master key derived from env. In production, set WALLET_MASTER_KEY explicitly
// (32 bytes, base64-encoded). For dev, derive from ANTHROPIC_API_KEY.
function getMasterKey() {
  if (process.env.WALLET_MASTER_KEY) {
    const buf = Buffer.from(process.env.WALLET_MASTER_KEY, "base64");
    if (buf.length !== 32) throw new Error("WALLET_MASTER_KEY must be 32 bytes base64");
    return buf;
  }
  // Dev fallback: derive from a stable secret
  const seed = process.env.ANTHROPIC_API_KEY || "sano-dev-fallback";
  return crypto.createHash("sha256").update(seed).digest();
}

function ensureVault() {
  if (!fs.existsSync(VAULT_DIR)) fs.mkdirSync(VAULT_DIR, { recursive: true });
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

  fs.writeFileSync(path.join(VAULT_DIR, emailToFilename(email)), JSON.stringify(payload, null, 2));
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
  fs.writeFileSync(path.join(VAULT_DIR, emailToFilename(email)), JSON.stringify(payload, null, 2));
  return keypair.publicKey.toBase58();
}

module.exports = {
  createWallet,
  getPublicKey,
  getKeypair,
  exportSecret,
  hasWallet,
  importWallet
};
