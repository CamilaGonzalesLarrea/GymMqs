import { useEffect, useState } from 'react';
import Sidebar from '../components/Sidebar';
import './Employees.css';

const API_URL = 'http://localhost:3000';

const SHIFT_DAYS = [
  { value: 'MONDAY', label: 'LUNES' },
  { value: 'TUESDAY', label: 'MARTES' },
  { value: 'WEDNESDAY', label: 'MIERCOLES' },
  { value: 'THURSDAY', label: 'JUEVES' },
  { value: 'FRIDAY', label: 'VIERNES' },
  { value: 'SATURDAY', label: 'SABADO' },
  { value: 'SUNDAY', label: 'DOMINGO' },
];

const DAY_LABELS = Object.fromEntries(
  SHIFT_DAYS.map((day) => [day.value, day.label]),
);

function Shifts() {
  const [shifts, setShifts] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    id_employee: '',
    days: ['MONDAY'],
    start_time: '08:00',
    end_time: '16:00',
    status: 'ACTIVE',
  });

  useEffect(() => {
    loadEmployees();
    loadShifts();
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
      setLoading(true);
      const response = await fetch(`${API_URL}/api/shifts`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Error al obtener turnos');
      }
      setShifts(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error(error);
      alert('No se pudieron cargar los turnos');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setShowForm(false);
    setEditing(null);
    setForm({
      id_employee: '',
      days: ['MONDAY'],
      start_time: '08:00',
      end_time: '16:00',
      status: 'ACTIVE',
    });
  };

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const handleDayChange = (event) => {
    const { value, checked } = event.target;
    setForm((current) => ({
      ...current,
      days: checked
        ? [...current.days, value]
        : current.days.filter((day) => day !== value),
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (form.days.length === 0) {
      alert('Seleccione al menos un día');
      return;
    }

    try {
      const requests = editing ? [editing.id_shift] : form.days;
      const responses = await Promise.all(requests.map((dayOrId) => {
        const url = editing
          ? `${API_URL}/api/shifts/${dayOrId}`
          : `${API_URL}/api/shifts`;
        return fetch(url, {
          method: editing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id_employee: form.id_employee,
            day: editing ? form.days[0] : dayOrId,
            start_time: form.start_time,
            end_time: form.end_time,
            status: form.status,
          }),
        });
      }));
      const failedResponse = responses.find((response) => !response.ok);
      if (failedResponse) {
        const data = await failedResponse.json();
        throw new Error(data.message || 'No se pudo guardar el turno');
      }

      alert(
        editing ? 'Turno actualizado correctamente' : 'Turno registrado correctamente',
      );
      resetForm();
      await loadShifts();
    } catch (error) {
      console.error(error);
      alert(error.message || 'No se pudo guardar el turno');
    }
  };

  const handleEdit = (shift) => {
    const dayValue = shift.day_of_week || shift.day || 'MONDAY';

    setEditing(shift);
    setForm({
      id_employee: String(shift.id_employee || ''),
      days: [dayValue],
      start_time: shift.start_time || '08:00',
      end_time: shift.end_time || '16:00',
      status: shift.status || 'ACTIVE',
    });
    setShowForm(true);
  };

  const filteredShifts = shifts.filter((shift) => {
    const employeeName = shift.employee_name || '';
    const day = shift.day_of_week || shift.day || '';
    const searchText = search.toLowerCase();
    return employeeName.toLowerCase().includes(searchText) || day.toLowerCase().includes(searchText);
  });

  return (
    <div className="employees-page">
      <Sidebar />

      <main className="employees-content">
        <header className="employees-header">
          <div>
            <span>RECURSOS HUMANOS</span>
            <h1>Turnos</h1>
            <p>Asigna horarios laborales al personal</p>
          </div>

          <button
            type="button"
            className="new-employee-button"
            onClick={() => {
              resetForm();
              setShowForm(true);
            }}
          >
            + Nuevo turno
          </button>
        </header>

        <section className="employees-panel">
          <div className="employees-toolbar">
            <div>
              <h2>Horarios del personal</h2>
              <p>{shifts.length} turnos registrados</p>
            </div>

            <input
              type="text"
              className="search-input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar turno..."
            />
          </div>

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Empleado</th>
                  <th>Día</th>
                  <th>Entrada</th>
                  <th>Salida</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="6">Cargando...</td>
                  </tr>
                ) : filteredShifts.length === 0 ? (
                  <tr>
                    <td colSpan="6">No hay turnos para mostrar.</td>
                  </tr>
                ) : (
                  filteredShifts.map((shift) => (
                    <tr key={shift.id_shift}>
                      <td>{shift.employee_name || 'Sin empleado'}</td>
                      <td>{DAY_LABELS[shift.day_of_week || shift.day] || shift.day_of_week || shift.day}</td>
                      <td>{shift.start_time}</td>
                      <td>{shift.end_time}</td>
                      <td>
                        <span
                          className={`status ${
                            shift.status === 'ACTIVE' ? 'active' : 'inactive'
                          }`}
                        >
                          {shift.status === 'ACTIVE' ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="action-button"
                          onClick={() => handleEdit(shift)}
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
                  <h2>{editing ? 'Editar turno' : 'Nuevo turno'}</h2>
                </div>
                <button type="button" className="close-button" onClick={resetForm}>×</button>
              </div>

              <form onSubmit={handleSubmit}>
                <div className="form-grid">
                  <div className="form-group">
                    <label htmlFor="shift-employee">Empleado</label>
                    <select
                      id="shift-employee"
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

                  <div className="form-group full">
                    <span className="form-label">Días</span>
                    <div className="checkbox-group">
                      {SHIFT_DAYS.map((day) => (
                        <label key={day.value}>
                          <input
                            type="checkbox"
                            value={day.value}
                            checked={form.days.includes(day.value)}
                            onChange={handleDayChange}
                            disabled={Boolean(editing) && form.days[0] !== day.value}
                          />
                          {day.label}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="form-group">
                    <label htmlFor="shift-entry">Hora de entrada</label>
                    <input
                      id="shift-entry"
                      type="time"
                      name="start_time"
                      value={form.start_time}
                      onChange={handleChange}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="shift-exit">Hora de salida</label>
                    <input
                      id="shift-exit"
                      type="time"
                      name="end_time"
                      value={form.end_time}
                      onChange={handleChange}
                      required
                    />
                  </div>

                  <div className="form-group full">
                    <label htmlFor="shift-status">Estado</label>
                    <select
                      id="shift-status"
                      name="status"
                      value={form.status}
                      onChange={handleChange}
                    >
                      <option value="ACTIVE">Activo</option>
                      <option value="INACTIVE">Inactivo</option>
                    </select>
                  </div>
                </div>

                <div className="modal-actions">
                  <button type="button" className="cancel-button" onClick={resetForm}>Cancelar</button>
                  <button type="submit" className="save-button">
                    {editing ? 'Guardar cambios' : 'Guardar turno'}
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

export default Shifts;
