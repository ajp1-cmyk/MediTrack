import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { wishlistApi } from '../lib/api.js';
import { useAuth } from './AuthContext.jsx';
import { useCart } from './CartContext.jsx';

const EMPTY_WISHLIST = {
  items: [],
  itemCount: 0,
  availableCount: 0,
  hasIssues: false,
  updatedAt: null,
};

const WishlistContext = createContext(null);

/**
 * Holds the signed-in customer's wishlist (FR-1.5).
 *
 * The wishlist belongs to the account, so it is only loaded while a user is
 * signed in and is cleared on sign-out. Mutations return the freshly serialised
 * list, exactly like the cart endpoints, and move-to-cart also refreshes the
 * cart so the navigation badges stay in step.
 */
export function WishlistProvider({ children }) {
  const { user } = useAuth();
  const { refresh: refreshCart } = useCart();

  const userId = user ? user.id : null;
  const [wishlist, setWishlist] = useState(EMPTY_WISHLIST);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Load on sign-in, clear on sign-out. The `cancelled` flag stops a slow
  // response from restoring the previous account's list after a switch.
  useEffect(() => {
    if (!userId) {
      setWishlist(EMPTY_WISHLIST);
      setError('');
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);

    wishlistApi
      .get()
      .then((data) => {
        if (!cancelled) {
          setWishlist(data);
          setError('');
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const refresh = useCallback(async () => {
    if (!userId) {
      setWishlist(EMPTY_WISHLIST);
      return EMPTY_WISHLIST;
    }
    setLoading(true);
    try {
      setError('');
      const data = await wishlistApi.get();
      setWishlist(data);
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const add = useCallback(async (medicineId) => {
    const data = await wishlistApi.add(medicineId);
    setWishlist(data);
    return data;
  }, []);

  const remove = useCallback(async (medicineId) => {
    const data = await wishlistApi.remove(medicineId);
    setWishlist(data);
    return data;
  }, []);

  const clear = useCallback(async () => {
    const data = await wishlistApi.clear();
    setWishlist(data);
    return data;
  }, []);

  const moveToCart = useCallback(
    async (medicineId) => {
      const data = await wishlistApi.moveToCart(medicineId);
      setWishlist(data.wishlist);
      await refreshCart();
      return data;
    },
    [refreshCart]
  );

  const savedIds = useMemo(
    () => new Set(wishlist.items.map((item) => String(item.medicineId))),
    [wishlist.items]
  );

  const isSaved = useCallback(
    (medicineId) => savedIds.has(String(medicineId)),
    [savedIds]
  );

  const value = useMemo(
    () => ({
      wishlist,
      items: wishlist.items,
      itemCount: wishlist.itemCount,
      availableCount: wishlist.availableCount,
      hasIssues: wishlist.hasIssues,
      loading,
      error,
      add,
      remove,
      clear,
      moveToCart,
      isSaved,
      refresh,
    }),
    [
      wishlist,
      loading,
      error,
      add,
      remove,
      clear,
      moveToCart,
      isSaved,
      refresh,
    ]
  );

  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>;
}

export function useWishlist() {
  const ctx = useContext(WishlistContext);
  if (!ctx) {
    throw new Error('useWishlist must be used inside a <WishlistProvider>');
  }
  return ctx;
}
