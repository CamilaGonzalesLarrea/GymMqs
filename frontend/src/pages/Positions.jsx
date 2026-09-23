import { useEffect, useState } from 'react';
import Sidebar from '../components/Sidebar';
import { API_URL } from '../config/api';
import './Employees.css';

function Positions() {
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    name: '',
    description: '',
    status: 'ACTIVE',
  });

  useEffect(() => {
    loadPositions();
  }, []);

  const loadPositions = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_URL}/api/positions`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Error al obtener cargos');
      }

      setPositions(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error(error);
      alert('No se pudieron cargar los cargos');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const resetForm = () => {
    setForm({ name: '', description: '', status: 'ACTIVE' });
    setEditing(null);
    setShowForm(false);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    try {
      const url = editing
        ? `${API_URL}/api/positions/${editing.id_position}`
        : `${API_URL}/api/positions`;
      const method = editing ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'No se pudo guardar el cargo');
      }

      alert(
        editing
          ? 'Cargo actualizado correctamente'
          : 'Cargo registrado correctamente',
      );
      resetForm();
      await loadPositions();
    } catch (error) {
      console.error(error);
      alert(error.message || 'No se pudo guardar el cargo');
    }
  };

  const handleEdit = (position) => {
    setEditing(position);
    setForm({
      name: position.name || '',
      description: position.description || '',
      status: position.status || 'ACTIVE',
    });
    setShowForm(true);
  };

  const toggleStatus = async (position) => {
    const nextStatus = position.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';

    try {
      const response = await fetch(
        `${API_URL}/api/positions/${position.id_position}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...position,
            status: nextStatus,
          }),
        },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'No se pudo cambiar el estado');
      }

      await loadPositions();
    } catch (error) {
      console.error(error);
      alert(error.message || 'No se pudo cambiar el estado');
    }
  };

  const filteredPositions = positions.filter((position) => {
    const text = `${position.name || ''} ${position.description || ''}`
      .toLowerCase();
    return text.includes(search.toLowerCase());
  });

  return (
    <div className="employees-page">
      <Sidebar />

      <main className="employees-content">
        <header className="employees-header">
          <div>
            <span>RECURSOS HUMANOS</span>
            <h1>Cargos</h1>
            <p>Administra los cargos del personal del gimnasio</p>
          </div>

          <button
            type="button"
            className="new-employee-button"
            onClick={() => {
              setEditing(null);
              setForm({ name: '', description: '', status: 'ACTIVE' });
              setShowForm(true);
            }}
          >
            + Nuevo cargo
          </button>
        </header>

        <section className="employees-panel">
          <div className="employees-toolbar">
            <div>
              <h2>Listado de cargos</h2>
              <p>{positions.length} cargos registrados</p>
            </div>

            <input
              type="text"
              className="search-input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar cargo..."
            />
          </div>

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Descripción</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="4">Cargando...</td>
                  </tr>
                ) : filteredPositions.length === 0 ? (
                  <tr>
                    <td colSpan="4">No hay cargos para mostrar.</td>
                  </tr>
                ) : (
                  filteredPositions.map((position) => (
                    <tr key={position.id_position}>
                      <td>{position.name}</td>
                      <td>{position.description || '-'}</td>
                      <td>
                        <span
                          className={`status ${
                            position.status === 'ACTIVE' ? 'active' : 'inactive'
                          }`}
                        >
                          {position.status === 'ACTIVE' ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="action-button"
                          onClick={() => handleEdit(position)}
                          style={{ marginRight: '8px' }}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="action-button"
                          onClick={() => toggleStatus(position)}
                        >
                          {position.status === 'ACTIVE'
                            ? 'Desactivar'
                            : 'Activar'}
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
                  <h2>{editing ? 'Editar cargo' : 'Nuevo cargo'}</h2>
                </div>

                <button
                  type="button"
                  className="close-button"
                  onClick={resetForm}
                >
                  ×
                </button>
              </div>

              <form onSubmit={handleSubmit}>
                <div className="form-grid">
                  <div className="form-group full">
                    <label htmlFor="position-name">Nombre</label>
                    <input
                      id="position-name"
                      name="name"
                      value={form.name}
                      onChange={handleChange}
                      placeholder="Ej. Recepcionista"
                      required
                    />
                  </div>

                  <div className="form-group full">
                    <label htmlFor="position-description">Descripción</label>
                    <textarea
                      id="position-description"
                      name="description"
                      value={form.description}
                      onChange={handleChange}
                      placeholder="Descripción del cargo"
                    />
                  </div>

                  <div className="form-group full">
                    <label htmlFor="position-status">Estado</label>
                    <select
                      id="position-status"
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
                  <button
                    type="button"
                    className="cancel-button"
                    onClick={resetForm}
                  >
                    Cancelar
                  </button>
                  <button type="submit" className="save-button">
                    {editing ? 'Guardar cambios' : 'Guardar cargo'}
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

export default Positions;
