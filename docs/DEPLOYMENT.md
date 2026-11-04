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

   > **Committed default.** `frontend/.env.production` currently sets
   > `VITE_API_BASE_URL=https://meditrack-1owj.onrender.com`, so `npm run build` (and therefore
   > this Netlify build) calls the Express API on Render instead of the bundled function — the
   > two function rewrites above are then unused. That is the split-origin setup in **section 8**,
   > which also needs `CORS_ORIGIN` + `COOKIE_SAMESITE=none` on the API. To fall back to the
   > single-host Netlify deploy described in this section, delete `frontend/.env.production` (or
   > empty the value) and redeploy.
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

   **Emailed sign-in codes (optional).** The "Email code" tab needs no keys: with the
   default `MAIL_PROVIDER=console` every code is printed in the function log
   (*Netlify → Functions → api → logs*), which is enough for a demo. For real delivery set
   `MAIL_PROVIDER=resend`, `RESEND_API_KEY` and `MAIL_FROM` (a verified Resend sender).
   `OTP_TTL_MINUTES`, `OTP_MAX_ATTEMPTS`, `OTP_RESEND_COOLDOWN_SECONDS` and `OTP_SECRET`
   have sensible defaults, and `OTP_ALLOW_BACKOFFICE_LOGIN=true` lets staff/admin accounts
   sign in with a code as well (off by default). Never set `OTP_EXPOSE_CODE` here: the API
   ignores it in production on purpose, but it must not be relied on.

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
8. `/login` → **Email code** tab → enter an address → the six digits appear in the function
   log (or land in the inbox when Resend is configured) → verifying them signs you in, the
   nav shows the account, and `/orders` works. Then **Log out** and confirm you stay signed
   out. (Staff/admin accounts are password-only unless `OTP_ALLOW_BACKOFFICE_LOGIN=true`.)

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
| An uploaded PNG/JPEG/WEBP looks corrupted (grey box, `0x89` shown as `EF BF BD`) | `serverless-http` is UTF-8 decoding a binary response because its `binary` option is missing. Keep `SERVERLESS_OPTIONS.binary` in `backend/netlify.js`; `tests/serverless-response.test.js` guards it. |
| Catalogue shows stale stock | A cache stored a GET. The API sets `Cache-Control: no-store` on `/api/*` (`backend/server.js`); redeploy if that middleware is missing. |
| Cookies not stored | Serving over plain HTTP, or `NODE_ENV` is not `production` (cookies are `Secure` only in production). |
| Sign-in succeeds but the next reload is signed out, and guest carts never stick | **Split origin** without `COOKIE_SAMESITE=none` on the API (plus its matching `CORS_ORIGIN`). The browser drops `SameSite=Lax` cookies on cross-site responses, so the refresh and guest-cart cookies never arrive. |
| Requests still go to `/.netlify/functions/api` after switching to Render | The SPA was built **before** `VITE_API_BASE_URL` existed (`frontend/.env.production` or the Netlify build variable). Vite inlines it, so clear the cache and redeploy. |
| 404 when refreshing `/orders` | The SPA fallback rule is missing or is not last in `netlify.toml`. |
| 404 when **reloading a deep link** (`/medicines/<id>`, `/orders/<id>/confirmation`, `/cart`, `/admin/orders`) on the Render static site — usually reported as “product page / order details not found on reload” | The Static Site has no SPA fallback: Render serves an existing file, then applies rules, then answers `404 Not Found`, and a reload / a tab restored from the background is a full document request rather than a client-side navigation. Add `/* → /index.html` with Action **Rewrite** (Static Site → Settings → Redirects/Rewrites), save, and redeploy. Three ways this still fails: Source entered as `/` (matches only the home page — the `*` is required), Action **Redirect** instead of Rewrite (the 301 drops the path and lands on `/`), or the rule saved without a deploy. `404.html` does not help on Render. If the static site has no Redirects/Rewrites tab at all, build the SPA with `VITE_ROUTER_MODE=hash` instead (section 8) — hash URLs need no rule. |
| Netlify build fails on `npm ci` | Both lockfiles must be committed: `backend/package-lock.json` and `frontend/package-lock.json`. |
| `Refusing to start in production without …` (local/Render) | `JWT_SECRET` / `COOKIE_SECRET` missing. |
| Prescription file returns `could not be decrypted` | `RX_ENCRYPTION_KEY` changed (or was not set and `JWT_SECRET` rotated). Restore the original key; the file cannot be recovered otherwise. |
| Restock/hold sweeps do not run | Expected in function mode. Holds are released lazily on cart reads; restock from `/admin` or use the Render alternative (section 8). |
| Catalogue empty, page shows `Unexpected token 'N', "Not Found " is not valid JSON` | The SPA asked a host that does not serve the API. Render answers any path it does not have with the plain-text `404 Not Found`, and `JSON.parse` chokes on it — so the request went to `/api/…` on the SPA's own origin. `VITE_API_BASE_URL` was empty (or wrong) **at build time**; see “SPA on Render” in section 8. |
| Same `Unexpected token '<', "<!doctype…` | Same cause, but that host has an SPA fallback and returned `index.html` for `/api/…`. The failing URL under DevTools → Network is the give-away; set `VITE_API_BASE_URL` and rebuild. |
| Catalogue shows `Could not reach the API at https://… (network or CORS error)` (or a bare `Failed to fetch`) | The browser rejected the cross-origin call before JavaScript could read a response, which happens when the reply carries no `Access-Control-Allow-Origin` — the API does not list the SPA's origin in `CORS_ORIGIN`. Set it on the **API service** to the exact origin (`https://<site>.onrender.com`, no trailing slash; comma-separate previews and custom domains) and redeploy that service. Verify with `curl -i -H 'Origin: https://<site>' https://<api>/api/medicines \| grep -i access-control-allow-origin` — it must echo the origin. A sleeping free instance fails the same way, so retry once before changing anything. |

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

The free instance **spins down after 15 minutes** and takes about a minute to wake; keep
`/api/health` warm with an uptime pinger during a demo.

### Point the SPA at Render

`frontend/.env.production` already carries the deployed API origin:

```
VITE_API_BASE_URL=https://meditrack-1owj.onrender.com
```

Vite inlines it into `npm run build` (`frontend/src/lib/config.js` prefixes every `/api/…` and
`/uploads/…` URL with it), so a Netlify build picks it up automatically — no `netlify.toml`
change is needed, and the `/api/*` function rewrites simply stop being used. A Netlify
**build** variable with the same name overrides the file. `npm run dev` runs in development
mode, so it still goes through the Vite proxy to `http://localhost:5000`.

Then set these on the **Render service**:

| Variable | Value | Why |
| -------- | ----- | --- |
| `CORS_ORIGIN` | `https://<site>.netlify.app` | the browser origin allowed to send credentialed requests (comma-separate previews/custom domains) |
| `COOKIE_SAMESITE` | `none` | the refresh and guest-cart cookies must cross sites; `None` requires HTTPS, which Render provides |

Forgetting `COOKIE_SAMESITE=none` is the classic trap: sign-in looks successful (the access
token lives in memory), but the browser drops the `SameSite=Lax` refresh cookie on a
cross-site response, so the next reload is signed out and guest carts never stick.

> **Render Environment Groups do not apply themselves.** Putting `CORS_ORIGIN` (or any secret)
> in an **Environment Group** does *not* put it on the service — the group is inert storage until
> something links it, and creating a group does not create or configure a service. Two things are
> required:
>
> 1. **Link the group** — API service → **Environment** → **Linked Environment Groups** → pick the
>    group → **Link**. Render then deploys the service automatically. A group can be linked to any
>    number of services, and a service can link several groups.
> 2. **Remove the same key from the service's own list.** A variable defined directly on the
>    service always beats the linked group (Render guarantees that precedence); two groups that
>    define the same key are ordered by creation date, which is not something to rely on.
>
> `CORS_ORIGIN` belongs to the **SPA's** origin (`https://<site>.onrender.com`, `https://<site>.netlify.app`,
> no trailing slash), not to the API's own hostname — an API host there only allows the API to call
> itself. Check the running value from outside:

```bash
# 403 {"error":"Origin not allowed by CORS"} → CORS_ORIGIN does not list the SPA origin.
curl -s -o /dev/null -w '%{http_code}\n' \
  -H 'Origin: https://<site>.onrender.com' https://meditrack-1owj.onrender.com/api/medicines

# Must echo the same origin:
curl -s -D - -o /dev/null \
  -H 'Origin: https://<site>.onrender.com' https://meditrack-1owj.onrender.com/api/medicines \
  | grep -i '^access-control-allow-origin'
```

*Same-origin alternative.* If you would rather not have the SPA talk to Render directly,
proxy through Netlify instead: leave `VITE_API_BASE_URL` empty and replace the two function
rewrites in `netlify.toml` with

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
bouncing the browser to the Render hostname, and no CORS/cookie changes are needed because the
browser only ever sees the Netlify origin. On the free plan the disk is **ephemeral**, but
medicine images survive a redeploy because the bytes live in MongoDB (`medicineimages`);
prescription files are safe for the same reason.

### SPA on Render (static site)

Render can serve the React build too, so the whole app lives on one provider. **New →
Static Site** from the repository:

| Setting | Value |
| ------- | ----- |
| Root Directory | `frontend` |
| Build Command | `npm ci && npm run build` |
| Publish Directory | `dist` |

Set `VITE_API_BASE_URL` on the **static site** (Environment → Add Environment Variable), not on
the API service: Render does not share environment variables between services. Its value is the
API origin, e.g. `https://meditrack-1owj.onrender.com`.

> A variable defined in the Render dashboard overrides `frontend/.env.production`, even when it is
> **empty** — so a blank `VITE_API_BASE_URL` there silently rebuilds the SPA with same-origin URLs
> and reproduces the 404 below. Delete the variable instead of leaving it blank.

Add one rewrite under **Redirects/Rewrites** (Static Site → Settings). It must come *after* any
asset rules and is what keeps `/cart`, `/orders`, `/admin`, … working on a refresh:

| Source | Destination | Action |
| ------ | ----------- | ------ |
| `/*` | `/index.html` | Rewrite |

`Action` must be **Rewrite**, not Redirect: a redirect answers `/orders/<id>/confirmation` with a
301 to `/index.html`, so the browser's address bar loses the order id and React Router mounts on
`/` — the receipt becomes the catalogue. Render serves a *file that exists* before it applies
rules, which is why `/` and `/assets/*` keep working without the rule while every deep link
returns `404 Not Found`; that is exactly what a mobile reload of an order page hits, because a
reload (or a tab restored from the background) is a fresh document request, not a client-side
navigation. Render does **not** serve a `404.html` from the publish directory, so the copy that
`frontend/vite.config.js` emits is not used there — the rule above is the only host-side fix.

**No Redirects/Rewrites tab, or the rule has no effect?** Build the SPA for hash routing instead:

| Static Site → Environment | Value |
| ------------------------- | ----- |
| `VITE_ROUTER_MODE` | `hash` |

Save, then **Manual Deploy → Clear build cache & deploy**. Every route becomes
`https://<static-site>.onrender.com/#/medicines/<id>`; the browser only ever requests `/`, so a
reload of a product page, cart or order works with no rule at all. Links shared before the switch
keep the old `/medicines/…` shape and still 404 — re-share them. Remove the variable (and rebuild)
to return to clean paths once the rule is in place.

Do **not** add an `/api/*` rewrite: the SPA calls the API service by absolute URL, and a static
site cannot forward to another Render service. A static site only has the files it built, so
anything else — `/api/medicines` included — is answered by Render's edge with a plain-text
`404 Not Found`.

Then set these on the **API service**:

| Variable | Value | Why |
| -------- | ----- | --- |
| `CORS_ORIGIN` | `https://<static-site>.onrender.com` | the browser origin allowed to send credentialed requests |
| `COOKIE_SAMESITE` | `none` | the refresh and guest-cart cookies must cross sites (HTTPS only) |

**What a missed step looks like.** The catalogue shows *“We could not load the catalogue —
Unexpected token 'N', "Not Found " is not valid JSON”*. That is `JSON.parse` choking on Render's
plain-text 404: the bundle was built with an empty or wrong `VITE_API_BASE_URL`, so it requested
`/api/medicines` from the static site itself. Open DevTools → Network and check the failing
request URL — it must start with the API origin. Vite inlines the value at build time, so after
fixing the variable redeploy with **Manual Deploy → Clear build cache & deploy**.

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
| `frontend/src/lib/config.js` | `VITE_API_BASE_URL` → `apiUrl()` / `assetUrl()`; `VITE_ROUTER_MODE=hash` → hash routing (no host rewrite needed); empty values mean same-origin + clean paths |
| `frontend/vite.config.js` | Dev proxy to the local API; emits `dist/404.html` (a copy of `index.html`) so hosts that serve a 404 file fall back to the SPA |
| `frontend/src/pages/NotFound.jsx` | Unknown-route page (a stale order link says so instead of rendering the catalogue) |
| `frontend/.env.production` | Production API origin (`npm run build` only; `npm run dev` keeps the Vite proxy) |
| `backend/lib/cookies.js` | `COOKIE_SAMESITE` policy shared by the cart + refresh cookies |
| `backend/lib/prescriptions.js` | AES-256-GCM uploads, validity window, checkout gate |
| `backend/lib/purchaseLimit.js` | Daily unit cap used by the cart summary and checkout |
| `backend/models/Prescription.js` | Encrypted prescription documents + verification state |
| `backend/routes/prescriptions.js` | Customer upload / history / file routes |
| `backend/.env.example` | Every setting, with CORS and the Phase D variables |
| `README.md` | Short deployment section pointing at this runbook |
