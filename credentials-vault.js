// SANO Credentials Vault — encrypted storage for site logins
// Stores per-user credentials encrypted with AES-256-GCM, same master key as wallet vault.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const CREDS_DIR = path.join(DATA_DIR, "credentials");

// Reuse the same master key as wallet-vault
const wallet_vault = require("./wallet-vault");
function getMasterKey() {
  return wallet_vault._getMasterKey();
}

function ensureDir() {
  if (!fs.existsSync(CREDS_DIR)) fs.mkdirSync(CREDS_DIR, { recursive: true });
}

function emailToFile(email) {
  return email.toLowerCase().replace(/[^a-z0-9@.]/g, "_") + ".creds";
}

function encrypt(text) {
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: enc.toString("base64") };
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

// Atomic write
function atomicWrite(filePath, content) {
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, filePath);
}

function load(email) {
  ensureDir();
  const file = path.join(CREDS_DIR, emailToFile(email));
  if (!fs.existsSync(file)) return [];
  try {
    const payload = JSON.parse(fs.readFileSync(file, "utf-8"));
    const decrypted = decrypt(payload);
    return JSON.parse(decrypted);
  } catch (e) {
    console.error("[CREDS] Decrypt failed for", email, ":", e.message);
    return [];
  }
}

function save(email, creds) {
  ensureDir();
  const file = path.join(CREDS_DIR, emailToFile(email));
  const payload = encrypt(JSON.stringify(creds));
  atomicWrite(file, JSON.stringify(payload, null, 2));
}

// ─── Public API ───

// Save or update a credential for a site
function set(email, site, username, password, notes = "") {
  const creds = load(email);
  // Normalize site (strip protocol, www)
  const normalized = normalizeSite(site);
  const idx = creds.findIndex(c => c.site === normalized && c.username === username);
  const entry = {
    site: normalized,
    username,
    password,
    notes,
    updated: new Date().toISOString()
  };
  if (idx >= 0) creds[idx] = entry;
  else creds.push(entry);
  save(email, creds);
  return entry;
}

// Get credentials for a site
function get(email, site) {
  const creds = load(email);
  const normalized = normalizeSite(site);
  return creds.filter(c => c.site === normalized);
}

// List all sites (no passwords)
function list(email) {
  const creds = load(email);
  return creds.map(c => ({ site: c.site, username: c.username, notes: c.notes, updated: c.updated }));
}

// Remove a credential
function remove(email, site, username) {
  const creds = load(email);
  const normalized = normalizeSite(site);
  const filtered = creds.filter(c => !(c.site === normalized && (!username || c.username === username)));
  save(email, filtered);
  return creds.length - filtered.length;
}

function normalizeSite(site) {
  return site.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
}

module.exports = { set, get, list, remove };
