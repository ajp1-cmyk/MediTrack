# 💊 MediTrack

A simple medicine stock / ecommerce starter project.

- **Frontend:** React (Vite)
- **Backend:** Node.js + Express
- **Database:** SQLite (using Node's built-in `node:sqlite`, no native build needed)
- **Image upload:** multer (saved to `backend/uploads/`)

## Project structure

```
meditrack/
├── backend/
│   ├── server.js            # Express app + CORS + static /uploads
│   ├── db.js                # SQLite schema
│   ├── routes/medicines.js  # Medicine CRUD + image upload
│   └── uploads/             # (created at runtime) uploaded images
└── frontend/
    └── src/
        ├── App.jsx                        # router + layout
        ├── components/Navbar.jsx          # top nav (Home + Add Medicine)
        ├── components/MedicineForm.jsx    # stock entry form
        ├── components/MedicineList.jsx    # stock list
        └── pages/
            ├── Home.jsx                   # landing page + stock list
            └── AddMedicine.jsx            # add-medicine form page
```

## How to run

### 1. Backend (port 5000)

```bash
cd backend
npm install
npm run dev        # or: npm start
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

## Frontend pages

| Route  | Page                                 |
| ------ | ------------------------------------ |
| `/`    | Landing page with the stock list     |
| `/add` | Form to add a new medicine           |

The navbar has a "Home" link and an "+ Add Medicine" button that takes you to the form.

## API

| Method | Endpoint            | Description                          |
| ------ | ------------------- | ------------------------------------ |
| GET    | `/api/medicines`    | List all medicines (newest first)    |
| GET    | `/api/medicines/:id`| Get a single medicine                |
| POST   | `/api/medicines`    | Create a medicine (multipart/form-data) |
| GET    | `/uploads/<file>`   | Serve an uploaded image              |

`POST /api/medicines` fields (multipart/form-data):

- `name`  — e.g. `Dettol Liquid`
- `mfd`   — manufacturing date (`YYYY-MM-DD`)
- `exp`   — expiry date (`YYYY-MM-DD`)
- `price` — number (e.g. `120.50`)
- `stock` — integer quantity
- `image` — image file (optional; JPEG/PNG/GIF/WEBP, max 5 MB)

### Example with curl

```bash
curl -X POST http://localhost:5000/api/medicines \
  -F "name=Dettol Liquid" \
  -F "mfd=2025-01-15" \
  -F "exp=2027-01-15" \
  -F "price=120.50" \
  -F "stock=50" \
  -F "image=@/path/to/dettol.jpg"
```

## Notes

- SQLite database file is created automatically at `backend/meditrack.db` on first run.
- `node:sqlite` is experimental in Node 22 — it works fine, and the `--disable-warning=ExperimentalWarning` flag in the npm scripts silences the console notice.
- The currency symbol (₹) is only used for display; change it in the frontend if needed.
