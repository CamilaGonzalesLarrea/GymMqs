import { useEffect, useState } from 'react';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from 'react-router-dom';

import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Employees from './pages/Employees';
import Positions from './pages/Positions';
import Shifts from './pages/Shifts';
import Attendance from './pages/Attendance';
import Salaries from './pages/Salaries';
import Payrolls from './pages/Payrolls';
import Reports from './pages/Reports';
import Operations from './pages/Operations';
import ErpPayments from './pages/ErpPayments';
import ErpCash from './pages/ErpCash';
import ErpPromotions from './pages/ErpPromotions';
import ErpMarketing from './pages/ErpMarketing';
import Direccion from './pages/Direccion';

// Se conservan los roles y rutas existentes del gimnasio.
// Se incorporan las pantallas de Finanzas / Pagos y Caja sin alterar
// las demás pantallas.

const ADMIN_ROLES = ['administrador', 'admin'];
const RECEPTION_ROLES = ['recepcionista', 'recepcion'];
const HR_ROLES = ['recursos humanos', 'rrhh', 'rh'];
const DIRECTOR_ROLES = ['director', 'direccion'];

const HR_ACCESS_ROLES = [...ADMIN_ROLES, ...HR_ROLES];
const OPERATIONS_ACCESS_ROLES = [...ADMIN_ROLES, ...RECEPTION_ROLES];
const PAYMENTS_ACCESS_ROLES = [...ADMIN_ROLES, ...RECEPTION_ROLES];
const CASH_ACCESS_ROLES = [...ADMIN_ROLES, ...RECEPTION_ROLES];
const MARKETING_ACCESS_ROLES = [...ADMIN_ROLES, ...RECEPTION_ROLES];
const DIRECTION_ACCESS_ROLES = [...ADMIN_ROLES, ...DIRECTOR_ROLES];

// Claves utilizadas también por Login.jsx y Sidebar.jsx.
const USER_KEY = 'user';
const TOKEN_KEY = 'authToken';
const TOKEN_EXPIRY_KEY = 'authTokenExpiresAt';
const MAX_TOKEN_LENGTH = 4096;

function normalizeRole(role = '') {
  return String(role)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function hasRole(role, allowedRoles) {
  return allowedRoles.some(
    (allowed) => normalizeRole(allowed) === normalizeRole(role)
  );
}

function validUserId(value) {
  const id = Number(value);

  return (
    Number.isSafeInteger(id) &&
    id > 0 &&
    id <= 2147483647
  );
}

function readJwtClaims(token) {
  // Esta comprobación controla la sesión en React.
  // La firma JWT y los permisos se verifican en el backend.
  try {
    if (
      typeof token !== 'string' ||
      token.length > MAX_TOKEN_LENGTH ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
    ) {
      return null;
    }

    const payload = token.split('.')[1];

    const base64 = payload
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    const padded = base64.padEnd(
      Math.ceil(base64.length / 4) * 4,
      '='
    );

    const claims = JSON.parse(window.atob(padded));

    if (
      !claims ||
      typeof claims !== 'object' ||
      Array.isArray(claims)
    ) {
      return null;
    }

    return claims;
  } catch {
    return null;
  }
}

function getStoredSession() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const rawUser = localStorage.getItem(USER_KEY);
    const token = sessionStorage.getItem(TOKEN_KEY);

    const rawExpiresAt = sessionStorage.getItem(
      TOKEN_EXPIRY_KEY
    );

    if (!rawUser || !token || !rawExpiresAt) {
      return null;
    }

    const user = JSON.parse(rawUser);

    if (
      !user ||
      typeof user !== 'object' ||
      Array.isArray(user) ||
      !validUserId(user.id) ||
      typeof user.username !== 'string' ||
      !user.username.trim() ||
      typeof user.role !== 'string' ||
      !user.role.trim() ||
      (user.status &&
        String(user.status).toUpperCase() !== 'ACTIVE')
    ) {
      return null;
    }

    const claims = readJwtClaims(token);
    const storedExpiry = Number(rawExpiresAt);

    if (
      !claims ||
      typeof claims.sub !== 'string' ||
      claims.sub !== String(user.id) ||
      claims.iss !== 'gym-mqs-api' ||
      claims.aud !== 'gym-mqs-web' ||
      !Number.isSafeInteger(claims.exp) ||
      !Number.isSafeInteger(storedExpiry) ||
      storedExpiry <= 0
    ) {
      return null;
    }

    // Nunca prolongar la sesión más allá del token del servidor.
    const expiresAt = Math.min(
      storedExpiry,
      claims.exp * 1000
    );

    if (expiresAt <= Date.now()) {
      return null;
    }

    return {
      user,
      expiresAt,
    };
  } catch {
    return null;
  }
}

function clearStoredSession() {
  try {
    localStorage.removeItem(USER_KEY);
  } catch {
    // El navegador puede restringir el almacenamiento.
  }

  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_EXPIRY_KEY);
  } catch {
    // No impedir el cierre de sesión si falla el almacenamiento.
  }
}

function useSession() {
  const [, setRevision] = useState(0);

  const session = getStoredSession();
  const expiresAt = session?.expiresAt ?? null;

  useEffect(() => {
    const recheck = () => {
      setRevision((previous) => previous + 1);
    };

    const onStorage = (event) => {
      if (event.key === USER_KEY || event.key === null) {
        recheck();
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        recheck();
      }
    };

    window.addEventListener('focus', recheck);
    window.addEventListener('storage', onStorage);
    document.addEventListener(
      'visibilitychange',
      onVisibility
    );

    // Comprobar automáticamente cuando venza la sesión.
    let timer;

    if (expiresAt !== null) {
      timer = window.setTimeout(
        recheck,
        Math.max(0, expiresAt - Date.now() + 10)
      );
    }

    return () => {
      window.removeEventListener('focus', recheck);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener(
        'visibilitychange',
        onVisibility
      );

      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [expiresAt]);

  return session;
}

function RoleHome() {
  const session = useSession();

  if (!session) {
    return <Navigate to="/" replace />;
  }

  const { role } = session.user;

  if (hasRole(role, RECEPTION_ROLES)) {
    return <Navigate to="/operations" replace />;
  }

  if (hasRole(role, DIRECTOR_ROLES)) {
    return <Navigate to="/direccion" replace />;
  }

  if (hasRole(role, HR_ACCESS_ROLES)) {
    return <Navigate to="/dashboard" replace />;
  }

  // Los roles nuevos tendrán su área cuando esté implementada.
  return <Navigate to="/unauthorized" replace />;
}

function ProtectedRoute({
  children,
  allowedRoles,
}) {
  const session = useSession();

  if (!session) {
    return <Navigate to="/" replace />;
  }

  if (!hasRole(session.user.role, allowedRoles)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return children;
}

function PublicOnlyRoute({ children }) {
  const session = useSession();

  return session
    ? <Navigate to="/home" replace />
    : children;
}

function Unauthorized() {
  const session = useSession();
  const navigate = useNavigate();

  if (!session) {
    return <Navigate to="/" replace />;
  }

  const user = session.user;

  const hasHome = hasRole(user.role, [
    ...HR_ACCESS_ROLES,
    ...RECEPTION_ROLES,
    ...DIRECTOR_ROLES,
  ]);

  const handleLogout = () => {
    clearStoredSession();
    navigate('/', { replace: true });
  };

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '24px',
        background: '#0b0b0b',
        color: '#ffffff',
        fontFamily: 'Arial, sans-serif',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '540px',
          padding: '32px',
          textAlign: 'center',
          background: '#151515',
          border: '1px solid #2a2a2a',
          borderRadius: '14px',
        }}
      >
        <div
          style={{
            marginBottom: '10px',
            color: '#e0002d',
            fontSize: '12px',
            fontWeight: 700,
            letterSpacing: '1px',
          }}
        >
          GIMNASIO MQS
        </div>

        <h1
          style={{
            margin: '0 0 14px',
          }}
        >
          Acceso no autorizado
        </h1>

        <p
          style={{
            margin: '0 0 24px',
            color: '#a0a0a0',
            lineHeight: 1.6,
          }}
        >
          El usuario{' '}
          <strong style={{ color: '#ffffff' }}>
            {user.username}
          </strong>
          , con el rol{' '}
          <strong style={{ color: '#ffffff' }}>
            {user.role}
          </strong>
          , no tiene acceso a esta sección o su área todavía no está habilitada.
        </p>

        {hasHome && (
          <button
            type="button"
            onClick={() =>
              navigate('/home', { replace: true })
            }
            style={{
              marginRight: '10px',
              padding: '11px 18px',
              border: '1px solid #444444',
              borderRadius: '8px',
              background: '#262626',
              color: '#ffffff',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Volver a mi área
          </button>
        )}

        <button
          type="button"
          onClick={handleLogout}
          style={{
            padding: '11px 18px',
            border: '1px solid #333333',
            borderRadius: '8px',
            background: '#ffffff',
            color: '#111111',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Cerrar sesión
        </button>
      </div>
    </main>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            <PublicOnlyRoute>
              <Login />
            </PublicOnlyRoute>
          }
        />

        <Route
          path="/home"
          element={<RoleHome />}
        />

        <Route
          path="/operations"
          element={
            <ProtectedRoute allowedRoles={OPERATIONS_ACCESS_ROLES}>
              <Operations />
            </ProtectedRoute>
          }
        />

        <Route
          path="/direccion"
          element={
            <ProtectedRoute allowedRoles={DIRECTION_ACCESS_ROLES}>
              <Direccion />
            </ProtectedRoute>
          }
        />

        {/* Módulo ERP: Finanzas / Caja */}
        <Route
          path="/erp/cash"
          element={
            <ProtectedRoute allowedRoles={CASH_ACCESS_ROLES}>
              <ErpCash />
            </ProtectedRoute>
          }
        />

        {/* Módulo ERP: Finanzas / Pagos */}
        <Route
          path="/erp/payments"
          element={
            <ProtectedRoute allowedRoles={PAYMENTS_ACCESS_ROLES}>
              <ErpPayments />
            </ProtectedRoute>
          }
        />

        {/* Módulo ERP: Marketing y Ventas / Promociones */}
        <Route
          path="/erp/promotions"
          element={
            <ProtectedRoute allowedRoles={MARKETING_ACCESS_ROLES}>
              <ErpPromotions />
            </ProtectedRoute>
          }
        />

        {/* Módulo ERP: Marketing y Ventas / Alertas y Seguimientos */}
        <Route
          path="/erp/marketing"
          element={
            <ProtectedRoute allowedRoles={MARKETING_ACCESS_ROLES}>
              <ErpMarketing />
            </ProtectedRoute>
          }
        />

        <Route
          path="/dashboard"
          element={
            <ProtectedRoute allowedRoles={HR_ACCESS_ROLES}>
              <Dashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/employees"
          element={
            <ProtectedRoute allowedRoles={HR_ACCESS_ROLES}>
              <Employees />
            </ProtectedRoute>
          }
        />

        <Route
          path="/positions"
          element={
            <ProtectedRoute allowedRoles={HR_ACCESS_ROLES}>
              <Positions />
            </ProtectedRoute>
          }
        />

        <Route
          path="/shifts"
          element={
            <ProtectedRoute allowedRoles={HR_ACCESS_ROLES}>
              <Shifts />
            </ProtectedRoute>
          }
        />

        <Route
          path="/attendance"
          element={
            <ProtectedRoute allowedRoles={HR_ACCESS_ROLES}>
              <Attendance />
            </ProtectedRoute>
          }
        />

        <Route
          path="/salaries"
          element={
            <ProtectedRoute allowedRoles={HR_ACCESS_ROLES}>
              <Salaries />
            </ProtectedRoute>
          }
        />

        <Route
          path="/payrolls"
          element={
            <ProtectedRoute allowedRoles={HR_ACCESS_ROLES}>
              <Payrolls />
            </ProtectedRoute>
          }
        />

        <Route
          path="/reports"
          element={
            <ProtectedRoute allowedRoles={HR_ACCESS_ROLES}>
              <Reports />
            </ProtectedRoute>
          }
        />

        <Route
          path="/unauthorized"
          element={<Unauthorized />}
        />

        <Route
          path="*"
          element={<RoleHome />}
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
