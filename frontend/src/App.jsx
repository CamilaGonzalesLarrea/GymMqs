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

const roleIsIn = (role, allowedRoles) =>
  allowedRoles.includes(
    normalizeRole(role),
  );

const getStoredUser = () => {
  try {
    const storedUser =
      localStorage.getItem('user');

    if (!storedUser) {
      return null;
    }

    const user = JSON.parse(storedUser);

    if (
      !user ||
      typeof user !== 'object'
    ) {
      return null;
    }

    return user;
  } catch (error) {
    console.error(
      'No se pudo leer la sesión guardada:',
      error,
    );

    return null;
  }
};

function RoleHome() {
  const user = getStoredUser();

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
  allowedRoles,
}) {
  const user = getStoredUser();

  if (!user) {
    return (
      <Navigate
        to="/"
        replace
      />
    );
  }

  const normalizedRole =
    normalizeRole(user.role);

  const normalizedAllowedRoles =
    allowedRoles.map(normalizeRole);

  if (
    !normalizedAllowedRoles.includes(
      normalizedRole,
    )
  ) {
    return <RoleHome />;
  }

  return children;
}

function PublicOnlyRoute({
  children,
}) {
  const user = getStoredUser();

  if (user) {
    return <RoleHome />;
  }

  return children;
}

function Unauthorized() {
  const user = getStoredUser();

  const handleLogout = () => {
    localStorage.removeItem('user');

    window.location.replace('/');
  };

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '24px',
        fontFamily:
          'Arial, sans-serif',
      }}
    >
      <div
        style={{
          maxWidth: '520px',
          textAlign: 'center',
        }}
      >
        <h1>
          Acceso no autorizado
        </h1>

        <p>
          El usuario{' '}
          <strong>
            {user?.username ||
              'actual'}
          </strong>{' '}
          tiene el rol{' '}
          <strong>
            {user?.role ||
              'sin definir'}
          </strong>
          , pero ese rol no tiene
          un área configurada.
        </p>

        <button
          type="button"
          onClick={handleLogout}
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
          element={<RoleHome />}
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