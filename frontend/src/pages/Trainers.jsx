import { useEffect, useState } from 'react';
import Sidebar from '../components/Sidebar';
import { API_URL } from '../config/api';
import './Employees.css';

function Trainers() {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadEmployees();
  }, []);

  const loadEmployees = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_URL}/api/employees`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Error al obtener empleados');
      }

      setEmployees(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error(error);
      alert('No se pudieron cargar los entrenadores');
    } finally {
      setLoading(false);
    }
  };

  const filteredEmployees = employees.filter((employee) => {
    const term = search.toLowerCase();
    const haystack = `${employee.first_name || ''} ${employee.last_name || ''} ${employee.position_name || ''}`.toLowerCase();
    return haystack.includes(term);
  });

  return (
    <div className="employees-page">
      <Sidebar />

      <main className="employees-content">
        <header className="employees-header">
          <div>
            <span>RECURSOS HUMANOS</span>
            <h1>Entrenadores</h1>
            <p>Consulta el personal responsable del área de entrenamiento</p>
          </div>
        </header>

        <section className="employees-panel">
          <div className="employees-toolbar">
            <div>
              <h2>Listado del personal</h2>
              <p>{filteredEmployees.length} resultados</p>
            </div>

            <input
              type="text"
              className="search-input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar entrenador..."
            />
          </div>

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Posición</th>
                  <th>Email</th>
                  <th>Teléfono</th>
                  <th>Estado</th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="5">Cargando...</td>
                  </tr>
                ) : filteredEmployees.length === 0 ? (
                  <tr>
                    <td colSpan="5">No hay entrenadores registrados.</td>
                  </tr>
                ) : (
                  filteredEmployees.map((employee) => (
                    <tr key={employee.id_employee}>
                      <td>
                        {employee.first_name} {employee.last_name}
                      </td>
                      <td>{employee.position_name || 'Sin cargo'}</td>
                      <td>{employee.email || '-'}</td>
                      <td>{employee.phone || '-'}</td>
                      <td>
                        <span className={`status ${employee.status === 'ACTIVE' ? 'active' : 'inactive'}`}>
                          {employee.status === 'ACTIVE' ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

export default Trainers;
