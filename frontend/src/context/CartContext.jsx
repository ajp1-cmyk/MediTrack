import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { cartApi } from '../lib/api.js';
import { useAuth } from './AuthContext.jsx';

const EMPTY_CART = {
  items: [],
  totals: {
    subtotal: 0,
    tax: 0,
    deliveryFee: 0,
    total: 0,
    itemCount: 0,
    currency: 'INR',
    taxRate: 0.05,
    freeDeliveryOver: 499,
  },
  itemCount: 0,
  lineCount: 0,
  hasIssues: false,
  updatedAt: null,
};

const CartContext = createContext(null);

/**
 * Holds the cart for the whole app.
 *
 * - Guests: the backend identifies the cart with the signed httpOnly cookie.
 * - Signed-in users: the JWT identifies an account cart, and the guest cart is
 *   merged into it as soon as a user appears (login / register / refresh).
 */
export function CartProvider({ children }) {
  const { user } = useAuth();
  const [cart, setCart] = useState(EMPTY_CART);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Medicine currently shown in the add-to-cart dialog (null = closed).
  const [addTarget, setAddTarget] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setError('');
      const data = await cartApi.get();
      setCart(data);
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  // Merge on sign-in and refresh on sign-out. `null` means anonymous.
  const lastUserId = useRef(null);

  useEffect(() => {
    const nextUserId = user ? user.id : null;
    if (lastUserId.current === nextUserId) return undefined;
    const previousUserId = lastUserId.current;
    lastUserId.current = nextUserId;

    let cancelled = false;
    (async () => {
      try {
        if (nextUserId) {
          const merged = await cartApi.merge();
          if (!cancelled) setCart(merged);
        } else if (previousUserId) {
          await refresh();
        }
      } catch {
        refresh().catch(() => {});
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, refresh]);

  const addItem = useCallback(async (medicineId, quantity = 1) => {
    const data = await cartApi.addItem(medicineId, quantity);
    setCart(data);
    return data;
  }, []);

  const updateQuantity = useCallback(async (medicineId, quantity) => {
    const data = await cartApi.updateItem(medicineId, quantity);
    setCart(data);
    return data;
  }, []);

  const removeItem = useCallback(async (medicineId) => {
    const data = await cartApi.removeItem(medicineId);
    setCart(data);
    return data;
  }, []);

  const clearCart = useCallback(async () => {
    const data = await cartApi.clear();
    setCart(data);
    return data;
  }, []);

  const openAddDialog = useCallback((medicine) => setAddTarget(medicine), []);
  const closeAddDialog = useCallback(() => setAddTarget(null), []);

  const value = useMemo(
    () => ({
      cart,
      items: cart.items,
      totals: cart.totals,
      itemCount: cart.itemCount,
      lineCount: cart.lineCount,
      hasIssues: cart.hasIssues,
      loading,
      error,
      addItem,
      updateQuantity,
      removeItem,
      clearCart,
      refresh,
      addTarget,
      openAddDialog,
      closeAddDialog,
    }),
    [
      cart,
      loading,
      error,
      addItem,
      updateQuantity,
      removeItem,
      clearCart,
      refresh,
      addTarget,
      openAddDialog,
      closeAddDialog,
    ]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error('useCart must be used inside a <CartProvider>');
  }
  return ctx;
}
