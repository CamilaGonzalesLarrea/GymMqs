import { NavLink, useNavigate } from 'react-router-dom';
import './Sidebar.css';

function Sidebar() {
  const navigate = useNavigate();

  const getUser = () => {
    try {
      const storedUser = localStorage.getItem('user');

      if (!storedUser) {
        return null;
      }

      return JSON.parse(storedUser);
    } catch {
      return null;
    }
  };

  const normalizeRole = (role = '') =>
    String(role)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ');

  const user = getUser();
  const role = normalizeRole(user?.role);

  const isAdmin =
    role === 'administrador' ||
    role === 'admin';

  const getAreaName = () => {
    if (isAdmin) {
      return 'Administración';
    }

    return 'Recursos Humanos';
  };

  const getNavClass = ({ isActive }) =>
    isActive ? 'active' : '';

  const handleLogout = () => {
    localStorage.removeItem('user');

    navigate('/', {
      replace: true,
    });
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <img
          src="/images/logo.jpg"
          alt="Gimnasio MQS"
        />

        <div>
          <strong>MQS</strong>

          <span>
            {getAreaName()}
          </span>
        </div>
      </div>

      <nav className="sidebar-menu">
        <NavLink
          to="/dashboard"
          className={getNavClass}
        >
          Dashboard
        </NavLink>

        <NavLink
          to="/employees"
          className={getNavClass}
        >
          Empleados
        </NavLink>

        <NavLink
          to="/positions"
          className={getNavClass}
        >
          Cargos
        </NavLink>

        <NavLink
          to="/shifts"
          className={getNavClass}
        >
          Turnos
        </NavLink>

        <NavLink
          to="/attendance"
          className={getNavClass}
        >
          Asistencia
        </NavLink>

        <NavLink
          to="/trainers"
          className={getNavClass}
        >
          Entrenadores
        </NavLink>

        <NavLink
          to="/reports"
          className={getNavClass}
        >
          Reportes
        </NavLink>

        {isAdmin && (
          <NavLink
            to="/operations"
            className={getNavClass}
          >
            Producción / Operaciones
          </NavLink>
        )}
      </nav>

      <div className="sidebar-bottom">
        {user && (
          <div
            style={{
              marginBottom: '12px',
              fontSize: '13px',
              opacity: 0.8,
            }}
          >
            <div>
              {user.username || 'Usuario'}
            </div>

            <div>
              {user.role || 'Sin rol'}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={handleLogout}
        >
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}

export default Sidebar;