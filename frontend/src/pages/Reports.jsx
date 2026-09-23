import { useEffect, useState } from 'react';
import Sidebar from '../components/Sidebar';
import { API_URL } from '../config/api';
import './Employees.css';

function Reports() {
  const [employees, setEmployees] = useState([]);
  const [positions, setPositions] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);

      const [employeesResponse, positionsResponse, attendanceResponse] = await Promise.all([
        fetch(`${API_URL}/api/employees`),
        fetch(`${API_URL}/api/positions`),
        fetch(`${API_URL}/api/employee-attendance`),
      ]);

      const employeesData = await employeesResponse.json();
      const positionsData = await positionsResponse.json();
      const attendanceData = await attendanceResponse.json();

      if (!employeesResponse.ok || !positionsResponse.ok || !attendanceResponse.ok) {
        throw new Error('No se pudieron cargar los datos de reportes');
      }

      setEmployees(Array.isArray(employeesData) ? employeesData : []);
      setPositions(Array.isArray(positionsData) ? positionsData : []);
      setAttendance(Array.isArray(attendanceData) ? attendanceData : []);
    } catch (error) {
      console.error(error);
      alert('No se pudieron cargar los reportes');
    } finally {
      setLoading(false);
    }
  };

  const activeEmployees = employees.filter((employee) => employee.status === 'ACTIVE');
  const inactiveEmployees = employees.filter((employee) => employee.status !== 'ACTIVE');
  const activePositions = positions.filter((position) => position.status === 'ACTIVE');

  const summary = [
    { label: 'Empleados', value: employees.length },
    { label: 'Activos', value: activeEmployees.length },
    { label: 'Inactivos', value: inactiveEmployees.length },
    { label: 'Cargos activos', value: activePositions.length },
    { label: 'Asistencias', value: attendance.length },
  ];

  return (
    <div className="employees-page">
      <Sidebar />

      <main className="employees-content">
        <header className="employees-header">
          <div>
            <span>RECURSOS HUMANOS</span>
            <h1>Reportes</h1>
            <p>Resumen del personal y del desempeño operativo</p>
          </div>
        </header>

        <section className="employees-panel" style={{ padding: '24px' }}>
          {loading ? (
            <p>Cargando reportes...</p>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                {summary.map((item) => (
                  <div key={item.label} style={{ background: '#171717', border: '1px solid #292929', borderRadius: '12px', padding: '18px 16px' }}>
                    <div style={{ color: '#777', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1px' }}>{item.label}</div>
                    <div style={{ marginTop: '8px', fontSize: '28px', fontWeight: 700, color: '#fff' }}>{item.value}</div>
                  </div>
                ))}
              </div>

              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Empleado</th>
                      <th>Cargo</th>
                      <th>Estado</th>
                      <th>Email</th>
                    </tr>
                  </thead>

                  <tbody>
                    {employees.length === 0 ? (
                      <tr>
                        <td colSpan="4">No hay empleados para reportar.</td>
                      </tr>
                    ) : (
                      employees.map((employee) => (
                        <tr key={employee.id_employee}>
                          <td>
                            {employee.first_name} {employee.last_name}
                          </td>
                          <td>{employee.position_name || 'Sin cargo'}</td>
                          <td>
                            <span className={`status ${employee.status === 'ACTIVE' ? 'active' : 'inactive'}`}>
                              {employee.status === 'ACTIVE' ? 'Activo' : 'Inactivo'}
                            </span>
                          </td>
                          <td>{employee.email || '-'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

export default Reports;
