import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
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

const ADMIN_ROLES = [
  'administrador',
  'admin',
];

const RECEPTION_ROLES = [
  'recepcionista',
  'recepcion',
];

const HR_ROLES = [
  'recursos humanos',
  'rrhh',
  'rh',
];

const normalizeRole = (role = '') =>
  String(role)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');

const normalizeStatus = (status = '') =>
  String(status)
    .trim()
    .toUpperCase();

const roleIsIn = (
  role,
  allowedRoles,
) =>
  allowedRoles
    .map(normalizeRole)
    .includes(
      normalizeRole(role),
    );

const getStoredUser = () => {
  try {
    const storedUser =
      localStorage.getItem('user');

    if (!storedUser) {
      return null;
    }

    const user =
      JSON.parse(storedUser);

    if (
      !user ||
      typeof user !== 'object' ||
      Array.isArray(user)
    ) {
      localStorage.removeItem(
        'user',
      );

      return null;
    }

    if (
      !user.username ||
      !user.role
    ) {
      localStorage.removeItem(
        'user',
      );

      return null;
    }

    if (
      user.status &&
      normalizeStatus(
        user.status,
      ) === 'INACTIVE'
    ) {
      localStorage.removeItem(
        'user',
      );

      return null;
    }

    return user;
  } catch (error) {
    console.error(
      'No se pudo leer la sesión guardada:',
      error,
    );

    localStorage.removeItem(
      'user',
    );

    return null;
  }
};

const clearStoredSession = () => {
  localStorage.removeItem(
    'user',
  );
};

function RoleHome() {
  const user =
    getStoredUser();

  if (!user) {
    return (
      <Navigate
        to="/"
        replace
      />
    );
  }

  if (
    roleIsIn(
      user.role,
      RECEPTION_ROLES,
    )
  ) {
    return (
      <Navigate
        to="/operations"
        replace
      />
    );
  }

  if (
    roleIsIn(
      user.role,
      ADMIN_ROLES,
    ) ||
    roleIsIn(
      user.role,
      HR_ROLES,
    )
  ) {
    return (
      <Navigate
        to="/dashboard"
        replace
      />
    );
  }

  return (
    <Navigate
      to="/unauthorized"
      replace
    />
  );
}

function ProtectedRoute({
  children,
  allowedRoles = [],
}) {
  const user =
    getStoredUser();

  if (!user) {
    return (
      <Navigate
        to="/"
        replace
      />
    );
  }

  if (
    !roleIsIn(
      user.role,
      allowedRoles,
    )
  ) {
    return <RoleHome />;
  }

  return children;
}

function PublicOnlyRoute({
  children,
}) {
  const user =
    getStoredUser();

  if (user) {
    return <RoleHome />;
  }

  return children;
}

function Unauthorized() {
  const user =
    getStoredUser();

  const handleLogout = () => {
    clearStoredSession();

    window.location.replace(
      '/',
    );
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
        fontFamily:
          'Arial, sans-serif',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '540px',
          padding: '32px',
          textAlign: 'center',
          background: '#151515',
          border:
            '1px solid #2a2a2a',
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
            margin:
              '0 0 14px',
          }}
        >
          Acceso no autorizado
        </h1>

        <p
          style={{
            margin:
              '0 0 24px',
            color: '#a0a0a0',
            lineHeight: 1.6,
          }}
        >
          El usuario{' '}
          <strong
            style={{
              color: '#ffffff',
            }}
          >
            {user?.username ||
              'actual'}
          </strong>{' '}
          tiene el rol{' '}
          <strong
            style={{
              color: '#ffffff',
            }}
          >
            {user?.role ||
              'sin definir'}
          </strong>
          , pero ese rol no tiene
          un área configurada.
        </p>

        <button
          type="button"
          onClick={
            handleLogout
          }
          style={{
            padding:
              '11px 18px',
            border:
              '1px solid #333333',
            borderRadius:
              '8px',
            background:
              '#ffffff',
            color:
              '#111111',
            fontWeight: 700,
            cursor:
              'pointer',
          }}
        >
          Cerrar sesión
        </button>
      </div>
    </main>
  );
}

function App() {
  const adminAndHrRoles = [
    ...ADMIN_ROLES,
    ...HR_ROLES,
  ];

  const operationsRoles = [
    ...ADMIN_ROLES,
    ...RECEPTION_ROLES,
  ];

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
          element={
            <RoleHome />
          }
        />

        <Route
          path="/operations"
          element={
            <ProtectedRoute
              allowedRoles={
                operationsRoles
              }
            >
              <Operations />
            </ProtectedRoute>
          }
        />

        <Route
          path="/dashboard"
          element={
            <ProtectedRoute
              allowedRoles={
                adminAndHrRoles
              }
            >
              <Dashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/employees"
          element={
            <ProtectedRoute
              allowedRoles={
                adminAndHrRoles
              }
            >
              <Employees />
            </ProtectedRoute>
          }
        />

        <Route
          path="/positions"
          element={
            <ProtectedRoute
              allowedRoles={
                adminAndHrRoles
              }
            >
              <Positions />
            </ProtectedRoute>
          }
        />

        <Route
          path="/shifts"
          element={
            <ProtectedRoute
              allowedRoles={
                adminAndHrRoles
              }
            >
              <Shifts />
            </ProtectedRoute>
          }
        />

        <Route
          path="/attendance"
          element={
            <ProtectedRoute
              allowedRoles={
                adminAndHrRoles
              }
            >
              <Attendance />
            </ProtectedRoute>
          }
        />

        <Route
          path="/salaries"
          element={
            <ProtectedRoute
              allowedRoles={
                adminAndHrRoles
              }
            >
              <Salaries />
            </ProtectedRoute>
          }
        />

        <Route
          path="/payrolls"
          element={
            <ProtectedRoute
              allowedRoles={
                adminAndHrRoles
              }
            >
              <Payrolls />
            </ProtectedRoute>
          }
        />

        <Route
          path="/reports"
          element={
            <ProtectedRoute
              allowedRoles={
                adminAndHrRoles
              }
            >
              <Reports />
            </ProtectedRoute>
          }
        />

        <Route
          path="/unauthorized"
          element={
            <Unauthorized />
          }
        />

        <Route
          path="*"
          element={
            <RoleHome />
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
