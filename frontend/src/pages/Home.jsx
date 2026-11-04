import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import MedicineList, { MedicineGridSkeleton } from '../components/MedicineList.jsx';
import Icon from '../components/Icon.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { medicinesApi } from '../lib/api.js';
import { assetUrl } from '../lib/config.js';

const TRUST_POINTS = ['Genuine stock', 'Live expiry dates', 'Rx verification', 'Secure checkout'];

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
  const [reloadKey, setReloadKey] = useState(0);

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
        // The filter row is a convenience; search still works without it.
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
  }, [query, category, reloadKey]);

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

  const retry = () => {
    setLoading(true);
    setReloadKey((key) => key + 1);
  };

  const filtering = Boolean(query || category);
  const emptyMessage = filtering
    ? `No medicines match${query ? ` “${query}”` : ''}. Try another search or category.`
    : 'No medicines in stock yet. Please check back soon.';

  return (
    <main className="page page-store">
      <section className="store-hero">
        <div className="store-hero-copy">
          <span className="eyebrow">Online pharmacy · delivered to your door</span>
          <h1>Your medicine cabinet, delivered.</h1>
          <p className="store-hero-lead">
            Browse live stock with manufacturing and expiry dates, add what you need, and check
            out in seconds. Every prescription is checked by our pharmacists.
          </p>

          <form className="hero-search" role="search" onSubmit={(event) => event.preventDefault()}>
            <span className="hero-search-icon" aria-hidden="true">
              <Icon name="search" size={18} />
            </span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search medicines, e.g. paracetamol"
              aria-label="Search medicines"
              autoComplete="off"
            />
            {search ? (
              <button
                type="button"
                className="hero-search-clear"
                onClick={() => setSearch('')}
                aria-label="Clear search"
              >
                ×
              </button>
            ) : null}
          </form>

          <ul className="hero-trust">
            {TRUST_POINTS.map((point) => (
              <li key={point}>
                <span aria-hidden="true">
                  <Icon name="check" size={11} strokeWidth={3} />
                </span>{' '}
                {point}
              </li>
            ))}
          </ul>

          <div className="hero-actions">
            {isBackOffice ? (
              <Link to="/admin" className="btn btn-primary btn-lg">
                Open admin console <Icon name="arrow" size={17} />
              </Link>
            ) : (
              <Link to={user ? '/cart' : '/login'} className="btn btn-primary btn-lg">
                {user ? 'View your cart' : 'Create an account'} <Icon name="arrow" size={17} />
              </Link>
            )}
            <Link to="/prescriptions" className="btn btn-soft btn-lg">
              Upload a prescription
            </Link>
          </div>
        </div>

        <div className="store-hero-art" aria-hidden="true">
          <span className="hero-glow" />
          <div className="hero-tile hero-tile-back">
            <span className="hero-tile-icon">
              <Icon name="shield" size={20} />
            </span>
            <div>
              <strong>Pharmacist checked</strong>
              <span>Every prescription verified</span>
            </div>
          </div>
          <div className="hero-tile hero-tile-mid">
            <span className="pill pill-rx">Rx</span>
            <div>
              <strong>Prescription medicines</strong>
              <span>Upload once, order anytime</span>
            </div>
          </div>
          <div className="hero-tile hero-tile-front">
            <img src={assetUrl('/uploads/seed-paracetamol-500mg.svg')} alt="" loading="lazy" />
            <div className="hero-tile-copy">
              <strong>Paracetamol 500mg</strong>
              <span>In stock · 15 tablets</span>
            </div>
            <span className="hero-tile-price">₹35.00</span>
          </div>
        </div>
      </section>

      <section className="store-catalogue" aria-labelledby="catalogue-title">
        <div className="section-head">
          <div>
            <h2 id="catalogue-title">{filtering ? 'Search results' : 'Browse medicines'}</h2>
            <p className="section-sub">
              {filtering ? 'Matching your filters' : 'Live stock from our partner pharmacies'}
            </p>
          </div>
          {!loading && !error && (
            <span className="count-pill">
              {medicines.length} item{medicines.length === 1 ? '' : 's'}
            </span>
          )}
        </div>

        {categories.length > 0 && (
          <div className="category-scroller" role="group" aria-label="Filter by category">
            <button
              type="button"
              className={`category-chip${category ? '' : ' active'}`}
              aria-pressed={!category}
              onClick={() => changeCategory('')}
            >
              All medicines
            </button>
            {categories.map((row) => (
              <button
                key={row}
                type="button"
                className={`category-chip${category === row ? ' active' : ''}`}
                aria-pressed={category === row}
                onClick={() => changeCategory(category === row ? '' : row)}
              >
                {row}
              </button>
            ))}
          </div>
        )}

        {filtering && !loading && !error && (
          <div className="active-filters">
            {query && (
              <button
                type="button"
                className="filter-chip"
                onClick={() => setSearch('')}
                aria-label={`Remove search filter ${query}`}
              >
                “{query}” <span aria-hidden="true">×</span>
              </button>
            )}
            {category && (
              <button
                type="button"
                className="filter-chip"
                onClick={() => changeCategory('')}
                aria-label={`Remove category filter ${category}`}
              >
                {category} <span aria-hidden="true">×</span>
              </button>
            )}
            <button type="button" className="link-button" onClick={clearFilters}>
              Clear all
            </button>
          </div>
        )}

        {error && (
          <div className="state-card" role="alert">
            <span className="state-icon" aria-hidden="true">
              ⚠️
            </span>
            <h3>We could not load the catalogue</h3>
            <p>{error}</p>
            <button type="button" className="btn btn-secondary" onClick={retry}>
              Try again
            </button>
          </div>
        )}

        {!error && loading && <MedicineGridSkeleton />}

        {!error && !loading && (
          <>
            {searching && medicines.length > 0 && (
              <p className="muted store-search-busy" role="status">
                Updating results…
              </p>
            )}
            {medicines.length === 0 ? (
              <div className="state-card">
                <span className="state-icon" aria-hidden="true">
                  🔍
                </span>
                <h3>{filtering ? 'No matches found' : 'Nothing in stock yet'}</h3>
                <p>{emptyMessage}</p>
                {filtering && (
                  <button type="button" className="btn btn-secondary" onClick={clearFilters}>
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              <MedicineList medicines={medicines} emptyMessage={emptyMessage} />
            )}
          </>
        )}
      </section>
    </main>
  );
}
