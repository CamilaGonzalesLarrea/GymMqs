import { NavLink, useNavigate } from 'react-router-dom';
import './Sidebar.css';

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

const roleIsIn = (role, allowedRoles) =>
  allowedRoles
    .map(normalizeRole)
    .includes(normalizeRole(role));

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
      localStorage.removeItem('user');
      return null;
    }

    if (
      !user.username ||
      !user.role
    ) {
      localStorage.removeItem('user');
      return null;
    }

    if (
      user.status &&
      normalizeStatus(
        user.status,
      ) === 'INACTIVE'
    ) {
      localStorage.removeItem('user');
      return null;
    }

    return user;
  } catch {
    localStorage.removeItem('user');
    return null;
  }
};

function Sidebar() {
  const navigate =
    useNavigate();

  const user =
    getStoredUser();

  const role =
    normalizeRole(
      user?.role,
    );

  const isAdmin =
    roleIsIn(
      role,
      ADMIN_ROLES,
    );

  const isReception =
    roleIsIn(
      role,
      RECEPTION_ROLES,
    );

  const isHr =
    roleIsIn(
      role,
      HR_ROLES,
    );

  const canAccessHr =
    isAdmin || isHr;

  const canAccessOperations =
    isAdmin || isReception;

  const getAreaName = () => {
    if (isAdmin) {
      return 'Administración';
    }

    if (isReception) {
      return 'Producción / Operaciones';
    }

    if (isHr) {
      return 'Recursos Humanos';
    }

    return 'Sin área';
  };

  const getNavClass = ({
    isActive,
  }) =>
    isActive
      ? 'active'
      : '';

  const handleLogout = () => {
    localStorage.removeItem(
      'user',
    );

    navigate(
      '/',
      {
        replace: true,
      },
    );
  };

  const hrLinks = [
    {
      to: '/dashboard',
      label: 'Dashboard',
    },
    {
      to: '/employees',
      label: 'Empleados',
    },
    {
      to: '/positions',
      label: 'Cargos',
    },
    {
      to: '/shifts',
      label: 'Turnos',
    },
    {
      to: '/attendance',
      label: 'Asistencia',
    },
    {
      to: '/salaries',
      label: 'Salarios',
    },
    {
      to: '/payrolls',
      label: 'Planillas',
    },
    {
      to: '/reports',
      label: 'Reportes',
    },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <img
          src="/images/logo.jpg"
          alt="Gimnasio MQS"
        />

        <div>
          <strong>
            MQS
          </strong>

          <span>
            {getAreaName()}
          </span>
        </div>
      </div>

      <nav className="sidebar-menu">
        {canAccessHr &&
          hrLinks.map(
            (link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={
                  getNavClass
                }
              >
                {link.label}
              </NavLink>
            ),
          )}

        {canAccessOperations && (
          <NavLink
            to="/operations"
            className={
              getNavClass
            }
          >
            Producción / Operaciones
          </NavLink>
        )}
      </nav>

      <div className="sidebar-bottom">
        {user && (
          <div
            style={{
              marginBottom:
                '12px',
              fontSize:
                '13px',
              opacity:
                0.8,
              lineHeight:
                1.45,
              wordBreak:
                'break-word',
            }}
          >
            <div
              style={{
                fontWeight:
                  600,
              }}
            >
              {user.username ||
                'Usuario'}
            </div>

            <div>
              {user.role ||
                'Sin rol'}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={
            handleLogout
          }
        >
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}

export default Sidebar;
