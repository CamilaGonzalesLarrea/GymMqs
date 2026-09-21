import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import './Dashboard.css';

const API_URL = 'http://localhost:3000';

function Dashboard() {
  const navigate = useNavigate();

  const [user, setUser] = useState(null);
  const [employeeCount, setEmployeeCount] = useState(0);
  const [positionCount, setPositionCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const storedUser = localStorage.getItem('user');

    if (!storedUser) {
      navigate('/', {
        replace: true,
      });

      return;
    }

    try {
      const parsedUser = JSON.parse(storedUser);

      setUser(parsedUser);
    } catch (storageError) {
      console.error(
        'Error leyendo el usuario:',
        storageError,
      );

      localStorage.removeItem('user');

      navigate('/', {
        replace: true,
      });

      return;
    }

    loadDashboardData();
  }, [navigate]);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      setError('');

      const [
        employeesResponse,
        positionsResponse,
      ] = await Promise.all([
        fetch(`${API_URL}/api/employees`),
        fetch(`${API_URL}/api/employees/positions`),
      ]);

      if (!employeesResponse.ok) {
        throw new Error(
          'No se pudieron cargar los empleados.',
        );
      }

      if (!positionsResponse.ok) {
        throw new Error(
          'No se pudieron cargar los cargos.',
        );
      }

      const employees =
        await employeesResponse.json();

      const positions =
        await positionsResponse.json();

      setEmployeeCount(
        Array.isArray(employees)
          ? employees.length
          : 0,
      );

      setPositionCount(
        Array.isArray(positions)
          ? positions.length
          : 0,
      );
    } catch (dashboardError) {
      console.error(
        'Error cargando dashboard:',
        dashboardError,
      );

      setError(
        'No se pudieron cargar todos los datos del dashboard.',
      );
    } finally {
      setLoading(false);
    }
  };

  const getUserInitial = () => {
    const value =
      user?.username ||
      user?.role ||
      'U';

    return value
      .charAt(0)
      .toUpperCase();
  };

  const getUserName = () => {
    if (user?.username) {
      return user.username;
    }

    return 'Usuario';
  };

  const getUserRole = () => {
    if (user?.role) {
      return user.role;
    }

    return 'Sin rol';
  };

  return (
    <div className="dashboard-page">
      <Sidebar />

      <main className="dashboard-content">
        <header className="dashboard-header">
          <div>
            <span>
              RECURSOS HUMANOS
            </span>

            <h1>
              Dashboard
            </h1>

            <p>
              Gestión del personal del Gimnasio MQS
            </p>
          </div>

          <div className="dashboard-user">
            <div className="user-circle">
              {getUserInitial()}
            </div>

            <div>
              <strong>
                {getUserName()}
              </strong>

              <small>
                {getUserRole()} · Usuario activo
              </small>
            </div>
          </div>
        </header>

        {error && (
          <div
            className="error"
            style={{
              marginBottom: '20px',
            }}
          >
            {error}
          </div>
        )}

        <section className="dashboard-cards">
          <div className="dashboard-card">
            <span>
              Empleados
            </span>

            <strong>
              {loading
                ? '...'
                : employeeCount}
            </strong>

            <small>
              Personal registrado
            </small>
          </div>

          <div className="dashboard-card">
            <span>
              Cargos
            </span>

            <strong>
              {loading
                ? '...'
                : positionCount}
            </strong>

            <small>
              Cargos activos
            </small>
          </div>

          <div className="dashboard-card">
            <span>
              Sesión
            </span>

            <strong>
              Activa
            </strong>

            <small>
              {getUserRole()}
            </small>
          </div>
        </section>

        <section className="dashboard-panels">
          <div className="dashboard-panel">
            <h2>
              Gestión de personal
            </h2>

            <p>
              Acceso a las principales funciones
              de Recursos Humanos
            </p>

            <div className="activity">
              <div>
                <strong>
                  Empleados
                </strong>

                <span>
                  Registro y consulta del personal
                  del gimnasio.
                </span>
              </div>

              <div>
                <strong>
                  Cargos y turnos
                </strong>

                <span>
                  Organización de cargos y horarios
                  del personal.
                </span>
              </div>

              <div>
                <strong>
                  Asistencia
                </strong>

                <span>
                  Control de entrada y salida de
                  empleados.
                </span>
              </div>

              <div>
                <strong>
                  Entrenadores
                </strong>

                <span>
                  Consulta y gestión de entrenadores.
                </span>
              </div>
            </div>
          </div>

          <div className="dashboard-panel">
            <h2>
              Acciones rápidas
            </h2>

            <p>
              Operaciones frecuentes
            </p>

            <button
              type="button"
              onClick={() =>
                navigate('/employees')
              }
            >
              Gestionar empleados
            </button>

            <button
              type="button"
              onClick={() =>
                navigate('/positions')
              }
            >
              Consultar cargos
            </button>

            <button
              type="button"
              onClick={() =>
                navigate('/shifts')
              }
            >
              Gestionar turnos
            </button>

            <button
              type="button"
              onClick={() =>
                navigate('/attendance')
              }
            >
              Consultar asistencia
            </button>

            <button
              type="button"
              onClick={() =>
                navigate('/trainers')
              }
            >
              Gestionar entrenadores
            </button>

            <button
              type="button"
              onClick={() =>
                navigate('/reports')
              }
            >
              Ver reportes
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}

export default Dashboard;