# Wanfunzy

Top-up storefront for **Mobile Legends: Bang Bang, Free Fire, PUBG Mobile, and Honor of Kings**.
Customers pick a game, pick a package, submit their Player ID, and place an order. The
Owner signs in to a private admin panel to review orders, mark them confirmed/delivered,
and manage the package catalog — separately for each game.

No payment gateway is wired in — orders are placed, then the Owner contacts the
customer directly to arrange payment and confirms the order by hand. This matches
how most small Cambodian top-up shops actually operate (Telegram/phone confirmation),
and means you can launch today without a merchant account.

**Zero npm dependencies.** Built entirely on Node's built-in `http`, `fs`, and `crypto`
modules. There is nothing to `npm install` — this avoids a whole category of deploy
problems (lockfile mismatches, native build failures, broken transitive deps) and
means the app starts in well under a second.

---

## 1. Run it locally

You need [Node.js](https://nodejs.org) version 18 or newer. Check with:

```bash
node --version
```

Then, from inside this folder:

```bash
node server.js
```

You'll see:

```
Wanfunzy server running → http://localhost:3000
Admin login → http://localhost:3000/admin/login
Default credentials: admin / wanfunzy123  (change this immediately)
```

Open `http://localhost:3000` in your browser. That's the storefront.
Open `http://localhost:3000/admin/login` to sign in as Owner.

**First thing to do: change the default password.** Sign in with `admin` /
`wanfunzy123`, click **ប្តូរពាក្យសម្ងាត់** (Change password) in the top bar, and set
something only you know.

---

## 2. How data is stored

All data — admin login, packages, and orders — lives in one file: `data/db.json`.
It's created automatically the first time the server starts. There's no database
server to install or configure.

This is genuinely fine for a single small storefront. If you outgrow it (hundreds of
orders a day, multiple staff accounts, need for backups/replication), the natural
next step is swapping `db.json` for a real database — see "Growing past this" below.

**Back up `data/db.json` regularly** if this is running a real business — copy it
somewhere safe (Google Drive, email it to yourself, whatever) every so often, since
it's the only copy of your order history.

---

## 3. Deploying so it's live on the internet

Any host that runs Node.js works. Two easy, beginner-friendly options:

### Option A: Railway (recommended — easiest)

1. Create a free account at [railway.app](https://railway.app).
2. Push this folder to a GitHub repository (or use Railway's "Deploy from local
   folder" if offered).
3. In Railway, click **New Project → Deploy from GitHub repo**, pick this repo.
4. Railway auto-detects Node.js and runs `npm start` (which runs `node server.js`).
   No build step needed.
5. Once deployed, Railway gives you a public URL like `wanfunzy.up.railway.app`.
6. **Important:** Railway's filesystem is ephemeral on redeploy unless you attach a
   **Volume**. In your service settings, add a Volume mounted at `/app/data` so
   `db.json` survives restarts and redeploys. Without this, every deploy wipes your
   orders.

### Option B: Render

1. Create a free account at [render.com](https://render.com).
2. **New → Web Service**, connect your GitHub repo.
3. Build command: leave blank (nothing to build). Start command: `node server.js`.
4. Under **Disks**, add a persistent disk mounted at `/data`, and change `DB_FILE`'s
   folder accordingly (or simplest: set the disk mount path to the app's `data/`
   folder directly, e.g. `/opt/render/project/src/data`).
5. Deploy. Render gives you a public URL.

### Option C: A VPS you already have (DigitalOcean, Linode, a home server, etc.)

```bash
# On the server, after copying this folder over (scp, git clone, etc.)
cd wanfunzy
node server.js
```

Keep it running after you disconnect using `pm2` (if installed) or plain `nohup`:

```bash
nohup node server.js > server.log 2>&1 &
```

Put it behind Nginx or Caddy if you want a domain name and HTTPS — both are simple
reverse-proxy configs for a single Node port. Ask your host's documentation, or come
back here and I can write the Nginx config for your exact domain.

### A note on payments

Since there's no payment gateway, **nothing here touches money directly** — there's
no PCI scope, no merchant account needed to launch. When you're ready to add real
ABA PayWay or Wing QR payments later, that's a separate integration (you'll need a
merchant account with them first) — happy to wire that in when you have those
credentials.

---

## 4. Project structure

```
wanfunzy/
├── server.js              # HTTP server + all routes
├── db.js                   # File-based data store (read/write db.json, password hashing)
├── package.json
├── data/
│   └── db.json              # Created automatically — games, orders, packages, admin login
├── public/
│   ├── styles.css            # All visual design
│   └── images/
│       └── mascot.jpg          # Site mascot/logo artwork
└── views/
    ├── layout.js              # Shared HTML shell + icons (including per-game icons)
    ├── home.js                # Storefront (game selector + package grid + order form)
    ├── order-confirmation.js   # Shown after placing an order
    ├── track-order.js          # Customer order-status lookup
    ├── admin-login.js          # Owner sign-in
    ├── admin-dashboard.js      # Owner panel: orders + per-game package management
    └── not-found.js            # 404 page
```

## 5. Customizing

**From the Admin Panel (no code needed):**
- **Games**: edit directly — no code changes needed for price/name/amount changes.
  Each package belongs to one game via `gameId`.
- **Site Customization section** in the admin dashboard lets you change, without
  touching any code:
  - **Text colors** — Heading, Body Text, and Accent colors, each with a color
    picker and hex input.
  - **Profile Picture** — the logo shown in the header and hero section.
  - **Cover Banner** — a background image behind the hero section.
  - **Per-game logos** — replace any game's icon with your own image, right inside
    that game's package section.

  Uploaded images are stored in `public/uploads/` and referenced from `data/db.json`
  — both are excluded from git since they're specific to your deployment.

**By editing files directly:**
- **Default games/packages on first run**: edit the `games` and `packages` arrays
  in `db.js` inside `buildSeedData()`. Each game has an `id`, display `name`,
  `currencyLabel` (e.g. "Diamonds", "UC", "Tokens"), `currencyUnit` (emoji shown
  next to amounts), an `icon` key (must match one of the `game_*` icons in
  `views/layout.js`), and `requiresServerId` (set `true` only for games like
  Mobile Legends that need a separate server/zone ID).
- **Default colors/fonts**: in `public/styles.css`, under the `:root` CSS variables
  at the top. (These are the fallback values used until the admin sets custom
  colors through the Site Customization panel.)
- **Default mascot/logo image**: replace `public/images/mascot.jpg` with your own
  artwork (same filename). This is the fallback shown until a Profile Picture is
  uploaded through the admin panel.
- **Text/copy**: each page's Khmer text lives directly in its `views/*.js` file as
  plain strings — search and edit directly.

## 6. Security notes

- Passwords are hashed with `scrypt` (Node's built-in, no external library needed) —
  never stored in plain text.
- Sessions are random 256-bit tokens stored server-side, expiring after 12 hours.
- Login attempts are rate-limited (8 per minute per IP) to slow down brute-forcing.
- The admin API endpoints all check for a valid session before making any change.
- Change the default admin password before sharing your URL with anyone.
- Image uploads (profile, cover, game logos) are limited to 5MB and restricted to
  JPG/PNG/WEBP — both checks happen server-side regardless of what the browser sends.

## Growing past this

If the shop takes off and you need multiple staff logins, faster lookups, or just
want peace of mind beyond a JSON file, the upgrade path is: swap `db.js` for a real
database (SQLite is the smallest step up — still file-based, no server to run; or
Postgres if you want it hosted). The rest of the app (`server.js`, all of `views/`)
doesn't need to change, since they only ever talk to the functions exported by
`db.js`. Happy to do that migration when you're at that point.
