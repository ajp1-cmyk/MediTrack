import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import AddToCartDialog from './components/AddToCartDialog.jsx';
import AdminLayout from './components/AdminLayout.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { CartProvider } from './context/CartContext.jsx';
import Home from './pages/Home.jsx';
import AddMedicine from './pages/AddMedicine.jsx';
import Login from './pages/Login.jsx';
import AdminRegister from './pages/AdminRegister.jsx';
import Cart from './pages/Cart.jsx';
import Checkout from './pages/Checkout.jsx';
import Payment from './pages/Payment.jsx';
import OrderConfirmation from './pages/OrderConfirmation.jsx';
import Orders from './pages/Orders.jsx';
import AdminLogin from './pages/admin/AdminLogin.jsx';
import AdminDashboard from './pages/admin/AdminDashboard.jsx';
import AdminStock from './pages/admin/AdminStock.jsx';
import AdminOrders from './pages/admin/AdminOrders.jsx';
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

        <Route path="*" element={<Home />} />
      </Routes>

      {/* One dialog instance for the whole storefront, opened from any card. */}
      {!isAdminArea && <AddToCartDialog />}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <CartProvider>
          <AppShell />
        </CartProvider>
      </BrowserRouter>
    </AuthProvider>
  );
}


