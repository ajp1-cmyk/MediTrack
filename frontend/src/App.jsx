import { BrowserRouter, HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar.jsx';
import Footer from './components/Footer.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import AddToCartDialog from './components/AddToCartDialog.jsx';
import AdminLayout from './components/AdminLayout.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { usesHashRouting } from './lib/config.js';
import { CartProvider } from './context/CartContext.jsx';
import { WishlistProvider } from './context/WishlistContext.jsx';
import Home from './pages/Home.jsx';
import AddMedicine from './pages/AddMedicine.jsx';
import Login from './pages/Login.jsx';
import AdminRegister from './pages/AdminRegister.jsx';
import Cart from './pages/Cart.jsx';
import MedicineDetail from './pages/MedicineDetail.jsx';
import Checkout from './pages/Checkout.jsx';
import Payment from './pages/Payment.jsx';
import OrderConfirmation from './pages/OrderConfirmation.jsx';
import Orders from './pages/Orders.jsx';
import Wishlist from './pages/Wishlist.jsx';
import Prescriptions from './pages/Prescriptions.jsx';
import NotFound from './pages/NotFound.jsx';
import AdminLogin from './pages/admin/AdminLogin.jsx';
import AdminDashboard from './pages/admin/AdminDashboard.jsx';
import AdminStock from './pages/admin/AdminStock.jsx';
import AdminOrders from './pages/admin/AdminOrders.jsx';
import AdminPrescriptions from './pages/admin/AdminPrescriptions.jsx';
import AdminCustomers from './pages/admin/AdminCustomers.jsx';
import AdminAudit from './pages/admin/AdminAudit.jsx';
import AdminInvites from './pages/admin/AdminInvites.jsx';
import './App.css';

function AppShell() {
  const location = useLocation();
  const isAdminArea = location.pathname.startsWith('/admin');

  return (
    <div className={isAdminArea ? 'app app-admin' : 'app'}>
      {!isAdminArea && <Navbar />}

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/cart" element={<Cart />} />
        <Route path="/medicines/:id" element={<MedicineDetail />} />

        {/* Checkout and orders need an account (the cart itself does not). */}
        <Route
          path="/checkout"
          element={
            <ProtectedRoute>
              <Checkout />
            </ProtectedRoute>
          }
        />
        <Route
          path="/orders"
          element={
            <ProtectedRoute>
              <Orders />
            </ProtectedRoute>
          }
        />
        <Route
          path="/wishlist"
          element={
            <ProtectedRoute>
              <Wishlist />
            </ProtectedRoute>
          }
        />
        <Route
          path="/prescriptions"
          element={
            <ProtectedRoute>
              <Prescriptions />
            </ProtectedRoute>
          }
        />
        <Route
          path="/orders/:id/payment"
          element={
            <ProtectedRoute>
              <Payment />
            </ProtectedRoute>
          }
        />
        <Route
          path="/orders/:id/confirmation"
          element={
            <ProtectedRoute>
              <OrderConfirmation />
            </ProtectedRoute>
          }
        />

        {/* Legacy stock page — staff and admins can both add stock now. */}
        <Route
          path="/add"
          element={
            <ProtectedRoute roles={['admin', 'staff']}>
              <AddMedicine />
            </ProtectedRoute>
          }
        />

        {/* Back-office entry points (public). */}
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin/register" element={<AdminRegister />} />

        {/* Back-office console. */}
        <Route
          path="/admin"
          element={
            <ProtectedRoute roles={['admin', 'staff']} loginPath="/admin/login">
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<AdminDashboard />} />
          <Route path="stock" element={<AdminStock />} />
          <Route path="orders" element={<AdminOrders />} />
          <Route path="prescriptions" element={<AdminPrescriptions />} />
          <Route path="customers" element={<AdminCustomers />} />
          <Route
            path="invites"
            element={
              <ProtectedRoute roles={['admin']} loginPath="/admin/login">
                <AdminInvites />
              </ProtectedRoute>
            }
          />
          <Route
            path="audit"
            element={
              <ProtectedRoute roles={['admin']} loginPath="/admin/login">
                <AdminAudit />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Route>

        {/* A mistyped or stale address: say so instead of showing the catalogue. */}
        <Route path="*" element={<NotFound />} />
      </Routes>

      {/* One dialog instance for the whole storefront, opened from any card. */}
      {!isAdminArea && <Footer />}
      {!isAdminArea && <AddToCartDialog />}
    </div>
  );
}

export default function App() {
  // Clean paths (`/medicines/<id>`) by default; hash paths (`/#/medicines/<id>`)
  // when the build sets VITE_ROUTER_MODE=hash. A static host with no SPA
  // fallback rule answers a deep link with its own 404, and a reload then never
  // boots the app — hash URLs only ever request `/`, so they always work.
  const Router = usesHashRouting ? HashRouter : BrowserRouter;

  return (
    <AuthProvider>
      <Router>
        <CartProvider>
          <WishlistProvider>
            <AppShell />
          </WishlistProvider>
        </CartProvider>
      </Router>
    </AuthProvider>
  );
}


