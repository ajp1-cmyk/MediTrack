import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import MedicineList from '../components/MedicineList.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { medicinesApi } from '../lib/api.js';

export default function Home() {
  const { user, isBackOffice } = useAuth();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') || '';
  const category = params.get('category') || '';

  const [search, setSearch] = useState(query);
  const [categories, setCategories] = useState([]);
  const [medicines, setMedicines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  // Keep the input in sync when the user navigates back/forward.
  useEffect(() => {
    setSearch(query);
  }, [query]);

  // Debounce typing into `?q=`, which is also what triggers the fetch.
  useEffect(() => {
    const trimmed = search.trim();
    if (trimmed === query) return undefined;

    const timer = setTimeout(() => {
      const next = new URLSearchParams(params);
      if (trimmed) next.set('q', trimmed);
      else next.delete('q');
      setParams(next, { replace: true });
    }, 300);

    return () => clearTimeout(timer);
  }, [search, query, params, setParams]);

  useEffect(() => {
    let cancelled = false;
    medicinesApi
      .categories()
      .then((rows) => {
        if (!cancelled) setCategories(rows);
      })
      .catch(() => {
        // The dropdown is a convenience; search still works without it.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setError('');
        setSearching(true);
        const data = await medicinesApi.list({ q: query, category });
        if (!cancelled) setMedicines(data);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setSearching(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [query, category]);

  const changeCategory = (value) => {
    const next = new URLSearchParams(params);
    if (value) next.set('category', value);
    else next.delete('category');
    setParams(next, { replace: true });
  };

  const clearFilters = () => {
    setSearch('');
    setParams(new URLSearchParams(), { replace: true });
  };

  const filtering = Boolean(query || category);
  const emptyMessage = filtering
    ? `No medicines match${query ? ` “${query}”` : ''}${
        query && category ? ' in' : ''
      }${category ? ` ${category}` : ''}. Try another search or category.`
    : 'No medicines in stock yet. Please check back soon.';

  return (
    <main className="page">
      <section className="hero">
        <div className="hero-logo">💊</div>
        <h1>Welcome to MediTrack</h1>
        <p>
          Browse the pharmacy stock, add medicines to your cart and check out
          with home delivery — with manufacturing dates, expiry dates and prices
          always up to date.
        </p>
        {isBackOffice ? (
          <Link to="/admin" className="btn btn-lg">
            Open admin console
          </Link>
        ) : (
          <Link to={user ? '/cart' : '/login'} className="btn btn-lg">
            {user ? 'View your cart' : 'Sign in to order'}
          </Link>
        )}
      </section>

      <section>
        <div className="section-head">
          <h2>{filtering ? 'Search results' : 'Medicine Stock'}</h2>
          {!loading && (
            <span className="count">
              {medicines.length} item{medicines.length === 1 ? '' : 's'}
            </span>
          )}
        </div>

        <form className="store-search" role="search" onSubmit={(e) => e.preventDefault()}>
          <div className="store-search-field">
            <span aria-hidden="true">🔍</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, category or use…"
              aria-label="Search medicines"
            />
            {search && (
              <button type="button" className="link-button" onClick={() => setSearch('')}>
                Clear
              </button>
            )}
          </div>

          <select
            value={category}
            aria-label="Filter by category"
            onChange={(e) => changeCategory(e.target.value)}
          >
            <option value="">All categories</option>
            {categories.map((row) => (
              <option key={row} value={row}>
                {row}
              </option>
            ))}
          </select>
        </form>

        {filtering && !loading && (
          <p className="store-search-summary">
            {query ? (
              <>
                Results for <strong>“{query}”</strong>
              </>
            ) : (
              <>
                Category: <strong>{category}</strong>
              </>
            )}
            {query && category ? ` in ${category}` : ''} · {medicines.length} found
            <button type="button" className="link-button" onClick={clearFilters}>
              Reset
            </button>
          </p>
        )}

        {error && <p className="error">{error}</p>}
        {loading ? (
          <p className="empty">Loading…</p>
        ) : (
          <>
            {searching && medicines.length > 0 && (
              <p className="muted store-search-busy">Updating results…</p>
            )}
            <MedicineList medicines={medicines} emptyMessage={emptyMessage} />
          </>
        )}
      </section>
    </main>
  );
}
