
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { DIRECTION_LINKS } from '../config/directionNavigation';
import './Sidebar.css';

// Se mantienen las pantallas existentes de Recursos Humanos.
const HR_LINKS = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/employees', label: 'Empleados' },
  { to: '/positions', label: 'Cargos' },
  { to: '/shifts', label: 'Turnos' },
  { to: '/attendance', label: 'Asistencia' },
  { to: '/salaries', label: 'Salarios' },
  { to: '/payrolls', label: 'Planillas' },
  { to: '/reports', label: 'Reportes' },
];

const ADMIN_ROLES = ['administrador', 'admin'];
const RECEPTION_ROLES = ['recepcionista', 'recepcion'];
const HR_ROLES = ['recursos humanos', 'rrhh', 'rh'];
const DIRECTOR_ROLES = ['director', 'direccion'];

// Claves compartidas con Login.jsx, App.jsx y erpApi.js.
const USER_KEY = 'user';
const TOKEN_KEY = 'authToken';
const TOKEN_EXPIRY_KEY = 'authTokenExpiresAt';
const MAX_TOKEN_LENGTH = 4096;
const MAX_USER_ID = 2147483647;

function normalizeRole(value = '') {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function isValidId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 && id <= MAX_USER_ID;
}

function getJwtClaims(token) {
  // Solo se comprueba la sesión para mostrar la interfaz.
  // El backend valida la firma JWT, el usuario y los permisos reales.
  try {
    if (
      typeof token !== 'string' ||
      token.length > MAX_TOKEN_LENGTH ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
    ) {
      return null;
    }

    const payload = token.split('.')[1];
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const claims = JSON.parse(window.atob(padded));

    return claims && typeof claims === 'object' && !Array.isArray(claims)
      ? claims
      : null;
  } catch {
    return null;
  }
}

function getSessionUser() {
  if (typeof window === 'undefined') return null;

  try {
    const rawUser = window.localStorage.getItem(USER_KEY);
    const token = window.sessionStorage.getItem(TOKEN_KEY);
    const rawExpiry = window.sessionStorage.getItem(TOKEN_EXPIRY_KEY);

    if (!rawUser || !token || !rawExpiry) return null;

    const user = JSON.parse(rawUser);
    const claims = getJwtClaims(token);
    const storedExpiry = Number(rawExpiry);

    if (
      !user ||
      typeof user !== 'object' ||
      Array.isArray(user) ||
      !isValidId(user.id) ||
      typeof user.username !== 'string' ||
      !user.username.trim() ||
      typeof user.role !== 'string' ||
      !user.role.trim() ||
      (user.status && String(user.status).toUpperCase() !== 'ACTIVE') ||
      !claims ||
      claims.sub !== String(user.id) ||
      claims.iss !== 'gym-mqs-api' ||
      claims.aud !== 'gym-mqs-web' ||
      !Number.isSafeInteger(claims.exp) ||
      !Number.isSafeInteger(storedExpiry) ||
      storedExpiry <= 0 ||
      Math.min(storedExpiry, claims.exp * 1000) <= Date.now()
    ) {
      return null;
    }

    return user;
  } catch {
    return null;
  }
}

function getAreaName(role) {
  if (ADMIN_ROLES.includes(role)) return 'Administración';
  if (RECEPTION_ROLES.includes(role)) return 'Producción / Operaciones';
  if (HR_ROLES.includes(role)) return 'Recursos Humanos';
  if (DIRECTOR_ROLES.includes(role)) return 'Dirección';
  return 'Sin área configurada';
}

function clearSession() {
  try {
    window.localStorage.removeItem(USER_KEY);
  } catch {
    // No impedir el cierre si el navegador restringe el almacenamiento.
  }

  try {
    window.sessionStorage.removeItem(TOKEN_KEY);
    window.sessionStorage.removeItem(TOKEN_EXPIRY_KEY);
  } catch {
    // El backend sigue exigiendo una sesión válida.
  }

  // App.jsx escucha este evento para comprobar nuevamente la sesión.
  window.dispatchEvent(new Event('focus'));
}

function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const user = getSessionUser();
  const role = normalizeRole(user?.role);
  const requestedDirectionSection = new URLSearchParams(location.search).get('section');
  const activeDirectionSection = DIRECTION_LINKS.some(
    ({ section }) => section === requestedDirectionSection,
  ) ? requestedDirectionSection : 'dashboard';

  const isAdmin = ADMIN_ROLES.includes(role);
  const isReception = RECEPTION_ROLES.includes(role);
  const isDirector = DIRECTOR_ROLES.includes(role);

  const canAccessHr = isAdmin || HR_ROLES.includes(role);
  const canAccessOperations = isAdmin || isReception;
  const canAccessFinances = isAdmin || isReception;
  const canAccessMarketing = isAdmin || isReception;
  const canAccessDirection = isAdmin || isDirector;

  const handleLogout = () => {
    clearSession();
    navigate('/', { replace: true });
  };

  const navClass = ({ isActive }) => (isActive ? 'active' : '');

  return (
    <aside className="sidebar" aria-label="Menú del Gimnasio MQS">
      <div className="sidebar-logo">
        <img src="/images/logo.jpg" alt="Logo Gimnasio MQS" />
        <div>
          <strong>MQS</strong>
          <span>{getAreaName(role)}</span>
        </div>
      </div>

      <nav className="sidebar-menu" aria-label="Navegación principal">
        {canAccessHr &&
          HR_LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end
              className={navClass}
            >
              {link.label}
            </NavLink>
          ))}

        {canAccessOperations && (
          <NavLink to="/operations" end className={navClass}>
            Producción / Operaciones
          </NavLink>
        )}

        {canAccessDirection && (
          <>
            <NavLink to="/direccion" end className={navClass}>
              Dirección
            </NavLink>
            <div className="sidebar-submenu" role="group" aria-label="Secciones de Dirección">
              {DIRECTION_LINKS.map(({ section, label }) => (
                <Link
                  key={section}
                  to={section === 'dashboard' ? '/direccion' : `/direccion?section=${section}`}
                  className={location.pathname === '/direccion' && activeDirectionSection === section ? 'active' : ''}
                  aria-current={location.pathname === '/direccion' && activeDirectionSection === section ? 'page' : undefined}
                >
                  {label}
                </Link>
              ))}
            </div>
          </>
        )}

        {canAccessFinances && (
          <>
            <NavLink to="/erp/payments" end className={navClass}>
              Finanzas / Pagos
            </NavLink>

            <NavLink to="/erp/cash" end className={navClass}>
              Finanzas / Caja
            </NavLink>
          </>
        )}

        {canAccessMarketing && (
          <>
            <NavLink to="/erp/promotions" end className={navClass}>
              Marketing y Ventas / Promociones
            </NavLink>

            <NavLink to="/erp/marketing" end className={navClass}>
              Marketing y Ventas / Alertas y Seguimientos
            </NavLink>
          </>
        )}
      </nav>

      <div className="sidebar-bottom">
        {user && (
          <div
            style={{
              marginBottom: '12px',
              fontSize: '13px',
              opacity: 0.8,
              lineHeight: 1.45,
              overflowWrap: 'anywhere',
            }}
            aria-label="Usuario de la sesión"
          >
            <div style={{ fontWeight: 600 }}>{user.username}</div>
            <div>{user.role}</div>
          </div>
        )}

        <button type="button" onClick={handleLogout}>
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}

export default Sidebar;
