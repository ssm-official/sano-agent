# SANO Roadmap

Things we want to build but haven't yet. Living doc — add freely, prune ruthlessly.

---

## Background tasks + computer-use as a service

The big idea: users can hand SANO a task that runs in the background while
they're away from their computer, and we charge a small fee for the runtime.

### Background task engine
- New `tasks.js` module: persistent queue, status (pending / running / done /
  failed / cancelled), per-task sandbox lifecycle
- New tools the agent can call: `start_background_task`, `task_status`,
  `cancel_task`, `list_tasks`
- Tasks survive across chat sessions and server restarts (persist to disk)
- Each task has its own sandbox so they can run in parallel without colliding

### Navbar "computer running" indicator
- Pill in the top nav: "🟢 2 tasks running · $0.04"
- Click → opens Tasks panel
- Live status, current cost, kill button per task

### Per-second sandbox metering
- Track sandbox uptime in seconds
- Show real cost in the UI in real time so users trust the meter
- Sandbox auto-shutdown after N seconds idle (also a cost win)
- Reuse sandboxes within a task instead of cold-starting per action
- Take screenshots only when something visually changed, not after every action

### Billing (separate Stripe work)
- Meter today, bill later
- Free tier of N sandbox-minutes per month, then $X per sandbox-minute
- Could deduct from USDC balance directly instead of Stripe — feels more native

---

## Playbook system — make computer use 3x faster

A `playbooks/` directory of markdown files, one per site. Each playbook =
step-by-step instructions, common selectors, OTP handling notes, gotchas.

When the agent starts a task involving a known site, the matching playbook
gets injected as extra context. Way faster than blind exploration, way fewer
wrong clicks.

### First batch (~10)
- `gopay-topup.md`
- `gcash-topup.md`
- `ovo-topup.md`
- `paypal-pay.md`
- `venmo-send.md`
- `cashapp-send.md`
- `steam-redeem.md`
- `roblox-redeem.md`
- `netflix-signup.md`
- `spotify-signup.md`

### Long tail
- Users / community can add playbooks by dropping markdown files
- Eventually: an in-app "teach SANO this site" recorder that captures a
  human-led flow once and saves it as a playbook

---

## Universal payments — pay anything that needs a card

The hard one. Lets the agent pay merchants that only accept credit/debit cards
using the user's USDC balance.

### Path A — Virtual card issuing partner
- BaaS partner: Stripe Issuing, Lithic, Privacy.com (US), Marqeta
- Requires KYC/KYB on Sano Finance (the company), real banking partner
- USDC ↔ fiat rails to fund the card
- New tool: `create_virtual_card(amount, single_use)` returns card number
- Agent uses computer use to enter the card on the merchant page

### Path B — Fiat off-ramp per transaction
- Use a service like Mercuryo / Transak / MoonPay to convert USDC → real
  card transaction at checkout
- Less control, more friction, no KYC on us — only on the user

### Path C — Physical cards
- Same as A but for users who want a real plastic card linked to their wallet
- Probably year 2+ feature

---

## Teach the AI to do everything

This is really three things:

1. **Playbook system** (above) covers known sites
2. **Better tool descriptions** with concrete examples in every schema
3. **A "skill library"** — a tools manifest the agent can browse mid-task to
   discover capabilities it didn't know it had. Right now it has all tools
   inline; could move to a tool-search pattern (`tool_search` with bm25)

### Sign-up automation
- Detect when a service requires sign-up before purchase
- Generate a unique email alias per site (catch-all on a domain we control)
- Generate strong passwords, save to credentials vault automatically
- Solve email-verification OTPs by reading the inbox we created
- Solve SMS OTPs by routing through a number-rental service (Twilio sub-numbers
  per user, or a service like SMSPool for one-time use)

---

## Stocks & trading polish

- Stock charts in the chat (sparkline + 7d / 30d / 1y toggles)
- Trading view-style candlesticks for power users
- Buy/sell in shares, not just USD
- Multi-leg orders (bracket orders: entry + stop + target in one command)
- DCA / recurring buys
- Portfolio rebalancing assistant
- Tax lot tracking + gains/losses report

---

## Wallet & infra

- Auto-fund SOL for new users (treasury wallet seeds 0.005 SOL on signup)
- EVM balance + transactions (multi-chain wallet exists but unused)
- Better RPC redundancy / fallback (Helius primary, Triton/QuickNode backup)
- Webhook listener for incoming payments → toast notification

---

## Quality of life

- Recover lost GoPay credit (Bitrefill list-orders + reconciliation)
- Bring back flights/hotels via Duffel
- Loading state polish — step-by-step progress instead of a single spinner
- Mobile layout polish
- Stock chart in trade receipt
- Voice input
- iOS / Android wrapper apps

---

## Production hardening

- JWT auth instead of plaintext session tokens
- Postgres instead of file-based store (sessions, users, orders, tasks)
- Sentry error tracking
- Stripe billing for paid plans
- Rate limiting per user (currently per IP)
- Audit log of every tool call per user (compliance + debugging)
- Backup + restore for the wallet vault
- 2FA on the SANO account itself

---

## Notes

- Items are NOT in priority order
- If something here is now done, delete it from the file (don't leave checkmarks)
- If something is no longer wanted, delete it
- Add new ideas freely
