# 💊 MediTrack

A medicine inventory **and storefront** project: staff manage stock, customers browse the
catalogue, add medicines to a cart, check out, and pay on a sandbox payment page.

- **Frontend:** React (Vite) + React Router
- **Backend:** Node.js + Express
- **Database:** MongoDB via Mongoose — `medicines`, `users`, `carts`, `wishlists`, `orders`,
  `sessions`, `admininvites`, `medipointsentries`, `auditlogs` and `prescriptions` collections
- **Auth:** JWT (`jsonwebtoken`) with bcrypt-hashed passwords (`bcryptjs`)
- **Cart session:** signed, httpOnly cookie + server-side cart document (`cookie-parser`)
- **Payments:** provider adapter with a built-in sandbox gateway (`PAYMENT_PROVIDER=mock`)
- **Image upload:** multer (saved to `backend/uploads/`)

## Documentation

| Document | File |
| -------- | ---- |
| Project report — IEEE 830 / 1016 / 829 structure, 47 pp. | `MediTrack_Project_Report_IEEE_v2.pdf`, `MediTrack_Project_Report_IEEE_v2.docx` |
| Report source (regenerate the DOCX/PDF from here) | `docs/MediTrack_Project_Report_IEEE_v2.html` |
| Software Requirements Specification | `SRS.pdf` |
| Deployment runbook (Netlify + Atlas, with a Render alternative) | `docs/DEPLOYMENT.md` |

The report's Appendix A is the authoritative requirement-to-code-to-test traceability matrix; update it whenever a
phase lands.

## Project structure

```
meditrack/
├── backend/
│   ├── server.js              # Express app + CORS + cookies + routes + error handler
│   ├── netlify.js             # Netlify Function wrapper (serverless-http, DB connect, migrations)
│   ├── db.js                  # MongoDB connection (Mongoose)
│   ├── models/
│   │   ├── Medicine.js        # the stock collection ("medicines")
│   │   ├── User.js            # accounts + roles (customer / staff / admin)
│   │   ├── Cart.js            # guest / user carts (server-side)
│   │   ├── Wishlist.js        # saved medicines, one list per account (FR-1.5)
│   │   ├── Order.js           # order snapshots + payment state
│   │   ├── Prescription.js    # encrypted Rx uploads + verification state (FR-1.4/2.1)
│   │   ├── Session.js         # refresh-token sessions (hashed, rotating)
│   │   ├── AdminInvite.js     # single-use staff/admin invites (hashed)
│   │   ├── MediPointsEntry.js # append-only MediPoints ledger (one earn per order)
│   │   └── AuditLog.js        # append-only back-office audit trail
│   ├── middleware/
│   │   ├── auth.js            # requireAuth, requireRole, requirePermission, JWT signing
│   │   ├── rateLimit.js       # brute-force limits for login / registration
│   │   └── requestGuards.js   # reject cross-site form posts
│   ├── lib/
│   │   ├── errors.js          # httpError + asyncHandler helpers
│   │   ├── mongoErrors.js     # local/cloud connection hints + password redaction
│   │   ├── availability.js    # expired / out-of-stock checks
│   │   ├── inventory.js       # low-stock watermark → refill sweep (FR-1.1)
│   │   ├── medipoints.js      # earn rule + idempotent credit (FR-2.4)
│   │   ├── pricing.js         # paise-accurate subtotal, GST, delivery, total
│   │   ├── cartSession.js     # signed cookie, cart lookup/merge, serialisation
│   │   ├── cartHolds.js       # stock → held holds, release + sweeper (FR-1.2/1.3)
│   │   ├── wishlist.js        # save / remove / clear, live serialisation (FR-1.5)
│   │   ├── sessions.js        # refresh cookie, rotation, reuse detection
│   │   ├── permissions.js     # role → permission map (shared with the SPA)
│   │   ├── invites.js         # create/accept/revoke admin+staff invites
│   │   ├── audit.js           # recordAudit + paginated audit list
│   │   ├── migrations.js      # one-time data migrations (staff → customer, held counter)
│   │   ├── orderService.js    # checkout, hold→sale conversion, rollback, expiry
│   │   ├── prescriptions.js   # AES-256-GCM files, validity + checkout gate (FR-1.4/2.1)
│   │   ├── purchaseLimit.js   # daily unit allowance + checkout check (NFR-2.2)
│   │   ├── imageStore.js      # medicine images: disk locally, Netlify Blobs on Netlify
│   │   ├── paymentGateway.js  # provider registry + charge()
│   │   └── providers/
│   │       └── mockPayment.js # sandbox gateway (deterministic test cards)
│   ├── scripts/
│   │   ├── check-db.js        # `npm run db:check` — verify MONGODB_URI (local or cloud)
│   │   ├── local-mongo.js     # `npm run db:local` — no-install local MongoDB
│   │   ├── seed-admin.js      # `npm run seed:admin` — create/promote the first admin
│   │   ├── seed-demo.js       # `npm run seed:demo` — idempotent demo catalogue
│   │   ├── data.js            # `npm run seed:data` — 30 products / 7 varieties + images
│   │   ├── smoke-deploy.js    # `npm run smoke:deploy` — post-deploy health/CORS checks
│   │   ├── migrate-roles.js   # `npm run migrate:roles` — apply pending data migrations
│   │   └── replenish-inventory.js # `npm run inventory:replenish` — one restock pass
│   ├── routes/
│   │   ├── auth.js            # register / login / refresh / logout / sessions / users
│   │   ├── adminAuth.js       # public back-office login + invite acceptance
│   │   ├── admin.js           # summary / orders / customers / audit / invites / restock
│   │   ├── medicines.js       # stock CRUD + image upload (staff + admin)
│   │   ├── cart.js            # cart endpoints
│   │   ├── wishlist.js        # save / remove / clear + move-to-cart (FR-1.5)
│   │   ├── orders.js          # checkout, order history, pay, cancel
│   │   ├── prescriptions.js   # upload / history / decrypted file (FR-1.4)
│   │   └── me.js              # customer account extras (MediPoints)
│   ├── tests/                 # API tests (stock, auth sessions, admin/roles, cart, holds,
│   │                          # payments, inventory, MediPoints, wishlist, prescriptions,
│   │                          # daily purchase limit)
│   ├── uploads/               # (created at runtime) uploaded images
│   └── .env.example           # environment template
├── netlify.toml               # build + function rewrites + bundled images + SPA fallback
├── netlify/functions/api.js   # Netlify Function entry point (delegates to backend/netlify.js)
└── frontend/
    └── src/
        ├── App.jsx                        # router + providers + layout
        ├── context/
        │   ├── AuthContext.jsx            # signed-in user, silent refresh, logout
        │   ├── CartContext.jsx            # cart state + merge-on-login + dialog state
        │   └── WishlistContext.jsx        # account wishlist, empty on sign-out
        ├── lib/
        │   ├── api.js                     # fetch wrapper (memory JWT + refresh) + APIs
        │   └── format.js                  # currency, dates, status labels
        ├── components/
        │   ├── Navbar.jsx                 # nav + cart/wishlist badges + user chip
        │   ├── ProtectedRoute.jsx         # role-guarded routes
        │   ├── MedicineForm.jsx           # stock entry form
        │   ├── MedicineList.jsx           # stock list + add-to-cart + save-for-later heart
        │   ├── Modal.jsx                  # accessible native <dialog> wrapper
        │   ├── AddToCartDialog.jsx        # quantity + confirmation dialog
        │   ├── QuantityStepper.jsx        # −/+ control
        │   ├── HoldCountdown.jsx          # live cart-hold timer (FR-1.2/1.3)
        │   ├── PrescriptionNotice.jsx     # Rx status / upload prompt in cart + checkout
        │   ├── PurchaseLimitNotice.jsx    # daily allowance + over-limit warning (NFR-2.2)
        │   └── OrderSummary.jsx           # shared price breakdown
        └── pages/
            ├── Home.jsx                   # landing page + stock list
            ├── Login.jsx                  # customer sign in / create account
            ├── AdminRegister.jsx          # single-use invite acceptance
            ├── AddMedicine.jsx            # stock update page (staff + admin)
            ├── Cart.jsx                   # cart page
            ├── Checkout.jsx               # shipping address + place order
            ├── Payment.jsx                # payment methods + sandbox gateway
            ├── OrderConfirmation.jsx      # receipt / order detail
            ├── Orders.jsx                 # order history
            ├── Wishlist.jsx               # saved medicines + move to cart (FR-1.5)
            ├── Prescriptions.jsx          # upload / status / history (FR-1.4, FR-2.1)
            └── admin/
                ├── AdminLogin.jsx         # separate back-office sign-in
                ├── AdminDashboard.jsx     # counters + recent orders
                ├── AdminStock.jsx         # add / stock-edit / delete medicines
                ├── AdminOrders.jsx        # all orders + fulfilment transitions
                ├── AdminPrescriptions.jsx # verification queue: approve / reject (FR-2.1)
                ├── AdminCustomers.jsx     # customers with order stats
                ├── AdminInvites.jsx       # create / revoke invites
                └── AdminAudit.jsx         # audit log
```

## How to run

### 0. Choose a MongoDB — local, or cloud (Atlas)

The application code is identical for both; only `MONGODB_URI` in `backend/.env` changes.

**Option A — local MongoDB**

```bash
# macOS (Homebrew)
brew tap mongodb/brew && brew install mongodb-community && brew services start mongodb-community

# Ubuntu / Debian
sudo systemctl start mongod
```

```
MONGODB_URI=mongodb://127.0.0.1:27017/meditrack
```

**Option B — cloud MongoDB (MongoDB Atlas)**

1. Create a free **M0** cluster at https://cloud.mongodb.com.
2. **Database Access** → *Add New Database User* → note the username and password.
3. **Network Access** → *Add IP Address* → your current IP (use `0.0.0.0/0` only while developing).
4. **Database → Connect → Drivers** → copy the connection string and add your database
   name to the path:

```
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/meditrack?retryWrites=true&w=majority
```

5. Paste it into `backend/.env` (comment out the local line first).
6. Verify it **before** starting the server:

```bash
cd backend
npm run db:check
```

`db:check` prints the host (password redacted), the **database it will use**, the server
version, the collections and how many documents each holds, and creates the indexes the app
needs (`medicines`, `users`, `carts`, `wishlists`, `orders`, `sessions`, `admininvites`,
`medipointsentries`, `auditlogs`, `prescriptions`). If the connection fails it tells you what to
fix — wrong password, unencoded special characters in the password, `mongodb+srv` hostname
typo, or an Atlas IP allow-list entry that is missing.

> **Notes for cloud connection strings**
>
> - Keep `mongodb+srv://` — Atlas resolves the replica-set hosts over DNS SRV records.
> - URL-encode special characters in the password: `@ → %40`, `# → %23`, `/ → %2F`,
>   `: → %3A`, `? → %3F`, `% → %25`.
> - Always include the database name (`…/meditrack?retryWrites=…`). If the path is omitted,
>   the backend now falls back to `meditrack` (`MONGODB_DB` overrides it) instead of silently
>   writing to MongoDB's default `test` database. `db:check` prints the database in use.
> - Data created before you added a database name lives in the old database (usually `test`).
>   It will not appear in `meditrack`; either point `MONGODB_URI` at the old database or copy
>   the collections across in Atlas.
> - No API key is involved: the database user's username/password (inside the URI) is what
>   authenticates the app. Atlas *API keys* are only for the Atlas admin/automation API.
> - Never commit `backend/.env` — it is git-ignored; commit `.env.example` instead.

### Troubleshooting "why can't I connect?"

Always start with the checker — it prints the target host (password redacted) and a specific
hint for the failure:

```bash
cd backend
npm run db:check
```

| What `db:check` says | What it means | Fix |
| -------------------- | ------------- | --- |
| `bad auth : Authentication failed` | The cluster **was reached**, but the username/password in the URI is wrong. | Atlas → **Security → Database Access**: check the user exists (usernames are case-sensitive) and use **Edit → Edit Password**. Then copy the string again from **Connect → Drivers**. URL-encode special characters. |
| `querySrv ENOTFOUND _mongodb._tcp.<name>.mongodb.net` | The hostname **does not exist in DNS** — the cluster was deleted, renamed, or the string was copied from a different project. | Re-create/restore the cluster and copy the *current* string. This is not a credentials or firewall problem; no client can connect to a host that does not resolve. |
| `Could not connect to any servers … not whitelisted`, `ETIMEDOUT` | The network path is blocked. | Atlas → **Network Access** → add your current IP (or `0.0.0.0/0` while developing), then retry. |
| Works on one network, fails on another | `mongodb+srv://` needs DNS **SRV + TXT** records; some campus/mobile/captive networks block or break those lookups. | Use the non-SRV *standard connection string* from Atlas (Connect → Drivers → an older driver version) which lists the shard hosts explicitly, or work locally (below). |
| `ECONNREFUSED 127.0.0.1:27017 (local)` | Nothing is listening locally. | `npm run db:local`, or point `MONGODB_URI` at your cluster. |
| Connects, but expected stock/accounts are missing | You are connected to a **different database**. Before the URI named a database, the app used Atlas's default `test` DB. | Read the `connected : database "…"` line from `db:check`. Point `MONGODB_URI` at the old DB (e.g. `…/test?…`) or set `MONGODB_DB`, then check Atlas → Browse Collections. |

### No cluster handy? Run MongoDB locally with no install

```bash
cd backend
npm run db:local      # MongoDB 8 on 127.0.0.1:27017, data kept in backend/.mongo-data
```

Leave it running and start the backend from a second terminal (`npm run dev`) with
`MONGODB_URI=mongodb://127.0.0.1:27017/meditrack` in `.env`. It uses the `mongod` binary that
`mongodb-memory-server` already downloads into `node_modules`, so there is nothing to install,
and the data survives restarts. Ctrl+C stops it.

### 1. Backend (port 5000)

```bash
cd backend
npm install
cp .env.example .env      # then edit MONGODB_URI / JWT_SECRET
npm run db:check          # optional but recommended: confirms the database works
npm run dev               # or: npm start
```

`backend/.env`:

```
PORT=5000
MONGODB_URI=mongodb://127.0.0.1:27017/meditrack   # or the Atlas string
# MONGODB_DB=meditrack                            # used when the URI omits the db name
JWT_SECRET=<long random string>
JWT_ACCESS_TTL=15m
REFRESH_TOKEN_TTL_DAYS=30
COOKIE_SECRET=<another long random string>
# Invite lifetime for staff/admin accounts (default shown)
# ADMIN_INVITE_TTL_HOURS=72
# Brute-force limits (defaults shown)
# AUTH_RATE_LIMIT_WINDOW_MS=900000
# AUTH_LOGIN_RATE_LIMIT_MAX=10
# AUTH_REGISTER_RATE_LIMIT_MAX=30
# Optional e-commerce settings (defaults shown)
TAX_RATE=0.05
DELIVERY_FEE=40
FREE_DELIVERY_OVER=499
PAYMENT_PROVIDER=mock
PAYMENT_MOCK_DELAY_MS=700
ORDER_RESERVATION_MINUTES=30
# Cart soft holds (SRS FR-1.2 / FR-1.3)
CART_HOLD_MINUTES=15
CART_HOLD_SWEEP_INTERVAL_MS=60000
# Inventory replenishment (SRS FR-1.1)
LOW_STOCK_WATERMARK=10
REPLENISH_TO=100
REPLENISH_INTERVAL_MS=60000
INVENTORY_AUTO_REPLENISH=on
# MediPoints (SRS FR-2.4)
MEDIPOINTS_PER_100=1
# Prescription uploads (SRS FR-1.4 / FR-2.1, NFR-1.4)
# 64 hex characters; when unset a key is derived from JWT_SECRET.
# RX_ENCRYPTION_KEY=<64 hex characters>
PRESCRIPTION_VALID_DAYS=365
# Fair-use daily purchase cap per UTC day (0 disables; an invalid value → 10)
DAILY_PURCHASE_LIMIT=10
# CORS_ORIGIN=https://shop.example.com   # REQUIRED in production (see docs/DEPLOYMENT.md)
```

Generate secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### 2. Frontend (port 5173)

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

The Vite dev server proxies `/api` and `/uploads` to the backend, so you can call
the API with relative URLs from the frontend.

## Deploying to Netlify

`netlify.toml` builds `frontend/` into static files and runs the Express backend as a
Netlify Function (`netlify/functions/api.js` → `backend/netlify.js`). Requests to `/api/*`
and `/uploads/*` are rewritten to the function, so the SPA and the API share one origin.
Uploaded medicine images are stored in Netlify Blobs, because function disks are temporary.

Set these environment variables under **Project configuration → Environment variables**
(the API returns a 500 explaining what is missing until they exist):

| Variable | Value |
| -------- | ----- |
| `MONGODB_URI` | A MongoDB Atlas connection string. In Atlas → Network Access, allow `0.0.0.0/0`, because Netlify Functions have no fixed IP addresses. |
| `JWT_SECRET` | A long random string: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `COOKIE_SECRET` | A different long random string |

The other values in `backend/.env.example` are optional. Background sweeps (restocking and
cart-hold release) can't run continuously in a serverless function. Lapsed cart holds are
still released when a cart is read. Admins can restock from the dashboard. After the first
deploy, create the first admin by running `npm run seed:admin` locally with the same
`MONGODB_URI`.

## Authentication & authorisation

| Who | Read stock list | Open `/admin` console | Create / update / delete stock | Fulfil orders | Manage users, invites & audit |
| --- | --------------- | --------------------- | ------------------------------ | ------------- | ----------------------------- |
| Anonymous visitor | ✅ | ❌ | ❌ | ❌ | ❌ |
| `customer` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `staff` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `admin` | ✅ | ✅ | ✅ | ✅ | ✅ |

- Sign in at `/login`. The API returns a **short-lived access token** (default **15
  minutes**) that the SPA keeps **in memory only** — never in `localStorage` — and sends
  as `Authorization: Bearer <token>`. The browser also receives a **30-day refresh token**
  in a signed, `httpOnly`, `SameSite=Lax` cookie scoped to `/api/auth`. Only the SHA-256
  hash of that token is stored in the `sessions` collection.
- On page load, and whenever an access token has expired, the SPA calls
  `POST /api/auth/refresh` silently. Every refresh **rotates** the cookie. Replaying an
  already-rotated token after a short grace window is treated as theft: all sessions for
  the account are revoked and `tokenVersion` is bumped, so outstanding access tokens die
  immediately. The grace window (default 10 s) lets two tabs refresh at once without
  logging the user out.
- Logging out revokes the current refresh session. `DELETE /api/auth/sessions/:id` signs
  out one device, `DELETE /api/auth/sessions` signs out everywhere, and
  `PATCH /api/auth/password` changes the password and revokes every session.
- **Customers sign in at `/login`; staff and administrators sign in at `/admin/login`.**
  Both flows issue the same short-lived access token and refresh cookie, but the
  back-office endpoint rejects `customer` accounts.
- **Customer registration is public and customer-only:**
  `POST /api/auth/register` always creates a `customer`. Sending `role: "staff"` or
  `role: "admin"` is rejected with **403** — those roles are never self-service.
- **Back-office accounts are provisioned by invitation.** Create the first administrator
  with the seed script:
  ```bash
  ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='a-long-password' \
    ADMIN_NAME='Store Admin' npm run seed:admin
  ```
  A signed-in admin then creates single-use, expiring invite links at **`/admin/invites`**
  (`POST /api/admin/invites`). The invitee opens `/admin/register?invite=…`, sets a
  password, and the account is created with the invited role (`staff` or `admin`).
  Raw invite tokens are returned once and only their SHA-256 hash is stored.
- **Demo catalogue:** `npm run seed:data` (safe to re-run) fills the store with 30 products
  across 7 categories, each with a short description and a generated SVG image
  (`backend/uploads/seed-*.svg`). Existing product names are matched case-insensitively and
  enriched, never overwritten. `npm run seed:demo` is the smaller, inventory-focused seed used
  by the deployment runbook.
- Roles are re-read from the database on each request, so a role change takes effect on
  the next API call. Self-demotion is rejected, and the last administrator cannot be
  demoted.
- **Audit trail:** stock changes, order-status changes, role changes, invites, sign-in and
  password changes are written to the `auditlogs` collection and shown at `/admin/audit`
  (admins only).
- Existing customers can sign in at `/login`; the guest cart is merged into their account
  after authentication.
- **Brute-force protection:** failed sign-ins are limited per IP + email (default **10 per
  15 minutes**, successful sign-ins are not counted) and account registration is limited
  per IP (default **30 per 15 minutes**). Exceeding a limit returns **429** with a JSON
  `error`. Tokens are stored in an in-memory store; use a shared store (e.g. Redis) if you
  run several API instances. Limits are configurable with
  `AUTH_LOGIN_RATE_LIMIT_MAX`, `AUTH_REGISTER_RATE_LIMIT_MAX` and
  `AUTH_RATE_LIMIT_WINDOW_MS`.
- The backend enforces every rule through permissions (`catalog:write`,
  `orders:write`, `users:manage`, …); the frontend only hides UI it knows you cannot
  use. Stock writes answer **401** without a token and **403** for customers.
- **Authentication routes are JSON-only** (form-encoded POSTs get **415**), which blocks
  simple cross-site form submissions.
- Passwords are hashed with bcrypt (10 rounds) and the hash is never returned by the API.
- In production the server **refuses to start** without `JWT_SECRET` and `COOKIE_SECRET`,
  so the development fallbacks can never be used by accident. It also sets standard
  security headers via `helmet` and redirects plain HTTP requests to HTTPS.

### Shopping access

| Who | Browse stock | Add to cart | Checkout / pay | View orders | Wishlist |
| --- | ------------ | ----------- | -------------- | ----------- | -------- |
| Anonymous visitor | ✅ | ✅ (cookie cart) | ❌ — sign in first | ❌ | ❌ — sign in first |
| `customer` | ✅ | ✅ | ✅ | ✅ (own orders) | ✅ |
| `staff` / `admin` | ✅ | ✅ | ✅ | ✅ (own orders) | ✅ |

- Guests get a real server-side cart identified by the signed `mt_cart` cookie; no
  account is needed to shop.
- Checkout and order history require an account. The guest cart is merged into the
  account cart automatically after sign-in or registration.
- Stock management is available to `staff` and `admin`; customers can browse and order.

## Cart, cookies, checkout & payments

### The cart cookie (why it is "proper")

The cookie never contains the cart. It contains a random 32-byte session token, and
**only the SHA-256 hash of that token is stored in MongoDB**:

| Property | Value | Why |
| -------- | ----- | --- |
| Name | `mt_cart` | one dedicated cookie |
| `HttpOnly` | ✅ | JavaScript (and therefore XSS) cannot read it |
| `SameSite` | `Lax` | not sent on cross-site POSTs; no CSRF form attacks |
| `Secure` | in production | HTTPS-only; local dev still works over HTTP |
| `Max-Age` | 30 days | guest carts survive normal visits |
| `Path` | `/api` | never sent to static/image routes |
| Signed | HMAC with `COOKIE_SECRET` | a tampered cookie is detected, ignored and cleared |

The server-side `carts` document stores only medicine references and quantities. Names,
prices and stock are read live from `medicines` on every request, so a price change or a
sell-out is reflected immediately and the browser can never dictate the amount charged.
A MongoDB TTL index removes abandoned guest carts after 30 days.

The frontend `apiFetch` helper sends `credentials: 'include'`, and the backend CORS setup
allows credentials for every origin listed in `CORS_ORIGIN`. With the Vite dev proxy the app
is same-origin, so cookies work out of the box, and a same-origin production deploy (SPA and
API on one host, including the Netlify SPA + function setup) is accepted automatically by
comparing the `Origin` host with `X-Forwarded-Host`/`Host`. Add exact origins to
`CORS_ORIGIN` only when the SPA is served from a **different** host; see
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

### Add-to-cart dialog

- The medicine card has an **Add to cart** button (disabled for expired/out-of-stock items).
- It opens a native `<dialog>` modal (`showModal()`): focus trap, ESC and backdrop close
  are handled by the browser, with an explicit quantity stepper bounded by live stock.
- The dialog then switches to an "Added to cart" confirmation with **View cart** and
  **Keep shopping** actions; the navbar badge updates immediately.
- All cart mutations are JSON-only (`415` for form-encoded bodies), which — together with
  `SameSite=Lax` — blocks cross-site form posts.

### Pricing and stock rules

- Money is computed **server-side in paise** (`Math.round(price * 100)`) to avoid floating
  point drift — never from values sent by the client.
- `TAX_RATE=0.05` (5% GST), `DELIVERY_FEE=40`, delivery free from `FREE_DELIVERY_OVER=499`.
  All three are read from the environment and stored on each order.
- Expired medicines (`exp` before today) and out-of-stock medicines cannot be added to a
  cart or ordered.
- **Cart soft hold (FR-1.2):** adding a medicine moves the units out of `Medicine.stock`
  and into `Medicine.held` in one conditional update
  (`{ stock: { $gte: qty } } → $inc: { stock: -qty, held: +qty }`), so two carts can never
  reserve the same unit. The hold lasts `CART_HOLD_MINUTES` (default **15**) and is
  re-clocked whenever the line changes or is refreshed. `stock` is therefore *available*
  units; `stock + held` is the physical quantity on hand.
- **Releasing a hold (FR-1.3):** when it lapses the units go back to `stock` — by the
  background sweep (`CART_HOLD_SWEEP_INTERVAL_MS`), by the next read of that cart, or by
  the cart being emptied. The line **stays in the cart**, flagged `holdExpired`, and the
  customer can press **Refresh hold** (a `PATCH` with the quantity the line already has).
  Releasing is claimed first (the line's `holdExpiresAt` is cleared atomically), so a
  sweeper, a cart read and a checkout cannot release the same hold twice.
- On checkout each line's hold is **converted into a sale** (`$inc: { held: -qty }`, the
  shelf was already decremented when the hold was taken). A line whose hold lapsed is
  reserved from `stock` instead. If any line fails, every earlier counter move in that
  checkout is undone (a converted hold becomes a hold again), so an order is never
  partially placed and the customer keeps the reservation they had.
- A pending order holds its stock for `ORDER_RESERVATION_MINUTES` (default 30). Paying
  clears the deadline; cancelling or letting it lapse releases the stock exactly once
  (atomic status transition, so a race cannot double-restore).
- **Low-stock replenishment (FR-1.1):** a medicine at or below `LOW_STOCK_WATERMARK`
  (default **10**) is refilled to `REPLENISH_TO` (default **100**). The sweep runs every
  `REPLENISH_INTERVAL_MS` (default 60 s) and once at startup, and the Inventory Manager can
  trigger it from **`/admin/stock` → Restock low stock** or `POST /api/admin/inventory/replenish`.
  Expired medicines are never refilled, and each restock is written to the audit log.
  Run one pass by hand with `npm run inventory:replenish`. Set
  `INVENTORY_AUTO_REPLENISH=off` to disable the timer (the endpoint keeps working).
- **MediPoints (FR-2.4):** after a confirmed payment the customer earns 1 point per ₹100 of
  the medicine subtotal (`MEDIPOINTS_PER_100`). The balance is shown on `/orders` and on the
  receipt. The `medipointsentries` collection is an append-only ledger with one entry per
  order, so replaying a payment cannot credit twice.

### Payment provider

Routes call only `lib/paymentGateway.js → charge({ order, method, details })`. The default
provider is the built-in sandbox (`PAYMENT_PROVIDER=mock`), so no API keys or network access
are needed:

| Method | Demo behaviour |
| ------ | -------------- |
| Card | `4242 4242 4242 4242` succeeds; any Luhn-valid number ending in `02` is declined; expiry must be `MM/YY` and in the future |
| UPI | `name@bank` succeeds; `fail@bank` is declined |
| Net banking | `hdfc`, `icici`, `sbi`, `axis`, `kotak` succeed; `failbank` is declined. Only the bank code is stored (as `payment.brand`) |
| Cash on delivery | accepted up to ₹5,000; order becomes `processing` with payment pending |

Only the brand and last four digits are stored on the order — never a full card number or
CVV. `PAYMENT_MOCK_DELAY_MS` simulates gateway latency (`0` in tests).

To add a real gateway later, create `backend/lib/providers/<name>.js` exporting
`{ name, charge(...) }`, register it in `lib/paymentGateway.js`, and set
`PAYMENT_PROVIDER=<name>`. A provider that needs a redirect can return
`{ status: 'redirect', redirectUrl }`; the payment page already handles that shape.

### Order statuses

| Status | Meaning |
| ------ | ------- |
| `pending_payment` | created, stock reserved, waiting for the payment page |
| `paid` | card/UPI payment captured |
| `processing` | cash-on-delivery order confirmed, payment pending |
| `cancelled` | cancelled by the customer; stock released |
| `expired` | reservation lapsed before payment; stock released |

## Data model — should stock be one collection?

**Yes, for this stage one `medicines` collection is the right call.** Each document is a
single medicine currently held in stock, so it carries both the product details and the
quantity. There is no fact repeated across rows (so no update anomalies), no many-to-many
relationship, and every read is a single-document lookup — the model is already normalised
for the entity it describes.

```js
// collection: medicines
{
  _id: ObjectId("..."),
  name: "Dettol Liquid",
  category: "Digestive & First Aid",  // storefront grouping (30-product seed: 7 categories)
  description: "Antiseptic liquid for first aid, surface cleaning and personal hygiene.",
  mfd: "2025-01-15",                 // manufacturing date (YYYY-MM-DD)
  exp: "2027-01-15",                 // expiry date (YYYY-MM-DD)
  price: 120.5,
  stock: 50,                         // quantity a new customer can buy
  held: 2,                           // units promised to live cart holds
  prescriptionRequired: false,       // Rx-only → checkout needs a verified prescription
  refillDays: 30,                    // refill reminder cycle (FR-2.5)
  image: "seed-dettol-liquid.svg",
  createdBy: ObjectId("..."),        // ref: users
  created_at: ISODate("2026-01-01T10:00:00Z"),
  updated_at: ISODate("2026-01-01T10:00:00Z")
}
```

The `prescriptions` collection is separate because a customer can have a history of uploads
and the bytes must never travel with a catalogue read:

```js
// collection: prescriptions
{
  _id: ObjectId("..."),
  user: ObjectId("..."),             // owner (ref: users)
  originalName: "scan.pdf",
  mimeType: "application/pdf",       // image/jpeg | image/png | application/pdf
  sizeBytes: 184220,
  status: "verified",                // pending | verified | rejected | superseded
  rejectionReason: null,
  verifiedAt: ISODate("..."),
  verifiedBy: ObjectId("..."),       // ref: users (staff/admin)
  validUntil: ISODate("..."),        // now + PRESCRIPTION_VALID_DAYS on approval
  fileData: BinData(0, "..."),       // AES-256-GCM ciphertext (select: false)
  fileIv: "…",                       // 12-byte GCM nonce
  fileAuthTag: "…"                   // GCM authentication tag
}
```

The `users` collection is deliberately separate: credentials must never be mixed into
inventory data, and it is the "who may change stock" side of the model.

### When to split it (normalisation guide)

| New requirement | Better structure |
| --------------- | ---------------- |
| Several batches of the same medicine, each with its own `mfd`/`exp`/quantity | `medicines` + embedded `batches: [{ batchNo, mfd, exp, qty }]` array |
| An audit trail — who changed stock, when, and why (sales, dispensing, wastage) | extra `stock_movements` collection: `{ medicineId, delta, reason, userId, at }` |
| Manufacturer / supplier as a real entity with contact details | `suppliers` collection referenced by `medicineId` |
| Categories, tax rules or discount rules shared by many medicines | `categories` / `tax_rules` collections referenced by `_id` |
| A medicine that exists in the catalogue but is not in stock yet | separate `products` (catalogue) from `stock` (inventory) |

Rules of thumb for MongoDB:

- **Embed** data that is always read together and is bounded — e.g. the batch list of one
  medicine belongs *inside* the medicine document.
- **Reference** data that is shared by many documents or grows without bound — users,
  suppliers, stock movements.
- Nothing joins for free in MongoDB (`$lookup` exists, but it is a per-query aggregation),
  so every split costs you a round trip. Split when a requirement above actually appears,
  not in advance.
- The moment you add "batches" or "movements", keep the *quantity* in one place only —
  either `stock` on the medicine or the sum of its batches, never both, or you reintroduce
  the duplication that normalisation exists to remove.

## API

### Auth

| Method | Endpoint | Body | Access |
| ------ | -------- | ---- | ------ |
| POST | `/api/auth/register` | `{ name, email, password }` | public → **customer only**; staff/admin require an invite |
| POST | `/api/auth/login` | `{ email, password }` | public → `{ token, user }` + refresh cookie |
| POST | `/api/auth/refresh` | – (httpOnly cookie) | rotate the refresh cookie → new `{ token, user }`; `409` means a concurrent tab won, retry |
| POST | `/api/auth/logout` | – (httpOnly cookie) | revoke this browser's session and clear the cookie |
| GET | `/api/auth/me` | – | signed in |
| GET | `/api/auth/sessions` | – | signed in → active sessions, with `current: true` for this browser |
| DELETE | `/api/auth/sessions/:id` | – | signed in → revoke one session |
| DELETE | `/api/auth/sessions` | – | signed in → revoke all sessions and access tokens |
| PATCH | `/api/auth/password` | `{ currentPassword, newPassword }` | signed in → change password and revoke all sessions |
| GET | `/api/auth/users` | – | admin (`users:manage`) |
| PATCH | `/api/auth/users/:id/role` | `{ role: "customer" \| "staff" \| "admin" }` | admin (`users:manage`) |

> Access tokens default to **15 minutes** (`JWT_ACCESS_TTL`); refresh sessions default to
> **30 days** (`REFRESH_TOKEN_TTL_DAYS`). `JWT_EXPIRES_IN` is deprecated and ignored.
> Rate limits are still in memory, so use a shared store when running multiple API
> instances.

### Back office

| Method | Endpoint | Access | Description |
| ------ | -------- | ------ | ----------- |
| POST | `/api/admin/auth/login` | public | staff/admin sign-in; customers get **403** |
| POST | `/api/admin/auth/accept-invite` | public | `{ token, name, password, email? }` → creates the invited account |
| GET | `/api/admin/summary` | staff/admin | dashboard counters (stock, customers, orders, revenue) |
| GET | `/api/admin/orders` | staff/admin | every order; `status`, `q`, `page`, `limit` |
| GET | `/api/admin/orders/:id` | staff/admin | one order with the customer |
| PATCH | `/api/admin/orders/:id/status` | staff/admin | `paid → processing → shipped → delivered`; `pending_payment → cancelled` |
| GET | `/api/admin/customers` | staff/admin | customers with order count, spend and last order |
| GET | `/api/admin/prescriptions` | staff/admin | prescription queue; `status`, `page`, `limit` (pending is oldest-first) |
| GET | `/api/admin/prescriptions/:id/file` | staff/admin | decrypted file for a verifier |
| POST | `/api/admin/prescriptions/:id/verify` | staff/admin | `{ approved: true }` or `{ approved: false, reason }` — atomic decision on a pending upload |
| POST | `/api/admin/inventory/replenish` | staff/admin | restock every medicine at/below the watermark now (FR-1.1) |
| GET | `/api/admin/audit` | admin | audit log; `action`, `page`, `limit` |
| POST | `/api/admin/invites` | admin | `{ email, role }` → one-time token + `/admin/register` link |
| GET | `/api/admin/invites` | admin | pending invites (`?includeClosed=true` for all) |
| DELETE | `/api/admin/invites/:id` | admin | revoke a pending invite |

### Stock

| Method | Endpoint | Access | Description |
| ------ | -------- | ------ | ----------- |
| GET | `/api/medicines` | public | List stock (newest first) |
| GET | `/api/medicines/:id` | public | Get a single medicine |
| POST | `/api/medicines` | **admin or staff** | Add stock (multipart/form-data) |
| PATCH | `/api/medicines/:id` | **admin or staff** | Update details and/or the stock quantity |
| DELETE | `/api/medicines/:id` | **admin or staff** | Remove a medicine from stock |
| GET | `/api/health` | public | `{ status, database }` |
| GET | `/uploads/<file>` | public | Serve an uploaded image |

`POST /api/medicines` fields (multipart/form-data):

- `name`  — e.g. `Dettol Liquid`
- `mfd`   — manufacturing date (`YYYY-MM-DD`)
- `exp`   — expiry date (`YYYY-MM-DD`, must not be earlier than `mfd`)
- `price` — number (e.g. `120.50`)
- `stock` — whole-number quantity
- `image` — image file (optional; JPEG/PNG/GIF/WEBP, max 5 MB)

### Cart

| Method | Endpoint | Access | Description |
| ------ | -------- | ------ | ----------- |
| GET | `/api/cart` | cookie / JWT | Items with live price, stock, availability, hold status and totals |
| POST | `/api/cart/items` | cookie / JWT | `{ medicineId, quantity }` — add or increment a line (takes a soft hold) |
| PATCH | `/api/cart/items/:medicineId` | cookie / JWT | `{ quantity }` — set an exact quantity (`0` removes); the same quantity refreshes a lapsed hold |
| DELETE | `/api/cart/items/:medicineId` | cookie / JWT | Remove one line and release its hold |
| DELETE | `/api/cart` | cookie / JWT | Empty the cart and release every hold it owns |
| POST | `/api/cart/merge` | **JWT** | Merge the guest cart into the account cart (releases the guest's holds first) |

A cart line holds its units for `CART_HOLD_MINUTES` (default 15). In the response, `stock` is
what **that line** can still buy (shelf stock plus the units it already holds), `held` /
`holdActive` / `heldUntil` / `holdSecondsLeft` describe its hold, and `holdExpired: true` means
the line is still in the cart but is no longer reserving anything — the UI then offers
**Refresh hold**. The cart as a whole reports the earliest deadline (`holdExpiresAt`,
`holdSecondsLeft`) and `hasExpiredHolds`.

Every mutation returns the freshly serialised cart:

```json
{
  "items": [
    {
      "medicineId": "…",
      "name": "Paracetamol",
      "image": null,
      "price": 100.25,
      "quantity": 3,
      "stock": 20,
      "available": true,
      "expired": false,
      "issue": null,
      "lineTotal": 300.75,
      "held": 3,
      "holdActive": true,
      "heldUntil": "2026-11-01T13:19:00.000Z",
      "holdSecondsLeft": 842,
      "holdExpired": false
    }
  ],
  "totals": {
    "subtotal": 300.75,
    "tax": 15.04,
    "deliveryFee": 40,
    "total": 355.79,
    "itemCount": 3,
    "currency": "INR",
    "taxRate": 0.05,
    "freeDeliveryOver": 499
  },
  "itemCount": 3,
  "lineCount": 1,
  "hasIssues": false,
  "hasExpiredHolds": false,
  "holdExpiresAt": "2026-11-01T13:19:00.000Z",
  "holdSecondsLeft": 842,
  "updatedAt": "…"
}
```

### Wishlist (signed in)

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| GET | `/api/wishlist` | Saved items with live price, stock, expiry and availability |
| POST | `/api/wishlist/items` | `{ medicineId }` — save a medicine (idempotent) |
| DELETE | `/api/wishlist/items/:medicineId` | Remove one medicine (idempotent) |
| POST | `/api/wishlist/items/:medicineId/move-to-cart` | Add to the cart with the same stock checks as `POST /api/cart/items`, then drop it from the wishlist; returns `{ wishlist, cart }` |
| DELETE | `/api/wishlist` | Empty the wishlist |

There is **one wishlist per account** and it is private to its owner (the user id always comes
from the JWT). Saving never reserves stock — only the cart does — so out-of-stock and expired
medicines can be saved; they come back with `available: false` and an `issue`, and the page
disables **Move to cart** until they are sellable. Prices and stock are read live on every
request, exactly like the cart.

### Orders & payments

| Method | Endpoint | Access | Description |
| ------ | -------- | ------ | ----------- |
| POST | `/api/orders` | **JWT** | `{ shippingAddress }` — create an order from the cart, reserve stock |
| GET | `/api/orders` | **JWT** | The caller's orders, newest first |
| GET | `/api/orders/:id` | **JWT** (owner) | One order; other users get `404` |
| POST | `/api/orders/:id/pay` | **JWT** (owner) | `{ method, details }` — `card`, `upi`, `netbanking` or `cod` |
| POST | `/api/orders/:id/cancel` | **JWT** (owner) | Cancel a `pending_payment` order and release stock |

### Account (signed in)

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| GET | `/api/me/medipoints` | `{ balance, totalEarned, pointsPer100, entries[] }` — MediPoints ledger (FR-2.4) |

### Prescriptions (signed in)

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| POST | `/api/prescriptions` | `multipart/form-data` with one `file` field (JPG/PNG/PDF, 5 MB max) — encrypted with AES-256-GCM before it is stored; one pending upload at a time |
| GET | `/api/prescriptions` | `{ prescriptions, state }` — upload history plus the derived status (`none`, `pending`, `verified`, `rejected`, `expired`, `superseded`) |
| GET | `/api/prescriptions/:id/file` | Decrypted bytes, owner or verifier only; everybody else gets `404` |

A cart containing an Rx-only medicine makes checkout return **409** until the customer has a
**verified, unexpired** prescription. Approving an upload sets
`validUntil = now + PRESCRIPTION_VALID_DAYS` and supersedes the previous verified upload, so
exactly one prescription is active. The created order snapshots both the prescription id and its
validity. Files are never written to `backend/uploads`: they live encrypted in MongoDB and are
streamed only through the authenticated route.

Every checkout also enforces the fair-use daily cap (`DAILY_PURCHASE_LIMIT`, default **10 units
per UTC day**): the cart response carries `purchaseLimit: { enabled, limit, used, remaining,
resetsAt }` and a cart that would exceed it is refused with **409** before any stock moves.
Cancelled and expired orders do not count towards the cap; `0` disables it.

Points are credited **only after a confirmed payment**, once per order (the ledger has a
unique index on `order`). Cash on delivery earns nothing until the money is collected, and a
declined card earns nothing at all. The rule is **1 point per ₹100 of the medicine subtotal**
(tax and delivery excluded) and is configurable with `MEDIPOINTS_PER_100`.

`POST /api/orders` body:

```json
{
  "shippingAddress": {
    "fullName": "Ada Sharma",
    "phone": "9876543210",
    "email": "ada@example.com",
    "line1": "1 MG Road",
    "line2": "",
    "city": "Bengaluru",
    "state": "Karnataka",
    "pincode": "560001"
  }
}
```

`POST /api/orders/:id/pay` body examples:

```json
{ "method": "card", "details": { "number": "4242424242424242", "expiry": "12/30", "cvv": "123" } }
{ "method": "upi",  "details": { "vpa": "ada@okbank" } }
{ "method": "netbanking", "details": { "bank": "hdfc" } }
{ "method": "cod" }
```

A declined payment returns **402** with `{ error, order }`, and the order stays
`pending_payment` so the customer can retry. Paying an already-paid order returns the
same order without charging again.

### Frontend pages

| Route | Page | Who |
| ----- | ---- | --- |
| `/` | Landing page with the stock list and add-to-cart buttons | everyone |
| `/cart` | Cart: quantities, availability warnings, totals | everyone (guest cookie or signed in) |
| `/wishlist` | Wishlist: saved medicines, move to cart, remove | signed in |
| `/prescriptions` | Upload a prescription, see verification status and history | signed in |
| `/login` | Customer sign in / create account | everyone |
| `/admin/login` | Staff / administrator sign-in | everyone (customers rejected) |
| `/admin/register` | Accept a single-use invite link (`?invite=…`) | invite holders |
| `/admin` | Admin dashboard: counters + recent orders | staff / admin |
| `/admin/stock` | Add, re-stock and delete medicines | staff / admin |
| `/admin/orders` | All orders, filters, fulfilment transitions, detail modal | staff / admin |
| `/admin/prescriptions` | Prescription verification queue: open the file, approve or reject | staff / admin |
| `/admin/customers` | Customer list with order count and spend | staff / admin |
| `/admin/invites` | Create / revoke staff and admin invites | admin |
| `/admin/audit` | Audit log with before/after details | admin |
| `/checkout` | Shipping address + place order | signed in |
| `/orders/:id/payment` | Payment method form + sandbox gateway | order owner |
| `/orders/:id/confirmation` | Receipt: status, items, address, totals | order owner |
| `/orders` | Order history with status chips | signed in |
| `/add` | Legacy add-medicine form (the console uses `/admin/stock`) | staff / admin |

### Example with curl

```bash
# 1. Sign in and keep the token
TOKEN=$(curl -s -X POST http://localhost:5000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"admin-pass-123"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')

# 2. Add stock (staff/admin — omit the header and you get 401)
curl -X POST http://localhost:5000/api/medicines \
  -H "Authorization: Bearer $TOKEN" \
  -F "name=Dettol Liquid" \
  -F "mfd=2025-01-15" \
  -F "exp=2027-01-15" \
  -F "price=120.50" \
  -F "stock=50" \
  -F "image=@/path/to/dettol.jpg"

# 3. Adjust the quantity later
curl -X PATCH http://localhost:5000/api/medicines/<id> \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"stock":42}'
```

## Tests

```bash
cd backend
npm test
```

The suite starts a real in-memory MongoDB (`mongodb-memory-server`) and the real Express app,
then exercises registration, login, 401/403 permission checks, stock CRUD, validation,
image upload and 404s. `tests/cart-orders.test.js` covers the signed cart cookie,
guest-cart merge, quantity/stock/expiry validation, server-side totals, checkout and stock
reservation, rollback, card/UPI/net-banking/COD payments, declines and retries, cancellation,
expiry, ownership checks and order history. `tests/sessions.test.js` covers refresh-token
rotation, reuse detection and revocation, and `tests/admin.test.js` covers the role split,
staff stock rights, invite creation/acceptance/expiry, order fulfilment transitions, customer
stats and the audit log. `tests/inventory.test.js` covers the low-stock watermark, expired
stock being skipped, the configurable watermark/target, the concurrent-sweep guard, RBAC on
the manual restock endpoint and the audit entry, and `tests/medipoints.test.js` covers the
per-₹100 rule, credit-only-after-payment, one entry per order, COD/failed payments earning
nothing and per-customer isolation. `tests/wishlist.test.js` covers saving, idempotency,
live price/stock/expiry flags, per-account privacy, move-to-cart (including incrementing an
existing cart line and refusing at the stock limit), removal, clearing and deleted medicines.
`tests/cart-holds.test.js` covers the hold service itself (atomic stock → held move, overdraw
refusal, two carts racing for the last units, release guards, hold → sale conversion and its
restore, sweeper idempotency and concurrency, and the legacy-row migration), while
`tests/cart-holds-api.test.js` covers the same behaviour over HTTP (hold on add, increment,
quantity deltas, removal, clearing, the per-line limit, a second shopper being locked out,
lazy expiry, hold renewal, the sign-in merge, checkout/cancel and a failed checkout rolling
the earlier holds back). `tests/prescriptions.test.js` covers AES-256-GCM round-trips and tamper
detection, the upload allowlist (type, size, one pending upload), encryption at rest (no
plaintext in MongoDB), owner/verifier-only file access, the verification queue, approval and
rejection (including the validity window and superseding), the checkout gate for
missing/rejected/expired prescriptions and the order snapshot. `tests/purchase-limit.test.js`
covers env parsing, UTC-day boundaries, counted statuses, the cart summary and enforcement at
checkout (over-cap refusal without moving stock, exact-cap success, cancelled orders freeing
allowance and `0` disabling the cap).
**No MongoDB installation is required to run it.**

## Deployment

The prototype is deployed as a **single Netlify site + MongoDB Atlas**: the Vite SPA is
built to static files and the Express API runs as a **Netlify Function**
(`netlify/functions/api.js` → `backend/netlify.js`, via `serverless-http`). Requests to
`/api/*` and `/uploads/*` are rewritten to that function, so the browser sees one origin and
the `SameSite=Lax` cart/refresh cookies keep working. Uploaded medicine images go to
**Netlify Blobs** (function disks are temporary); prescription files never touch the disk at
all — they are encrypted in MongoDB. `netlify.toml` holds the build, the function rewrites and
the SPA fallback.

| Piece | Host | Notes |
| ----- | ---- | ----- |
| React SPA | Netlify | `netlify.toml`: builds `frontend/`, publishes `frontend/dist` |
| Express API | Netlify Function | `netlify/functions/api.js` → `backend/netlify.js`; `/api/*` + `/uploads/*` rewritten to it |
| Uploaded images | Netlify Blobs | `medicine-images` store; the 30 demo images are bundled from `backend/uploads/seed-*.svg` |
| Database | MongoDB Atlas M0 | `MONGODB_URI`; allow `0.0.0.0/0` in Atlas because functions have no fixed egress IPs |

Minimum environment variables (Netlify → **Project configuration → Environment variables**):

```
NODE_ENV=production
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/meditrack?retryWrites=true&w=majority
JWT_SECRET=<long random value>
COOKIE_SECRET=<another long random value, different from JWT_SECRET>
RX_ENCRYPTION_KEY=<64 hex characters>
PAYMENT_PROVIDER=mock
# CORS_ORIGIN=https://<custom-domain>,https://<branch>--<site>.netlify.app
```

`CORS_ORIGIN` is **optional for the standard same-origin deploy**: the API also accepts an
`Origin` whose host matches `X-Forwarded-Host`/`Host`. Add every extra exact origin (custom
domain, branch/deploy previews) if they call the API, otherwise those POST/PATCH/DELETE
requests get **403** while GETs still work. The full runbook — including the alternative
long-running Render service, which is still the way to get the background restock/hold
sweeps — is in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

In a serverless function the interval sweepers do not run: lapsed cart holds are released
lazily when a cart is read, and an admin can restock from `/admin` (or
`POST /api/admin/inventory/replenish`). Prescription uploads are capped at 5 MB, under
Netlify's request-payload limit.

After the first deploy, seed the administrator and the demo catalogue against the deployed
database, then run the smoke test against the **public** URL:

```bash
cd backend
MONGODB_URI='<atlas uri>' ADMIN_EMAIL='admin@example.com' \
  ADMIN_PASSWORD='a-long-password' ADMIN_NAME='Store Admin' npm run seed:admin
MONGODB_URI='<atlas uri>' npm run seed:data   # 30 products / 7 categories + images
MONGODB_URI='<atlas uri>' npm run seed:demo   # optional inventory-focused rows
npm run smoke:deploy -- https://<site>.netlify.app
```

`smoke:deploy` checks the health endpoint, the catalogue, the SPA fallback and the
`Origin`/CORS behaviour (a login attempt must return **401**, not 403).

## SRS traceability

Where each requirement is implemented. Update the "Status" column as later phases land.

| Requirement | Status | Implementation | Test |
| ----------- | ------ | -------------- | ---- |
| FR-1.1 replenish at watermark 10 → 100 | ✅ | `lib/inventory.js`, sweep in `server.js`, `POST /api/admin/inventory/replenish` | `tests/inventory.test.js` |
| FR-1.2 atomic soft hold on add-to-cart | ✅ | `lib/cartHolds.js`, `setLineQuantity()` in `lib/cartSession.js`, `routes/cart.js` | `tests/cart-holds.test.js`, `tests/cart-holds-api.test.js` |
| FR-1.3 release an expired hold | ✅ | `releaseExpiredHolds()` + sweeper in `server.js`, lazy release in `loadLiveCart()` | `tests/cart-holds.test.js`, `tests/cart-holds-api.test.js` |
| FR-1.4 flag Rx-only medicines and block billing | ✅ | `prescriptionRequired` + `category`/`description` on `models/Medicine.js`; `lib/prescriptions.js`, `routes/prescriptions.js`, `lib/purchaseLimit.js`; Rx badges in `MedicineList.jsx`/`Cart.jsx`; `/prescriptions` page | `tests/prescriptions.test.js`, `tests/purchase-limit.test.js`, `tests/inventory.test.js` |
| FR-1.5 Wishlist separate from Cart | ✅ | `models/Wishlist.js`, `lib/wishlist.js`, `routes/wishlist.js`, `pages/Wishlist.jsx`, `context/WishlistContext.jsx` | `tests/wishlist.test.js` |
| FR-1.6 customer registration | ✅ | `routes/auth.js` | `tests/api.test.js` |
| FR-1.7 customer login | ✅ | `routes/auth.js`, `lib/sessions.js` | `tests/api.test.js`, `tests/sessions.test.js` |
| FR-2.1 block checkout until Rx verified | ✅ | `prescriptionForCheckout()` in `lib/prescriptions.js`, called before any counter moves in `lib/orderService.js`; `/prescriptions` upload + `/admin/prescriptions` queue | `tests/prescriptions.test.js` |
| FR-2.2 failed payment leaves inventory/order unchanged | ✅ | `lib/orderService.js`, `routes/orders.js` | `tests/cart-orders.test.js` |
| FR-2.3 UPI / debit / credit / net banking (sandbox) | ✅ | `lib/providers/mockPayment.js` | `tests/cart-orders.test.js` |
| FR-2.4 MediPoints only after successful payment | ✅ | `lib/medipoints.js`, `models/MediPointsEntry.js`, `GET /api/me/medipoints` | `tests/medipoints.test.js` |
| FR-2.5 refill reminder routes to teleconsultation | 🚧 planned (Phase E) | `refillDays` field added in Phase A | `tests/inventory.test.js` |
| FR-2.6 immutable purchase history | ✅ / ⚠️ | order snapshots (`models/Order.js`, including `prescription` + `prescriptionValidUntil`); schema-level immutability guard in Phase F | `tests/cart-orders.test.js`, `tests/prescriptions.test.js` |
| NFR-1.1 RBAC on every protected request | ✅ | `middleware/auth.js`, `lib/permissions.js` (`prescriptions:verify` for staff/admin) | `tests/api.test.js`, `tests/admin.test.js`, `tests/prescriptions.test.js` |
| NFR-1.2 bcrypt + JWT with expiry | ✅ | `models/User.js`, `lib/sessions.js` | `tests/sessions.test.js` |
| NFR-1.3 append-only audit log | ✅ / ⚠️ | `lib/audit.js` (prescription upload/verify/reject recorded); no update/delete routes; model guard in Phase F | `tests/admin.test.js`, `tests/inventory.test.js`, `tests/prescriptions.test.js` |
| NFR-1.4 tokens / Rx data encrypted at rest | ✅ | refresh tokens hashed (`lib/sessions.js`); prescription files AES-256-GCM in MongoDB with `RX_ENCRYPTION_KEY`; no card data beyond brand + last4 | `tests/sessions.test.js`, `tests/prescriptions.test.js` |
| NFR-2.1 atomic inventory reservation | ✅ | one conditional update per line: `lib/cartHolds.js` (hold), `lib/orderService.js` (hold → sale + rollback) | `tests/cart-holds.test.js`, `tests/cart-holds-api.test.js` |
| NFR-2.2 hold time + Rx status shown at checkout | ✅ | hold countdowns on `/cart`, `/checkout` and `/orders/:id/payment`; `serializeCart()` exposes `requiresPrescription`/`prescription`/`purchaseLimit`; `PrescriptionNotice` + `PurchaseLimitNotice` | `tests/cart-holds-api.test.js`, `tests/prescriptions.test.js`, `tests/purchase-limit.test.js` |
| §4.5 simulated QR/barcode | 🚧 planned (Phase F) | — | — |

## Notes

- **Cloud or local MongoDB both work** — the app only reads `MONGODB_URI`, so an Atlas
  `mongodb+srv://…` string and `mongodb://127.0.0.1:27017/meditrack` are interchangeable.
  Run `npm run db:check` to confirm a string before starting the server.
- `db.js` falls back to `mongodb://127.0.0.1:27017/meditrack` when `MONGODB_URI` is not set.
- If `JWT_SECRET` is missing in development the server logs a warning and uses an insecure
  fallback; in **production it refuses to start** unless `JWT_SECRET` and `COOKIE_SECRET`
  are set (see `backend/.env.example`).
- `COOKIE_SECRET` signs the `mt_cart` cookie. It has its own development fallback; set a
  long random value (different from `JWT_SECRET`) in production.
- Authentication endpoints are rate limited in memory. Behind a load balancer with more
  than one backend instance, point `express-rate-limit` at a shared store so the limits
  apply across instances.
- **`CORS_ORIGIN` is only needed for split origins.** A same-origin deploy (Netlify SPA +
  function, or an SPA served by the API host) is accepted because the API compares the
  `Origin` host with `X-Forwarded-Host`/`Host`. For a custom domain, branch deploy or a
  frontend on another host, list every exact origin (comma separated); otherwise those
  POST/PATCH/DELETE requests get 403 while GETs still work, which makes the failure look
  like a login bug. Cart/refresh cookies are `SameSite=Lax`, so a cross-site frontend needs
  more than a CORS entry.
- **Deployment** (single-origin Netlify site + Atlas, with a long-running Render API as the
  alternative for background sweeps) is documented end-to-end in
  [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md): build/function settings, the required
  environment variables, `npm run seed:admin` / `npm run seed:data` / `npm run seed:demo`,
  Netlify Blobs image storage, the Render keep-warm ping (15-minute spin-down, ephemeral
  disk; Netlify's proxy times out after 26 seconds) and `npm run smoke:deploy`.
  In production the server refuses to start without `JWT_SECRET` and `COOKIE_SECRET`.
- **`EADDRINUSE: address already in use :::5000`** — an old backend (or another app) is
  still bound to the port. The server now reports this cleanly instead of crashing. Find and
  stop it with `lsof -nP -iTCP:5000 -sTCP:LISTEN` then `kill <PID>` (or `npx kill-port 5000`),
  or run on another port with `PORT=5001 npm run dev` and update the proxy in
  `frontend/vite.config.js` to match.
- **Payments are sandboxed by default** (`PAYMENT_PROVIDER=mock`). No real charge is made;
  see the demo card/UPI rules above. Swap the provider through the adapter for real
  payments.
- Documents are serialised with `id` (mapped from `_id`) so the React app keeps using `m.id`.
- Stale uploaded images are deleted from disk when a medicine is removed or its image replaced.
- The currency symbol (₹) is only used for display; change it in the frontend if needed.

