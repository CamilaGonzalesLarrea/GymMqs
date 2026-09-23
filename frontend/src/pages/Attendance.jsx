import { useEffect, useState } from 'react';
import Sidebar from '../components/Sidebar';
import './Employees.css';

const API_URL = 'http://localhost:3000';

const DAY_LABELS = {
  MONDAY: 'LUNES',
  TUESDAY: 'MARTES',
  WEDNESDAY: 'MIERCOLES',
  THURSDAY: 'JUEVES',
  FRIDAY: 'VIERNES',
  SATURDAY: 'SABADO',
  SUNDAY: 'DOMINGO',
};

function Attendance() {
  const [attendance, setAttendance] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    id_employee: '',
    id_shift: '',
    attendance_date: new Date().toISOString().slice(0, 10),
    check_in: '08:00',
    check_out: '',
    notes: '',
  });

  useEffect(() => {
    loadEmployees();
    loadShifts();
    loadAttendance();
  }, []);

  const loadEmployees = async () => {
    try {
      const response = await fetch(`${API_URL}/api/employees`);
      const data = await response.json();
      if (response.ok) setEmployees(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error cargando empleados', error);
    }
  };

  const loadShifts = async () => {
    try {
      const response = await fetch(`${API_URL}/api/shifts`);
      const data = await response.json();
      if (response.ok) setShifts(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error cargando turnos', error);
    }
  };

  const loadAttendance = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_URL}/api/employee-attendance`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Error al obtener asistencia');
      }
      setAttendance(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error(error);
      alert('No se pudo cargar el historial de asistencia');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setShowForm(false);
    setEditing(null);
    setForm({
      id_employee: '',
      id_shift: '',
      attendance_date: new Date().toISOString().slice(0, 10),
      check_in: '08:00',
      check_out: '',
      notes: '',
    });
  };

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    try {
      const url = editing
        ? `${API_URL}/api/employee-attendance/${editing.id_employee_attendance}`
        : `${API_URL}/api/employee-attendance`;
      const method = editing ? 'PUT' : 'POST';

      const payload = {
        ...form,
        date: form.attendance_date || form.date,
        entry_time: form.check_in || form.entry_time,
        exit_time: form.check_out || form.exit_time,
        attendance_date: form.attendance_date || form.date,
        check_in: form.check_in || form.entry_time,
        check_out: form.check_out || form.exit_time,
      };

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'No se pudo guardar la asistencia');
      }

      alert(
        editing
          ? 'Asistencia actualizada correctamente'
          : 'Asistencia registrada correctamente',
      );
      resetForm();
      await loadAttendance();
    } catch (error) {
      console.error(error);
      alert(error.message || 'No se pudo guardar la asistencia');
    }
  };

  const handleEdit = (record) => {
    setEditing(record);
    setForm({
      id_employee: String(record.id_employee || ''),
      id_shift: record.id_shift ? String(record.id_shift) : '',
      attendance_date: record.attendance_date || record.date || new Date().toISOString().slice(0, 10),
      check_in: record.check_in || record.entry_time || '08:00',
      check_out: record.check_out || record.exit_time || '',
      notes: record.notes || '',
    });
    setShowForm(true);
  };

  const filteredAttendance = attendance.filter((record) => {
    const employeeName = record.employee_name || '';
    const searchText = search.toLowerCase();
    return employeeName.toLowerCase().includes(searchText) || (record.date || '').includes(searchText);
  });

  return (
    <div className="employees-page">
      <Sidebar />

      <main className="employees-content">
        <header className="employees-header">
          <div>
            <span>RECURSOS HUMANOS</span>
            <h1>Asistencia</h1>
            <p>Controla la entrada y salida del personal</p>
          </div>

          <button
            type="button"
            className="new-employee-button"
            onClick={() => {
              resetForm();
              setShowForm(true);
            }}
          >
            + Registrar asistencia
          </button>
        </header>

        <section className="employees-panel">
          <div className="employees-toolbar">
            <div>
              <h2>Historial de asistencia</h2>
              <p>{attendance.length} registros</p>
            </div>

            <input
              type="text"
              className="search-input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar empleado o fecha..."
            />
          </div>

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Empleado</th>
                  <th>Fecha</th>
                  <th>Entrada</th>
                  <th>Salida</th>
                  <th>Notas</th>
                  <th>Acciones</th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="6">Cargando...</td>
                  </tr>
                ) : filteredAttendance.length === 0 ? (
                  <tr>
                    <td colSpan="6">No existe historial de asistencia.</td>
                  </tr>
                ) : (
                  filteredAttendance.map((record) => (
                    <tr key={record.id_employee_attendance}>
                      <td>{record.employee_name || 'Sin empleado'}</td>
                      <td>{record.date}</td>
                      <td>{record.entry_time}</td>
                      <td>{record.exit_time || '-'}</td>
                      <td>{record.notes || '-'}</td>
                      <td>
                        <button
                          type="button"
                          className="action-button"
                          onClick={() => handleEdit(record)}
                        >
                          Editar
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {showForm && (
          <div className="modal-background" onClick={resetForm}>
            <div
              className="employee-modal"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="modal-header">
                <div>
                  <span>RRHH</span>
                  <h2>{editing ? 'Editar asistencia' : 'Nueva asistencia'}</h2>
                </div>
                <button type="button" className="close-button" onClick={resetForm}>×</button>
              </div>

              <form onSubmit={handleSubmit}>
                <div className="form-grid">
                  <div className="form-group">
                    <label htmlFor="attendance-employee">Empleado</label>
                    <select
                      id="attendance-employee"
                      name="id_employee"
                      value={form.id_employee}
                      onChange={handleChange}
                      required
                    >
                      <option value="">Seleccione un empleado</option>
                      {employees.map((employee) => (
                        <option key={employee.id_employee} value={employee.id_employee}>
                          {employee.first_name} {employee.last_name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label htmlFor="attendance-shift">Turno</label>
                    <select
                      id="attendance-shift"
                      name="id_shift"
                      value={form.id_shift}
                      onChange={handleChange}
                      required
                    >
                      <option value="">Seleccione un turno</option>
                      {shifts
                        .filter((shift) => !form.id_employee || String(shift.id_employee) === String(form.id_employee))
                        .map((shift) => (
                          <option key={shift.id_shift} value={shift.id_shift}>
                            {shift.employee_name} - {DAY_LABELS[shift.day || shift.day_of_week] || shift.day || shift.day_of_week} ({shift.start_time} - {shift.end_time})
                          </option>
                        ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label htmlFor="attendance-date">Fecha</label>
                    <input
                      id="attendance-date"
                      type="date"
                      name="attendance_date"
                      value={form.attendance_date}
                      onChange={handleChange}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="attendance-entry">Hora de entrada</label>
                    <input
                      id="attendance-entry"
                      type="time"
                      name="check_in"
                      value={form.check_in}
                      onChange={handleChange}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="attendance-exit">Hora de salida</label>
                    <input
                      id="attendance-exit"
                      type="time"
                      name="check_out"
                      value={form.check_out}
                      onChange={handleChange}
                    />
                  </div>

                  <div className="form-group full">
                    <label htmlFor="attendance-notes">Notas</label>
                    <textarea
                      id="attendance-notes"
                      name="notes"
                      value={form.notes}
                      onChange={handleChange}
                      placeholder="Observaciones de la asistencia"
                    />
                  </div>
                </div>

                <div className="modal-actions">
                  <button type="button" className="cancel-button" onClick={resetForm}>Cancelar</button>
                  <button type="submit" className="save-button">
                    {editing ? 'Guardar cambios' : 'Guardar asistencia'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default Attendance;
