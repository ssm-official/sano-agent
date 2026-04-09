// SANO Agent Store — Per-user persistence: users, wallets, memory
// File-based for simplicity. For production, swap for Postgres/Redis.

const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const MEMORY_DIR = path.join(DATA_DIR, "memory");

// Ensure directories exist
function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
}

// Load all users from disk
function loadUsers() {
  ensureDirs();
  if (!fs.existsSync(USERS_FILE)) return new Map();
  try {
    const raw = fs.readFileSync(USERS_FILE, "utf-8");
    const data = JSON.parse(raw);
    return new Map(Object.entries(data));
  } catch (e) {
    console.error("[STORE] Failed to load users:", e.message);
    return new Map();
  }
}

// Save users to disk
function saveUsers(usersMap) {
  ensureDirs();
  try {
    const obj = Object.fromEntries(usersMap);
    fs.writeFileSync(USERS_FILE, JSON.stringify(obj, null, 2));
  } catch (e) {
    console.error("[STORE] Failed to save users:", e.message);
  }
}

// Sanitize email for safe filename
function emailToFilename(email) {
  return email.toLowerCase().replace(/[^a-z0-9@.]/g, "_");
}

// ─── Per-User Memory ───
// Memory is a simple markdown file the agent can read and append to.
// Layout:
//   ## Profile
//   - name: ...
//   - shipping address: ...
//   - preferences: ...
//
//   ## Notes
//   - 2026-04-09: bought wireless earbuds for $35
//   - ...

function getMemoryPath(email) {
  return path.join(MEMORY_DIR, emailToFilename(email) + ".md");
}

function loadMemory(email) {
  ensureDirs();
  const file = getMemoryPath(email);
  if (!fs.existsSync(file)) return "";
  try {
    return fs.readFileSync(file, "utf-8");
  } catch (e) {
    return "";
  }
}

function saveMemory(email, content) {
  ensureDirs();
  try {
    fs.writeFileSync(getMemoryPath(email), content);
  } catch (e) {
    console.error("[STORE] Failed to save memory:", e.message);
  }
}

// Append a fact to memory under a given section
function rememberFact(email, fact, section = "Notes") {
  let memory = loadMemory(email);
  if (!memory.includes(`## ${section}`)) {
    memory += `\n\n## ${section}\n`;
  }
  // Insert the fact under the section
  const lines = memory.split("\n");
  const sectionIdx = lines.findIndex(l => l.trim() === `## ${section}`);
  if (sectionIdx === -1) {
    memory += `\n- ${fact}`;
  } else {
    // Insert right after the section header
    lines.splice(sectionIdx + 1, 0, `- ${fact}`);
    memory = lines.join("\n");
  }
  saveMemory(email, memory);
  return memory;
}

function forgetFact(email, query) {
  let memory = loadMemory(email);
  if (!memory) return memory;
  const lines = memory.split("\n");
  const filtered = lines.filter(l => !l.toLowerCase().includes(query.toLowerCase()));
  memory = filtered.join("\n");
  saveMemory(email, memory);
  return memory;
}

// ─── Daily usage tracking (for free tier limits later) ───
function getUsage(usersMap, email) {
  const user = usersMap.get(email);
  if (!user) return { messages_today: 0 };
  const today = new Date().toISOString().split("T")[0];
  if (user.usage?.date !== today) {
    return { messages_today: 0 };
  }
  return user.usage;
}

function incrementUsage(usersMap, email) {
  const user = usersMap.get(email);
  if (!user) return;
  const today = new Date().toISOString().split("T")[0];
  if (!user.usage || user.usage.date !== today) {
    user.usage = { date: today, messages_today: 1 };
  } else {
    user.usage.messages_today++;
  }
  saveUsers(usersMap);
}

module.exports = {
  loadUsers, saveUsers,
  loadMemory, saveMemory, rememberFact, forgetFact,
  getMemoryPath, getUsage, incrementUsage
};
