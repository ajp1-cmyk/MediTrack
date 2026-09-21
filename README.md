# 💊 MediTrack

A simple medicine stock / inventory starter project.

- **Frontend:** React (Vite)
- **Backend:** Node.js + Express
- **Database:** MongoDB via Mongoose — one `medicines` stock collection plus a `users` collection
- **Auth:** JWT (`jsonwebtoken`) with bcrypt-hashed passwords (`bcryptjs`)
- **Image upload:** multer (saved to `backend/uploads/`)

## Project structure

```
meditrack/
├── backend/
│   ├── server.js              # Express app + CORS + routes + error handler
│   ├── db.js                  # MongoDB connection (Mongoose)
│   ├── models/
│   │   ├── Medicine.js        # the stock collection ("medicines")
│   │   └── User.js            # accounts + roles (admin / staff)
│   ├── middleware/auth.js     # requireAuth, requireRole, JWT signing
│   ├── lib/
│   │   ├── errors.js          # httpError + asyncHandler helpers
│   │   └── mongoErrors.js     # local/cloud connection hints + password redaction
│   ├── scripts/
│   │   ├── check-db.js        # `npm run db:check` — verify MONGODB_URI (local or cloud)
│   │   └── local-mongo.js     # `npm run db:local` — no-install local MongoDB
│   ├── routes/
│   │   ├── auth.js            # register / login / me / users
│   │   └── medicines.js       # stock CRUD + image upload
│   ├── tests/                 # end-to-end API tests + connection-helper tests
│   ├── uploads/               # (created at runtime) uploaded images
│   └── .env.example           # environment template
└── frontend/
    └── src/
        ├── App.jsx                        # router + layout
        ├── context/AuthContext.jsx        # signed-in user + token
        ├── lib/api.js                     # fetch wrapper that sends the JWT
        ├── components/
        │   ├── Navbar.jsx                 # nav + user chip + log out
        │   ├── ProtectedRoute.jsx         # role-guarded routes
        │   ├── MedicineForm.jsx           # stock entry form
        │   └── MedicineList.jsx           # stock list
        └── pages/
            ├── Home.jsx                   # landing page + stock list
            ├── Login.jsx                  # sign in / create account
            └── AddMedicine.jsx            # stock update page (admin only)
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

`db:check` prints the host (password redacted), the server version, the collections and how
many documents each holds, and creates the indexes the app needs. If the connection fails it
tells you what to fix — wrong password, unencoded special characters in the password,
`mongodb+srv` hostname typo, or an Atlas IP allow-list entry that is missing.

> **Notes for cloud connection strings**
>
> - Keep `mongodb+srv://` — Atlas resolves the replica-set hosts over DNS SRV records.
> - URL-encode special characters in the password: `@ → %40`, `# → %23`, `/ → %2F`,
>   `: → %3A`, `? → %3F`, `% → %25`.
> - Always include the database name (`…/meditrack?retryWrites=…`); without it MongoDB
>   writes into the default `test` database.
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
JWT_SECRET=<long random string>
JWT_EXPIRES_IN=7d
```

Generate a secret with:

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

| Who | Read stock list | Open `/add` (stock update page) | Create / update / delete stock | Manage users & roles |
| --- | --------------- | ------------------------------- | ------------------------------ | -------------------- |
| Anonymous visitor | ✅ | ❌ | ❌ | ❌ |
| `staff` | ✅ | ❌ | ❌ | ❌ |
| `admin` | ✅ | ✅ | ✅ | ✅ |

- Sign in at `/login`. The JWT is kept in `localStorage` and sent on every request as
  `Authorization: Bearer <token>`.
- **First-run bootstrap:** while the `users` collection is empty, `POST /api/auth/register`
  is open and the **first account created becomes an `admin`**. After that only a
  signed-in admin can create accounts (new accounts are `staff` unless the admin asks
  for another `admin`).
- The backend enforces every rule; the frontend only hides UI it knows you cannot use.
  `POST`, `PATCH` and `DELETE /api/medicines` answer **401** when no token is sent and
  **403** when the token belongs to a non-admin.
- Roles are re-read from the database on each request, so promoting or demoting a user
  (`PATCH /api/auth/users/:id/role`) takes effect immediately.
- Passwords are hashed with bcrypt (10 rounds) and the hash is never returned by the API.

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
| POST | `/api/auth/register` | `{ name, email, password, role? }` | open while the users collection is empty, then admin only |
| POST | `/api/auth/login` | `{ email, password }` | public → `{ token, user }` |
| GET | `/api/auth/me` | – | signed in |
| GET | `/api/auth/users` | – | admin |
| PATCH | `/api/auth/users/:id/role` | `{ role: "admin" \| "staff" }` | admin |

### Stock

| Method | Endpoint | Access | Description |
| ------ | -------- | ------ | ----------- |
| GET | `/api/medicines` | public | List stock (newest first) |
| GET | `/api/medicines/:id` | public | Get a single medicine |
| POST | `/api/medicines` | **admin** | Add stock (multipart/form-data) |
| PATCH | `/api/medicines/:id` | **admin** | Update details and/or the stock quantity |
| DELETE | `/api/medicines/:id` | **admin** | Remove a medicine from stock |
| GET | `/api/health` | public | `{ status, database }` |
| GET | `/uploads/<file>` | public | Serve an uploaded image |

`POST /api/medicines` fields (multipart/form-data):

- `name`  — e.g. `Dettol Liquid`
- `mfd`   — manufacturing date (`YYYY-MM-DD`)
- `exp`   — expiry date (`YYYY-MM-DD`, must not be earlier than `mfd`)
- `price` — number (e.g. `120.50`)
- `stock` — whole-number quantity
- `image` — image file (optional; JPEG/PNG/GIF/WEBP, max 5 MB)

### Frontend pages

| Route | Page | Who |
| ----- | ---- | --- |
| `/` | Landing page with the stock list | everyone |
| `/login` | Sign in / create the first account | everyone |
| `/add` | Add-medicine form (stock update page) | admins only, enforced on the server too |

### Example with curl

```bash
# 1. Sign in and keep the token
TOKEN=$(curl -s -X POST http://localhost:5000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"admin-pass-123"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')

# 2. Add stock (admin only — omit the header and you get 401)
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
then exercises bootstrap registration, login, 401/403 role checks, stock CRUD, validation,
image upload and 404s. **No MongoDB installation is required to run it.**

## Notes

- **Cloud or local MongoDB both work** — the app only reads `MONGODB_URI`, so an Atlas
  `mongodb+srv://…` string and `mongodb://127.0.0.1:27017/meditrack` are interchangeable.
  Run `npm run db:check` to confirm a string before starting the server.
- `db.js` falls back to `mongodb://127.0.0.1:27017/meditrack` when `MONGODB_URI` is not set.
- If `JWT_SECRET` is missing the server logs a warning and uses an insecure development
  fallback — always set it (see `backend/.env.example`) before deploying.
- **Deploying** the backend to a host (Render, Railway, Fly.io, a VPS…) means setting three
  environment variables there: `MONGODB_URI`, `JWT_SECRET` and, if the platform requires it,
  `PORT`. The Atlas cluster must allow the host's IP (or `0.0.0.0/0`), and the frontend
  should point at the deployed API instead of the Vite proxy.
- Documents are serialised with `id` (mapped from `_id`) so the React app keeps using `m.id`.
- Stale uploaded images are deleted from disk when a medicine is removed or its image replaced.
- The currency symbol (₹) is only used for display; change it in the frontend if needed.

