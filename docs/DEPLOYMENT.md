# Deployment runbook — Netlify (SPA + Function) + MongoDB Atlas

MediTrack runs as **one public origin**: a Netlify site serves the Vite SPA and runs the
Express API as a Netlify Function.

```
browser ──► https://<site>.netlify.app
              │  /api/*      ──► /.netlify/functions/api   (Express via serverless-http)
              │  /uploads/*  ──► same function ──► MongoDB `medicineimages` (image bytes)
              └─ everything else ─► /index.html            (SPA fallback)
                                   │
                                   └─ MongoDB Atlas (M0)
```

| Piece | Host | Configuration |
| ----- | ---- | ------------- |
| React SPA | Netlify | `netlify.toml`: build `frontend/`, publish `frontend/dist` |
| Express API | Netlify Function | `netlify/functions/api.js` → `backend/netlify.js`; `/api/*` + `/uploads/*` rewritten to it |
| Uploaded images | MongoDB | `medicineimages` collection (bytes), `medicines.image` (file name). `npm run seed:data` mirrors the 30 demo SVGs; Netlify Blobs and the bundled files are fallbacks |
| Prescription files | MongoDB | AES-256-GCM ciphertext in the `prescriptions` collection — never disk or Blobs |
| Database | MongoDB Atlas M0 | `MONGODB_URI` |

Why one origin: the SPA calls `/api/...` with relative URLs and keeps the cart/refresh tokens
in `SameSite=Lax` cookies (`backend/lib/cartSession.js`, `backend/lib/sessions.js`). A single
origin means no `SameSite=None`, no third-party-cookie problems and no CORS preflight.

> **Two ways to run the API.**
>
> 1. **Netlify Function (default in this repo).** Cheap, scales to zero, one origin, images in
>    MongoDB (`medicineimages`). The interval sweepers do not run: lapsed cart holds are
>    released lazily when a cart is read, and an admin restocks from `/admin` (or
>    `POST /api/admin/inventory/replenish`).
> 2. **Render web service (section 8).** A long-running process keeps the background
>    restock/hold sweeps and the on-disk `uploads/` route. Point `netlify.toml` back at it with
>    the proxy rules shown there.

---

## 0. Prerequisites

- The repository pushed to GitHub/GitLab/Bitbucket.
- A MongoDB Atlas cluster (free **M0** is enough).
- A Netlify account.
- Node 22 locally, for `seed:admin`, `seed:data`, `seed:demo`, `db:check` and `smoke:deploy`.

---

## 1. Database (MongoDB Atlas)

The app only reads `MONGODB_URI`, so the same code works against Atlas.

1. **Network Access** → add `0.0.0.0/0`: Netlify Functions have no fixed egress IPs.
2. Put the database name in the URI path (…`mongodb.net/meditrack_prod?retryWrites=true…`).
   If the path is omitted the app falls back to `MONGODB_DB` (default `meditrack`).
3. URL-encode special characters in the password: `@ → %40`, `# → %23`, `/ → %2F`,
   `: → %3A`, `? → %3F`, `% → %25`.
4. Verify the string before deploying:

   ```bash
   cd backend
   MONGODB_URI='mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/meditrack_prod?retryWrites=true&w=majority' \
     npm run db:check
   ```

   It prints the host (password redacted), the database in use, the collections, their document
   counts and creates the indexes (`medicines`, `users`, `carts`, `wishlists`, `orders`,
   `sessions`, `admininvites`, `medipointsentries`, `auditlogs`, `prescriptions`).

---

## 2. Secrets

Generate three different values:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # COOKIE_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # RX_ENCRYPTION_KEY
```

- `JWT_SECRET` signs access tokens.
- `COOKIE_SECRET` signs the `mt_cart` cookie (must differ from `JWT_SECRET`).
- `RX_ENCRYPTION_KEY` encrypts prescription files (64 hex characters = 32 bytes). **Set it
  before the first upload.** Without it a key is derived from `JWT_SECRET`, so rotating
  `JWT_SECRET` would make existing prescriptions unreadable.

In production the server refuses to start without `JWT_SECRET` and `COOKIE_SECRET`
(`backend/server.js`), and cookies become `Secure`.

---

## 3. Netlify project (default deployment)

1. **Add new site → Import an existing project** → choose the repository.
2. Netlify reads the committed `netlify.toml`:

   | Setting | Value |
   | ------- | ----- |
   | Build command | `npm --prefix backend ci --omit=dev && npm --prefix frontend ci && npm --prefix frontend run build` |
   | Publish directory | `frontend/dist` |
   | Functions directory | `netlify/functions` |
   | Node version | `22` |

   The same file rewrites `/api/*` and `/uploads/*` to `/.netlify/functions/api`, bundles
   `backend/uploads/**` with the function (demo images) and ends with the SPA fallback
   (`/* → /index.html`).
3. Add environment variables under **Project configuration → Environment variables**:

   | Key | Value |
   | --- | ----- |
   | `NODE_ENV` | `production` |
   | `MONGODB_URI` | `mongodb+srv://…/meditrack_prod?retryWrites=true&w=majority` |
   | `JWT_SECRET` | generated in step 2 |
   | `COOKIE_SECRET` | generated in step 2 |
   | `RX_ENCRYPTION_KEY` | 64 hex characters (step 2) |
   | `PRESCRIPTION_VALID_DAYS` | `365` |
   | `DAILY_PURCHASE_LIMIT` | `10` (units per UTC day; `0` disables) |
   | `PAYMENT_PROVIDER` | `mock` |
   | `PAYMENT_MOCK_DELAY_MS` | `700` (or `0` for a snappier demo) |
   | `CART_HOLD_MINUTES` | `15` |
   | `CORS_ORIGIN` | optional — see below |

   `MEDITRACK_SERVERLESS=1` is set automatically by `backend/netlify.js`; do not set it
   yourself. The function returns a **500** that names any missing required variable.

4. **`CORS_ORIGIN` is optional for the standard deploy.** The API accepts an `Origin` whose
   host matches `X-Forwarded-Host`/`Host`, so the Netlify SPA calling the function on the same
   domain is fine. Add every *extra* exact origin (custom domain, branch deploys, deploy
   previews — `https://branch--site.netlify.app`) if those call the API; matching is exact, not
   wildcard. An unlisted split origin shows up as **403 `Origin not allowed by CORS`** on
   sign-in/cart/checkout while GETs still work.
5. Deploy. `backend/netlify.js` connects to MongoDB once per warm instance, runs
   `runMigrations()` and then hands the event to Express.

First deploy, then check:

```bash
curl -s https://<site>.netlify.app/api/health
# {"status":"ok","database":"connected"}
```

---

## 4. Seed the deployed database

Run these locally against the production URI — no shell access to the host is needed
(PowerShell: set variables with `$env:NAME='value'` first).

```bash
cd backend

# First administrator (public signup is customer-only).
MONGODB_URI='mongodb+srv://…/meditrack_prod?retryWrites=true&w=majority' \
ADMIN_EMAIL='admin@example.com' \
ADMIN_PASSWORD='a-long-password' \
ADMIN_NAME='Store Admin' \
  npm run seed:admin

# 30 products across 7 categories, with descriptions and images.
# The images are committed to backend/uploads and bundled with the function;
# the seeder writes the files locally too, for development.
MONGODB_URI='mongodb+srv://…/meditrack_prod?retryWrites=true&w=majority' \
  npm run seed:data

# Optional smaller inventory-focused seed (Rx-only, low stock, near expiry).
MONGODB_URI='mongodb+srv://…/meditrack_prod?retryWrites=true&w=majority' \
  npm run seed:demo
```

Customers register themselves at `/login`; staff and further administrators are invited from
`/admin/invites` after signing in at `/admin/login`.

---

## 5. Verify the deployment

Automated (run against the **public Netlify URL**):

```bash
cd backend
npm run smoke:deploy -- https://<site>.netlify.app
```

It checks the health endpoint, the catalogue, the SPA fallback and the `Origin`/CORS behaviour
(a login `POST` must return **401**, not 403).

Manual checks:

```bash
# API + database through the function rewrite
curl -s https://<site>.netlify.app/api/health
curl -s https://<site>.netlify.app/api/medicines | head -c 300

# A demo image is served by the function (from MongoDB or the bundled files)
curl -sI https://<site>.netlify.app/uploads/seed-paracetamol-500mg.svg | grep -i content-type

# Browser-like POST: 401 means the request reached the API; 403 means an origin is blocked
curl -i -X POST https://<site>.netlify.app/api/auth/login \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://<site>.netlify.app' \
  -d '{"email":"nobody@example.com","password":"wrong"}'

# Live API data must never be cached
curl -sI https://<site>.netlify.app/api/medicines | grep -i 'cache-control'  # no-store
```

Browser walkthrough:

1. `/` lists the 30 seeded products with images, category chips and descriptions.
2. Register a customer → reload the page (silent refresh keeps you signed in).
3. Add an OTC medicine → `/cart` → checkout → pay with `4242 4242 4242 4242` →
   confirmation, order history and MediPoints credit.
4. Upload a prescription at `/prescriptions`, approve it at `/admin/prescriptions`, then add an
   Rx medicine and check out. A pending, rejected or expired prescription must block checkout
   with an explanatory notice.
5. Set `DAILY_PURCHASE_LIMIT=1` in a preview environment and place two single-unit orders: the
   second checkout must return **409** without changing stock; the cart shows the allowance.
6. `/admin/login` as the seeded administrator → invite a staff account → `/admin/stock` create
   a medicine **with an image** (stored in MongoDB `medicineimages`) → replenish → audit log shows the
   prescription and stock entries.
7. Refresh `/orders` directly (SPA fallback) and confirm the site is served over HTTPS.

---

## 6. Troubleshooting

| Symptom | Cause / fix |
| ------- | ----------- |
| `500 Server is not configured: set …` | A required Netlify environment variable is missing (`MONGODB_URI`, `JWT_SECRET`, `COOKIE_SECRET`). Add it and redeploy. |
| `503 Could not connect to the database` | Atlas blocked the function (`0.0.0.0/0`), the password is wrong/unescaped, or the URI path is wrong. Run `npm run db:check` locally with the same URI. |
| `403 {"error":"Origin not allowed by CORS"}` on POST/PATCH/DELETE | The standard same-origin deploy is allowed automatically; a **split** frontend/custom domain is not. Add the exact origin to `CORS_ORIGIN` and redeploy. |
| First request after idle is slow / a timed-out function | Netlify starts cold functions on demand; retry once. Keep frequently used functions warm if the demo needs instant responses. |
| `413` or a dropped upload | The function request body is limited to ~6 MB. Prescription uploads are capped at 5 MB and medicine images at 5 MB; downsize the file. |
| `/uploads/<file>` returns 404 | The image is not in `medicineimages`, not in Netlify Blobs and not in the bundled `backend/uploads/`. Re-run `MONGODB_URI='<atlas uri>' npm run seed:data` to mirror the demo SVGs, or re-upload the image from `/admin/stock`. |
| Catalogue shows stale stock | A cache stored a GET. The API sets `Cache-Control: no-store` on `/api/*` (`backend/server.js`); redeploy if that middleware is missing. |
| Cookies not stored | Serving over plain HTTP, or `NODE_ENV` is not `production` (cookies are `Secure` only in production). |
| 404 when refreshing `/orders` | The SPA fallback rule is missing or is not last in `netlify.toml`. |
| Netlify build fails on `npm ci` | Both lockfiles must be committed: `backend/package-lock.json` and `frontend/package-lock.json`. |
| `Refusing to start in production without …` (local/Render) | `JWT_SECRET` / `COOKIE_SECRET` missing. |
| Prescription file returns `could not be decrypted` | `RX_ENCRYPTION_KEY` changed (or was not set and `JWT_SECRET` rotated). Restore the original key; the file cannot be recovered otherwise. |
| Restock/hold sweeps do not run | Expected in function mode. Holds are released lazily on cart reads; restock from `/admin` or use the Render alternative (section 8). |

---

## 7. Free-tier behaviour (worth stating in the report)

- **Netlify Functions**: invocation and runtime limits on the free plan (synchronous requests
  time out after 10 seconds), ~6 MB request payloads, and Blobs quota. Static assets are served
  from the CDN; API responses are explicitly `no-store`. Image bytes count towards the 512 MB
  Atlas M0 limit, so re-uploading the same picture repeatedly is worth avoiding.
- **Atlas M0**: shared cluster, no backups, 512 MB storage.
- Rate limits are in-memory (`express-rate-limit`). In function mode several instances can be
  warm, so the limits are approximate; a strict deployment needs a shared store. Behind
  Netlify the client IP arrives in `X-Forwarded-For` (`trust proxy` is enabled in production).
- Payments are the sandbox provider (`PAYMENT_PROVIDER=mock`); no real charge and no card data
  beyond brand + last four digits.
- No monitoring, alerting or backup procedure is configured beyond the Netlify function logs,
  deploy logs and the health check.
- The always-on alternative (Render) keeps the interval sweepers but adds a cold-start delay
  and an ephemeral disk.

---

## 8. Alternative: API on Render (long-running)

Use this when the demo needs the background restock/hold sweeps or an always-warm API.

**New → Web Service** from the repository:

| Setting | Value |
| ------- | ----- |
| Name | `meditrack-api` |
| Root Directory | `backend` |
| Runtime | Node |
| Build Command | `npm ci` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |
| Instance Type | Free |

Environment variables (same names as section 3): `NODE_ENV=production`, `MONGODB_URI`,
`JWT_SECRET`, `COOKIE_SECRET`, `RX_ENCRYPTION_KEY`, `PRESCRIPTION_VALID_DAYS`,
`DAILY_PURCHASE_LIMIT`, `PAYMENT_PROVIDER=mock`, `PAYMENT_MOCK_DELAY_MS`,
`INVENTORY_AUTO_REPLENISH=on`, `CART_HOLD_MINUTES=15`. Leave `PORT` unset (Render injects it).
`CORS_ORIGIN` is still only needed for a split origin.

The free instance **spins down after 15 minutes** and takes about a minute to wake; Netlify's
proxy gives up after **26 seconds**, so keep `/api/health` warm with an uptime pinger during a
demo.

To route the Netlify SPA at Render, replace the two function rewrites in `netlify.toml` with:

```toml
[[redirects]]
  from = "/api/*"
  to = "https://<api-host>/api/:splat"
  status = 200
  force = true
  headers = { X-Forwarded-Proto = "https" }

[[redirects]]
  from = "/uploads/*"
  to = "https://<api-host>/uploads/:splat"
  status = 200
  force = true
  headers = { X-Forwarded-Proto = "https" }
```

Keep the SPA fallback last. `X-Forwarded-Proto` stops the API's production HTTPS redirect from
bouncing the browser to the Render hostname. On the free plan the disk is **ephemeral**, but
medicine images survive a redeploy because the bytes live in MongoDB (`medicineimages`);
prescription files are safe for the same reason.

---

## 9. Phase D impact (prescriptions and the daily cap)

Phase D adds prescription uploads, a verification queue and a checkout gate (FR-1.4, FR-2.1)
with encryption at rest (NFR-1.4), plus a fair-use daily unit cap (NFR-2.2).

**Where prescription files live.** Uploaded scans are encrypted with AES-256-GCM in
`lib/prescriptions.js` and stored in the `prescriptions` collection. Nothing is written to
`backend/uploads` or the medicine image store, so neither the function's read-only disk nor
Render's ephemeral disk matters for them:

1. `RX_ENCRYPTION_KEY` (64 hex characters) is the data-encryption key. Set it in the Netlify
   (or Render) environment **before the first upload**. If it is missing, a key is derived from
   `JWT_SECRET`; rotating `JWT_SECRET` afterwards makes existing files unreadable.
2. The ciphertext, IV and GCM auth tag are fields on the `Prescription` document. Atlas encrypts
   the volume and the application-level encryption means a database dump alone does not expose
   the scans. The bytes are `select: false` and stripped from every JSON response.
3. Files are streamed only through `GET /api/prescriptions/:id/file` (owner) and
   `GET /api/admin/prescriptions/:id/file` (verifier). Both routes require a bearer token and
   `Cache-Control: no-store`; never add a public static route for them.
4. Per-upload limit is 5 MB (`JPG`, `PNG`, `PDF`), under the function payload limit.

**Operational notes.**

- Staff and admins both hold `prescriptions:verify`; the queue is at `/admin/prescriptions`.
  Approval sets `validUntil = now + PRESCRIPTION_VALID_DAYS` and supersedes the customer's
  previous verified upload.
- Rejections require a reason, shown to the customer at `/prescriptions` and in the cart.
- `DAILY_PURCHASE_LIMIT` (default 10) caps units per customer per UTC day and is enforced before
  any stock moves. Cancelled/expired orders do not count; `0` disables it.
- `npm run db:check` verifies the `prescriptions` indexes; run it after schema changes.

---

## 10. Redeploy, rollback and migrations

- Netlify redeploys on every push to the production branch and creates deploy previews for pull
  requests. Roll back from **Deploys → select a deploy → Publish deploy**.
- Render redeploys on every push. `server.js` runs `runMigrations()` and the startup restock on
  boot, so schema/data migrations ship with the code. The Netlify function runs
  `runMigrations()` once per warm instance (`backend/netlify.js`).
- After deploying schema changes, re-run `npm run smoke:deploy -- <url>` and the backend suite
  (`cd backend && npm test`).
- Secrets live only in the host dashboard. Rotating `JWT_SECRET` or `COOKIE_SECRET` invalidates
  sessions/carts; changing `RX_ENCRYPTION_KEY` makes existing prescriptions unreadable.

## Files involved

| File | Purpose |
| ---- | ------- |
| `netlify.toml` | Build, function rewrites, bundled demo images, SPA fallback |
| `netlify/functions/api.js` | Netlify Function entry point |
| `backend/netlify.js` | Serverless-http wrapper: path rewrite, DB connect, migrations, env guard |
| `backend/lib/imageStore.js` | Medicine images: disk locally; MongoDB (`medicineimages`) → Netlify Blobs → bundled seed files on Netlify |
| `backend/server.js` | `Cache-Control: no-store` on `/api/*`, CORS, HTTPS redirect, routes |
| `backend/scripts/data.js` | 30 products / 7 varieties with descriptions + generated SVG images |
| `backend/scripts/seed-admin.js` | First administrator against the deployed database |
| `backend/scripts/seed-demo.js` | Smaller inventory-focused demo catalogue |
| `backend/scripts/smoke-deploy.js` | Post-deploy health, catalogue, SPA and CORS checks |
| `backend/lib/prescriptions.js` | AES-256-GCM uploads, validity window, checkout gate |
| `backend/lib/purchaseLimit.js` | Daily unit cap used by the cart summary and checkout |
| `backend/models/Prescription.js` | Encrypted prescription documents + verification state |
| `backend/routes/prescriptions.js` | Customer upload / history / file routes |
| `backend/.env.example` | Every setting, with CORS and the Phase D variables |
| `README.md` | Short deployment section pointing at this runbook |
