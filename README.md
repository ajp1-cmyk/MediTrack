# 💊 MediTrack

A medicine inventory **and storefront** project: staff manage stock, customers browse the
catalogue, add medicines to a cart, check out, and pay on a sandbox payment page.

- **Frontend:** React (Vite) + React Router
- **Backend:** Node.js + Express
- **Database:** MongoDB via Mongoose — `medicines`, `users`, `carts`, `orders`, `sessions`,
  `admininvites` and `auditlogs` collections
- **Auth:** JWT (`jsonwebtoken`) with bcrypt-hashed passwords (`bcryptjs`)
- **Cart session:** signed, httpOnly cookie + server-side cart document (`cookie-parser`)
- **Payments:** provider adapter with a built-in sandbox gateway (`PAYMENT_PROVIDER=mock`)
- **Image upload:** multer (saved to `backend/uploads/`)

## Project structure

```
meditrack/
├── backend/
│   ├── server.js              # Express app + CORS + cookies + routes + error handler
│   ├── db.js                  # MongoDB connection (Mongoose)
│   ├── models/
│   │   ├── Medicine.js        # the stock collection ("medicines")
│   │   ├── User.js            # accounts + roles (customer / staff / admin)
│   │   ├── Cart.js            # guest / user carts (server-side)
│   │   ├── Order.js           # order snapshots + payment state
│   │   ├── Session.js         # refresh-token sessions (hashed, rotating)
│   │   ├── AdminInvite.js     # single-use staff/admin invites (hashed)
│   │   └── AuditLog.js        # append-only back-office audit trail
│   ├── middleware/
│   │   ├── auth.js            # requireAuth, requireRole, requirePermission, JWT signing
│   │   ├── rateLimit.js       # brute-force limits for login / registration
│   │   └── requestGuards.js   # reject cross-site form posts
│   ├── lib/
│   │   ├── errors.js          # httpError + asyncHandler helpers
│   │   ├── mongoErrors.js     # local/cloud connection hints + password redaction
│   │   ├── availability.js    # expired / out-of-stock checks
│   │   ├── pricing.js         # paise-accurate subtotal, GST, delivery, total
│   │   ├── cartSession.js     # signed cookie, cart lookup/merge, serialisation
│   │   ├── sessions.js        # refresh cookie, rotation, reuse detection
│   │   ├── permissions.js     # role → permission map (shared with the SPA)
│   │   ├── invites.js         # create/accept/revoke admin+staff invites
│   │   ├── audit.js           # recordAudit + paginated audit list
│   │   ├── migrations.js      # one-time data migrations (staff → customer)
│   │   ├── orderService.js    # checkout, stock reservation/rollback, expiry
│   │   ├── paymentGateway.js  # provider registry + charge()
│   │   └── providers/
│   │       └── mockPayment.js # sandbox gateway (deterministic test cards)
│   ├── scripts/
│   │   ├── check-db.js        # `npm run db:check` — verify MONGODB_URI (local or cloud)
│   │   ├── local-mongo.js     # `npm run db:local` — no-install local MongoDB
│   │   ├── seed-admin.js      # `npm run seed:admin` — create/promote the first admin
│   │   └── migrate-roles.js   # `npm run migrate:roles` — apply pending data migrations
│   ├── routes/
│   │   ├── auth.js            # register / login / refresh / logout / sessions / users
│   │   ├── adminAuth.js       # public back-office login + invite acceptance
│   │   ├── admin.js           # summary / orders / customers / audit / invites
│   │   ├── medicines.js       # stock CRUD + image upload (staff + admin)
│   │   ├── cart.js            # cart endpoints
│   │   └── orders.js          # checkout, order history, pay, cancel
│   ├── tests/                 # API tests (stock, auth sessions, admin/roles, cart, payments)
│   ├── uploads/               # (created at runtime) uploaded images
│   └── .env.example           # environment template
└── frontend/
    └── src/
        ├── App.jsx                        # router + providers + layout
        ├── context/
        │   ├── AuthContext.jsx            # signed-in user, silent refresh, logout
        │   └── CartContext.jsx            # cart state + merge-on-login + dialog state
        ├── lib/
        │   ├── api.js                     # fetch wrapper (memory JWT + refresh) + APIs
        │   └── format.js                  # currency, dates, status labels
        ├── components/
        │   ├── Navbar.jsx                 # nav + cart badge + user chip
        │   ├── ProtectedRoute.jsx         # role-guarded routes
        │   ├── MedicineForm.jsx           # stock entry form
        │   ├── MedicineList.jsx           # stock list + add-to-cart buttons
        │   ├── Modal.jsx                  # accessible native <dialog> wrapper
        │   ├── AddToCartDialog.jsx        # quantity + confirmation dialog
        │   ├── QuantityStepper.jsx        # −/+ control
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
            └── admin/
                ├── AdminLogin.jsx         # separate back-office sign-in
                ├── AdminDashboard.jsx     # counters + recent orders
                ├── AdminStock.jsx         # add / stock-edit / delete medicines
                ├── AdminOrders.jsx        # all orders + fulfilment transitions
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
needs (`medicines`, `users`, `carts`, `orders`). If the connection fails it tells you what to
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
# CORS_ORIGIN=https://shop.example.com   # only for cross-origin deployments
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

| Who | Browse stock | Add to cart | Checkout / pay | View orders |
| --- | ------------ | ----------- | -------------- | ----------- |
| Anonymous visitor | ✅ | ✅ (cookie cart) | ❌ — sign in first | ❌ |
| `customer` | ✅ | ✅ | ✅ | ✅ (own orders) |
| `staff` / `admin` | ✅ | ✅ | ✅ | ✅ (own orders) |

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
allows credentials for the origins listed in `CORS_ORIGIN`. With the Vite dev proxy the
app is same-origin, so cookies work out of the box.

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
- On checkout, each line is reserved with a conditional update
  (`{ stock: { $gte: qty } } → $inc: { stock: -qty }`). If a later line fails, every earlier
  reservation in that checkout is rolled back, so an order is never partially placed.
- A pending order holds its stock for `ORDER_RESERVATION_MINUTES` (default 30). Paying
  clears the deadline; cancelling or letting it lapse releases the stock exactly once
  (atomic status transition, so a race cannot double-restore).

### Payment provider

Routes call only `lib/paymentGateway.js → charge({ order, method, details })`. The default
provider is the built-in sandbox (`PAYMENT_PROVIDER=mock`), so no API keys or network access
are needed:

| Method | Demo behaviour |
| ------ | -------------- |
| Card | `4242 4242 4242 4242` succeeds; any Luhn-valid number ending in `02` is declined; expiry must be `MM/YY` and in the future |
| UPI | `name@bank` succeeds; `fail@bank` is declined |
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
  mfd: "2025-01-15",                 // manufacturing date (YYYY-MM-DD)
  exp: "2027-01-15",                 // expiry date (YYYY-MM-DD)
  price: 120.5,
  stock: 50,                         // quantity on hand (whole number)
  image: "medicine-1726312345-1234.png",
  createdBy: ObjectId("..."),        // ref: users
  created_at: ISODate("2026-01-01T10:00:00Z"),
  updated_at: ISODate("2026-01-01T10:00:00Z")
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
| GET | `/api/cart` | cookie / JWT | Items with live price, stock, availability and totals |
| POST | `/api/cart/items` | cookie / JWT | `{ medicineId, quantity }` — add or increment a line |
| PATCH | `/api/cart/items/:medicineId` | cookie / JWT | `{ quantity }` — set an exact quantity (`0` removes) |
| DELETE | `/api/cart/items/:medicineId` | cookie / JWT | Remove one line |
| DELETE | `/api/cart` | cookie / JWT | Empty the cart |
| POST | `/api/cart/merge` | **JWT** | Merge the guest cart into the account cart |

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
      "lineTotal": 300.75
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
  "updatedAt": "…"
}
```

### Orders & payments

| Method | Endpoint | Access | Description |
| ------ | -------- | ------ | ----------- |
| POST | `/api/orders` | **JWT** | `{ shippingAddress }` — create an order from the cart, reserve stock |
| GET | `/api/orders` | **JWT** | The caller's orders, newest first |
| GET | `/api/orders/:id` | **JWT** (owner) | One order; other users get `404` |
| POST | `/api/orders/:id/pay` | **JWT** (owner) | `{ method, details }` — `card`, `upi` or `cod` |
| POST | `/api/orders/:id/cancel` | **JWT** (owner) | Cancel a `pending_payment` order and release stock |

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
| `/login` | Customer sign in / create account | everyone |
| `/admin/login` | Staff / administrator sign-in | everyone (customers rejected) |
| `/admin/register` | Accept a single-use invite link (`?invite=…`) | invite holders |
| `/admin` | Admin dashboard: counters + recent orders | staff / admin |
| `/admin/stock` | Add, re-stock and delete medicines | staff / admin |
| `/admin/orders` | All orders, filters, fulfilment transitions, detail modal | staff / admin |
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
reservation, rollback, card/UPI/COD payments, declines and retries, cancellation, expiry,
ownership checks and order history. `tests/sessions.test.js` covers refresh-token rotation,
reuse detection and revocation, and `tests/admin.test.js` covers the role split, staff stock
rights, invite creation/acceptance/expiry, order fulfilment transitions, customer stats and
the audit log.
**No MongoDB installation is required to run it.**

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
- Set `CORS_ORIGIN` (comma separated) when the frontend and API are on different origins;
  CORS must allow credentials for the cart cookie to travel.
- **Deploying** the backend to a host (Render, Railway, Fly.io, a VPS…) means setting at
  least `MONGODB_URI`, `JWT_SECRET`, `COOKIE_SECRET`, `NODE_ENV=production` and, if the
  platform requires it, `PORT`. Add `CORS_ORIGIN` when the built frontend is served from
  another origin. Create the first administrator with `npm run seed:admin` (or promote an
  existing account), then use `/admin/invites` for further staff/admin accounts. In
  production the server refuses to start without `JWT_SECRET` and `COOKIE_SECRET`. The
  Atlas cluster must allow the host's IP (or `0.0.0.0/0`), and the frontend should point at
  the deployed API instead of the Vite proxy.
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

