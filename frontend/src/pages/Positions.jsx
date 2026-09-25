import { useEffect, useMemo, useState } from 'react';
import Sidebar from '../components/Sidebar';
import { API_URL } from '../config/api';
import './Employees.css';

const createEmptyForm = () => ({
  name: '',
  description: '',
  status: 'ACTIVE',
});

const parseResponse = async (response) => {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
};

const getErrorMessage = (data, fallback) => {
  if (
    data &&
    typeof data === 'object' &&
    typeof data.message === 'string' &&
    data.message.trim()
  ) {
    return data.message;
  }

  return fallback;
};

const normalizeText = (value) =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ');

const isActive = (value) =>
  String(value || '').toUpperCase() === 'ACTIVE';

const getEmployeeCount = (position) => {
  const value =
    position.employee_count ??
    position.total_employees ??
    0;

  const number = Number(value);

  return Number.isFinite(number) ? number : 0;
};

const getActiveEmployeeCount = (position) => {
  const value =
    position.active_employee_count ??
    position.active_employees ??
    0;

  const number = Number(value);

  return Number.isFinite(number) ? number : 0;
};

function Positions() {
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusChangingId, setStatusChangingId] =
    useState(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] =
    useState('');

  const [showForm, setShowForm] =
    useState(false);
  const [editing, setEditing] =
    useState(null);
  const [selectedPosition, setSelectedPosition] =
    useState(null);

  const [form, setForm] =
    useState(createEmptyForm);

  const [pageError, setPageError] =
    useState('');
  const [formError, setFormError] =
    useState('');
  const [feedback, setFeedback] =
    useState('');

  const requestJson = async (
    url,
    options = {},
    fallbackMessage = 'Ocurrió un error',
  ) => {
    const response = await fetch(
      url,
      options,
    );

    const data = await parseResponse(response);

    if (!response.ok) {
      throw new Error(
        getErrorMessage(
          data,
          fallbackMessage,
        ),
      );
    }

    return data;
  };

  const loadPositions = async () => {
    try {
      setLoading(true);
      setPageError('');

      const data = await requestJson(
        `${API_URL}/api/positions`,
        {},
        'No se pudieron cargar los cargos',
      );

      setPositions(
        Array.isArray(data)
          ? data
          : [],
      );
    } catch (error) {
      console.error(error);

      setPageError(
        error.message ||
          'No se pudieron cargar los cargos',
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPositions();
  }, []);

  useEffect(() => {
    if (
      !showForm &&
      !selectedPosition
    ) {
      return undefined;
    }

    const handleEscape = (event) => {
      if (event.key !== 'Escape') {
        return;
      }

      if (
        saving ||
        statusChangingId
      ) {
        return;
      }

      if (showForm) {
        resetForm();
        return;
      }

      setSelectedPosition(null);
    };

    window.addEventListener(
      'keydown',
      handleEscape,
    );

    return () => {
      window.removeEventListener(
        'keydown',
        handleEscape,
      );
    };
  }, [
    selectedPosition,
    showForm,
    saving,
    statusChangingId,
  ]);

  const filteredPositions =
    useMemo(() => {
      const normalizedSearch =
        search
          .trim()
          .toLowerCase();

      return positions
        .filter((position) => {
          if (
            statusFilter &&
            String(
              position.status,
            ).toUpperCase() !==
              statusFilter
          ) {
            return false;
          }

          if (!normalizedSearch) {
            return true;
          }

          const values = [
            position.name,
            position.description,
            isActive(position.status)
              ? 'activo'
              : 'inactivo',
            getEmployeeCount(position),
            getActiveEmployeeCount(position),
          ];

          return values.some(
            (value) =>
              String(value || '')
                .toLowerCase()
                .includes(
                  normalizedSearch,
                ),
          );
        })
        .sort((a, b) => {
          const statusA =
            isActive(a.status)
              ? 0
              : 1;

          const statusB =
            isActive(b.status)
              ? 0
              : 1;

          if (
            statusA !== statusB
          ) {
            return statusA - statusB;
          }

          return String(
            a.name || '',
          ).localeCompare(
            String(
              b.name || '',
            ),
            'es',
          );
        });
    }, [
      positions,
      search,
      statusFilter,
    ]);

  const summary = useMemo(() => {
    const active =
      positions.filter(
        (position) =>
          isActive(
            position.status,
          ),
      ).length;

    const inactive =
      positions.length - active;

    const employeesAssigned =
      positions.reduce(
        (total, position) =>
          total +
          getEmployeeCount(
            position,
          ),
        0,
      );

    const activeEmployeesAssigned =
      positions.reduce(
        (total, position) =>
          total +
          getActiveEmployeeCount(
            position,
          ),
        0,
      );

    return {
      total: positions.length,
      active,
      inactive,
      employeesAssigned,
      activeEmployeesAssigned,
    };
  }, [positions]);

  const resetForm = () => {
    setForm(
      createEmptyForm(),
    );
    setEditing(null);
    setShowForm(false);
    setFormError('');
  };

  const openCreateForm = () => {
    setEditing(null);
    setSelectedPosition(null);
    setForm(
      createEmptyForm(),
    );
    setFormError('');
    setFeedback('');
    setShowForm(true);
  };

  const handleEdit = (
    position,
  ) => {
    setEditing(position);
    setSelectedPosition(null);
    setFormError('');
    setFeedback('');

    setForm({
      name:
        position.name || '',
      description:
        position.description || '',
      status:
        position.status ||
        'ACTIVE',
    });

    setShowForm(true);
  };

  const handleChange = (
    event,
  ) => {
    const {
      name,
      value,
    } = event.target;

    setFormError('');

    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const validateForm = () => {
    const name =
      normalizeText(
        form.name,
      );

    const description =
      normalizeText(
        form.description,
      );

    if (!name) {
      return 'El nombre del cargo es obligatorio';
    }

    if (
      name.length > 80
    ) {
      return 'El nombre del cargo no puede superar 80 caracteres';
    }

    if (
      description.length > 500
    ) {
      return 'La descripción no puede superar 500 caracteres';
    }

    const duplicate =
      positions.find(
        (position) => {
          if (
            editing &&
            String(
              position.id_position,
            ) ===
              String(
                editing.id_position,
              )
          ) {
            return false;
          }

          return (
            normalizeText(
              position.name,
            ).toLowerCase() ===
            name.toLowerCase()
          );
        },
      );

    if (duplicate) {
      return 'Ya existe un cargo con ese nombre';
    }

    if (
      editing &&
      form.status ===
        'INACTIVE' &&
      getActiveEmployeeCount(
        editing,
      ) > 0
    ) {
      return `No se puede inactivar el cargo porque tiene ${getActiveEmployeeCount(
        editing,
      )} empleado(s) activo(s) asignado(s)`;
    }

    return '';
  };

  const handleSubmit = async (
    event,
  ) => {
    event.preventDefault();

    const validationError =
      validateForm();

    if (validationError) {
      setFormError(
        validationError,
      );
      return;
    }

    try {
      setSaving(true);
      setFormError('');
      setFeedback('');

      const url = editing
        ? `${API_URL}/api/positions/${editing.id_position}`
        : `${API_URL}/api/positions`;

      const method = editing
        ? 'PUT'
        : 'POST';

      const payload = {
        name:
          normalizeText(
            form.name,
          ),
        description:
          normalizeText(
            form.description,
          ) || null,
        status:
          form.status,
      };

      await requestJson(
        url,
        {
          method,
          headers: {
            'Content-Type':
              'application/json',
          },
          body:
            JSON.stringify(
              payload,
            ),
        },
        editing
          ? 'No se pudo actualizar el cargo'
          : 'No se pudo registrar el cargo',
      );

      const message =
        editing
          ? 'Cargo actualizado correctamente'
          : 'Cargo registrado correctamente';

      resetForm();
      setFeedback(
        message,
      );

      await loadPositions();
    } catch (error) {
      console.error(error);

      setFormError(
        error.message ||
          'No se pudo guardar el cargo',
      );
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (
    position,
  ) => {
    const nextStatus =
      isActive(
        position.status,
      )
        ? 'INACTIVE'
        : 'ACTIVE';

    const activeEmployeeCount =
      getActiveEmployeeCount(
        position,
      );

    if (
      nextStatus ===
        'INACTIVE' &&
      activeEmployeeCount > 0
    ) {
      setPageError(
        `No se puede inactivar "${position.name}" porque tiene ${activeEmployeeCount} empleado(s) activo(s) asignado(s). Primero reasigna o inactiva a esos empleados.`,
      );
      return;
    }

    const action =
      nextStatus ===
      'ACTIVE'
        ? 'activar'
        : 'inactivar';

    const confirmed =
      window.confirm(
        `¿Desea ${action} el cargo "${position.name}"?`,
      );

    if (!confirmed) {
      return;
    }

    try {
      setStatusChangingId(
        position.id_position,
      );
      setPageError('');
      setFeedback('');

      await requestJson(
        `${API_URL}/api/positions/${position.id_position}/status`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type':
              'application/json',
          },
          body:
            JSON.stringify({
              status:
                nextStatus,
            }),
        },
        `No se pudo ${action} el cargo`,
      );

      setFeedback(
        nextStatus ===
        'ACTIVE'
          ? 'Cargo activado correctamente'
          : 'Cargo inactivado correctamente',
      );

      if (
        selectedPosition &&
        String(
          selectedPosition.id_position,
        ) ===
          String(
            position.id_position,
          )
      ) {
        setSelectedPosition(null);
      }

      await loadPositions();
    } catch (error) {
      console.error(error);

      setPageError(
        error.message ||
          `No se pudo ${action} el cargo`,
      );
    } finally {
      setStatusChangingId(
        null,
      );
    }
  };

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('');
  };

  const statCardStyle = {
    background: '#121212',
    border:
      '1px solid #292929',
    borderRadius: '12px',
    padding: '18px 20px',
    minWidth: '150px',
    flex: '1 1 160px',
  };

  const statLabelStyle = {
    color: '#777777',
    fontSize: '11px',
    textTransform:
      'uppercase',
    letterSpacing: '1px',
    marginBottom: '8px',
  };

  const statValueStyle = {
    color: '#ffffff',
    fontSize: '25px',
    fontWeight: '700',
  };

  const filterInputStyle = {
    minWidth: '170px',
    padding: '10px 12px',
    background: '#1a1a1a',
    border:
      '1px solid #333333',
    borderRadius: '8px',
    color: '#ffffff',
    outline: 'none',
  };

  return (
    <div className="employees-page">
      <Sidebar />

      <main className="employees-content">
        <header className="employees-header">
          <div>
            <span>
              RECURSOS HUMANOS
            </span>
            <h1>Cargos</h1>
            <p>
              Administra los cargos y su asignación al personal del gimnasio
            </p>
          </div>

          <button
            type="button"
            className="new-employee-button"
            onClick={
              openCreateForm
            }
            disabled={loading}
          >
            + Nuevo cargo
          </button>
        </header>

        {feedback && (
          <div
            style={{
              marginBottom:
                '20px',
              padding:
                '13px 16px',
              borderRadius:
                '8px',
              border:
                '1px solid rgba(30, 150, 80, 0.35)',
              background:
                'rgba(30, 150, 80, 0.10)',
              color:
                '#5cc98a',
              fontSize:
                '13px',
            }}
          >
            {feedback}
          </div>
        )}

        {pageError && (
          <div
            style={{
              marginBottom:
                '20px',
              padding:
                '13px 16px',
              borderRadius:
                '8px',
              border:
                '1px solid rgba(224, 0, 45, 0.35)',
              background:
                'rgba(224, 0, 45, 0.10)',
              color:
                '#ff6b82',
              fontSize:
                '13px',
            }}
          >
            <div
              style={{
                display:
                  'flex',
                justifyContent:
                  'space-between',
                alignItems:
                  'center',
                gap: '12px',
              }}
            >
              <span>
                {pageError}
              </span>

              <button
                type="button"
                onClick={() =>
                  setPageError(
                    '',
                  )
                }
                style={{
                  border:
                    'none',
                  background:
                    'transparent',
                  color:
                    '#ff6b82',
                  cursor:
                    'pointer',
                  fontSize:
                    '18px',
                }}
              >
                ×
              </button>
            </div>
          </div>
        )}

        <section
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '14px',
            marginBottom:
              '20px',
          }}
        >
          <div
            style={
              statCardStyle
            }
          >
            <div
              style={
                statLabelStyle
              }
            >
              Total cargos
            </div>
            <div
              style={
                statValueStyle
              }
            >
              {summary.total}
            </div>
          </div>

          <div
            style={
              statCardStyle
            }
          >
            <div
              style={
                statLabelStyle
              }
            >
              Activos
            </div>
            <div
              style={
                statValueStyle
              }
            >
              {summary.active}
            </div>
          </div>

          <div
            style={
              statCardStyle
            }
          >
            <div
              style={
                statLabelStyle
              }
            >
              Inactivos
            </div>
            <div
              style={
                statValueStyle
              }
            >
              {summary.inactive}
            </div>
          </div>

          <div
            style={
              statCardStyle
            }
          >
            <div
              style={
                statLabelStyle
              }
            >
              Empleados asignados
            </div>
            <div
              style={
                statValueStyle
              }
            >
              {
                summary.employeesAssigned
              }
            </div>
          </div>

          <div
            style={
              statCardStyle
            }
          >
            <div
              style={
                statLabelStyle
              }
            >
              Personal activo
            </div>
            <div
              style={
                statValueStyle
              }
            >
              {
                summary.activeEmployeesAssigned
              }
            </div>
          </div>
        </section>

        <section
          className="employees-panel"
          style={{
            marginBottom:
              '20px',
          }}
        >
          <div
            style={{
              padding:
                '20px 25px',
              borderBottom:
                '1px solid #292929',
            }}
          >
            <div
              style={{
                display:
                  'flex',
                flexWrap:
                  'wrap',
                alignItems:
                  'end',
                gap: '12px',
              }}
            >
              <div
                style={{
                  display:
                    'flex',
                  flexDirection:
                    'column',
                  gap: '6px',
                }}
              >
                <label
                  style={{
                    color:
                      '#888888',
                    fontSize:
                      '11px',
                  }}
                >
                  Estado
                </label>

                <select
                  value={
                    statusFilter
                  }
                  onChange={(
                    event,
                  ) =>
                    setStatusFilter(
                      event
                        .target
                        .value,
                    )
                  }
                  style={
                    filterInputStyle
                  }
                >
                  <option value="">
                    Todos
                  </option>
                  <option value="ACTIVE">
                    Activos
                  </option>
                  <option value="INACTIVE">
                    Inactivos
                  </option>
                </select>
              </div>

              <button
                type="button"
                className="cancel-button"
                onClick={
                  clearFilters
                }
                disabled={loading}
              >
                Limpiar filtros
              </button>
            </div>
          </div>
        </section>

        <section className="employees-panel">
          <div className="employees-toolbar">
            <div>
              <h2>
                Listado de cargos
              </h2>
              <p>
                {
                  filteredPositions.length
                }{' '}
                cargo
                {filteredPositions.length ===
                1
                  ? ''
                  : 's'}{' '}
                encontrado
                {filteredPositions.length ===
                1
                  ? ''
                  : 's'}
              </p>
            </div>

            <input
              type="text"
              className="search-input"
              value={search}
              onChange={(
                event,
              ) =>
                setSearch(
                  event.target
                    .value,
                )
              }
              placeholder="Buscar nombre o descripción..."
            />
          </div>

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>
                    Nombre
                  </th>
                  <th>
                    Descripción
                  </th>
                  <th>
                    Personal
                  </th>
                  <th>
                    Activos
                  </th>
                  <th>
                    Estado
                  </th>
                  <th>
                    Acciones
                  </th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td
                      colSpan="6"
                    >
                      Cargando...
                    </td>
                  </tr>
                ) : filteredPositions.length ===
                  0 ? (
                  <tr>
                    <td
                      colSpan="6"
                    >
                      No hay cargos para mostrar.
                    </td>
                  </tr>
                ) : (
                  filteredPositions.map(
                    (
                      position,
                    ) => {
                      const employeeCount =
                        getEmployeeCount(
                          position,
                        );

                      const activeEmployeeCount =
                        getActiveEmployeeCount(
                          position,
                        );

                      return (
                        <tr
                          key={
                            position.id_position
                          }
                        >
                          <td>
                            <strong>
                              {
                                position.name
                              }
                            </strong>
                          </td>

                          <td>
                            {position.description ||
                              '-'}
                          </td>

                          <td>
                            {
                              employeeCount
                            }
                          </td>

                          <td>
                            {
                              activeEmployeeCount
                            }
                          </td>

                          <td>
                            <span
                              className={`status ${
                                isActive(
                                  position.status,
                                )
                                  ? 'active'
                                  : 'inactive'
                              }`}
                            >
                              {isActive(
                                position.status,
                              )
                                ? 'Activo'
                                : 'Inactivo'}
                            </span>
                          </td>

                          <td>
                            <div
                              style={{
                                display:
                                  'flex',
                                flexWrap:
                                  'wrap',
                                gap:
                                  '8px',
                              }}
                            >
                              <button
                                type="button"
                                className="action-button"
                                onClick={() =>
                                  setSelectedPosition(
                                    position,
                                  )
                                }
                                disabled={
                                  statusChangingId ===
                                  position.id_position
                                }
                              >
                                Ver
                              </button>

                              <button
                                type="button"
                                className="action-button"
                                onClick={() =>
                                  handleEdit(
                                    position,
                                  )
                                }
                                disabled={
                                  statusChangingId ===
                                  position.id_position
                                }
                              >
                                Editar
                              </button>

                              <button
                                type="button"
                                className="action-button"
                                onClick={() =>
                                  toggleStatus(
                                    position,
                                  )
                                }
                                disabled={
                                  statusChangingId ===
                                  position.id_position ||
                                  (isActive(
                                    position.status,
                                  ) &&
                                    activeEmployeeCount >
                                      0)
                                }
                                title={
                                  isActive(
                                    position.status,
                                  ) &&
                                  activeEmployeeCount >
                                    0
                                    ? 'No puede inactivarse mientras tenga empleados activos'
                                    : ''
                                }
                              >
                                {statusChangingId ===
                                position.id_position
                                  ? 'Guardando...'
                                  : isActive(
                                        position.status,
                                      )
                                    ? 'Inactivar'
                                    : 'Activar'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    },
                  )
                )}
              </tbody>
            </table>
          </div>
        </section>

        {selectedPosition && (
          <div
            className="modal-background"
            onClick={() =>
              setSelectedPosition(
                null,
              )
            }
          >
            <div
              className="employee-modal"
              onClick={(
                event,
              ) =>
                event.stopPropagation()
              }
            >
              <div className="modal-header">
                <div>
                  <span>
                    RECURSOS HUMANOS
                  </span>
                  <h2>
                    {
                      selectedPosition.name
                    }
                  </h2>
                </div>

                <button
                  type="button"
                  className="close-button"
                  onClick={() =>
                    setSelectedPosition(
                      null,
                    )
                  }
                >
                  ×
                </button>
              </div>

              <div
                style={{
                  marginBottom:
                    '18px',
                }}
              >
                <span
                  className={`status ${
                    isActive(
                      selectedPosition.status,
                    )
                      ? 'active'
                      : 'inactive'
                  }`}
                >
                  {isActive(
                    selectedPosition.status,
                  )
                    ? 'Activo'
                    : 'Inactivo'}
                </span>
              </div>

              <div className="form-grid">
                <div className="form-group">
                  <label>
                    Personal total
                  </label>
                  <input
                    value={getEmployeeCount(
                      selectedPosition,
                    )}
                    readOnly
                  />
                </div>

                <div className="form-group">
                  <label>
                    Personal activo
                  </label>
                  <input
                    value={getActiveEmployeeCount(
                      selectedPosition,
                    )}
                    readOnly
                  />
                </div>

                <div
                  className="form-group"
                  style={{
                    gridColumn:
                      '1 / -1',
                  }}
                >
                  <label>
                    Descripción
                  </label>
                  <textarea
                    value={
                      selectedPosition.description ||
                      'Sin descripción'
                    }
                    readOnly
                  />
                </div>
              </div>

              {isActive(
                selectedPosition.status,
              ) &&
                getActiveEmployeeCount(
                  selectedPosition,
                ) > 0 && (
                  <div
                    style={{
                      marginTop:
                        '15px',
                      padding:
                        '12px 14px',
                      borderRadius:
                        '8px',
                      border:
                        '1px solid rgba(255, 184, 0, 0.35)',
                      background:
                        'rgba(255, 184, 0, 0.08)',
                      color:
                        '#ffc94d',
                      fontSize:
                        '11px',
                    }}
                  >
                    Este cargo tiene personal activo asignado. No puede inactivarse hasta reasignar o inactivar a esos empleados.
                  </div>
                )}

              <div className="modal-actions">
                <button
                  type="button"
                  className="cancel-button"
                  onClick={() =>
                    setSelectedPosition(
                      null,
                    )
                  }
                >
                  Cerrar
                </button>

                <button
                  type="button"
                  className="save-button"
                  onClick={() =>
                    handleEdit(
                      selectedPosition,
                    )
                  }
                >
                  Editar
                </button>
              </div>
            </div>
          </div>
        )}

        {showForm && (
          <div
            className="modal-background"
            onClick={() => {
              if (!saving) {
                resetForm();
              }
            }}
          >
            <div
              className="employee-modal"
              onClick={(
                event,
              ) =>
                event.stopPropagation()
              }
            >
              <div className="modal-header">
                <div>
                  <span>
                    RRHH
                  </span>
                  <h2>
                    {editing
                      ? 'Editar cargo'
                      : 'Nuevo cargo'}
                  </h2>
                </div>

                <button
                  type="button"
                  className="close-button"
                  onClick={
                    resetForm
                  }
                  disabled={
                    saving
                  }
                >
                  ×
                </button>
              </div>

              {formError && (
                <div
                  style={{
                    marginBottom:
                      '18px',
                    padding:
                      '12px 14px',
                    borderRadius:
                      '8px',
                    border:
                      '1px solid rgba(224, 0, 45, 0.35)',
                    background:
                      'rgba(224, 0, 45, 0.10)',
                    color:
                      '#ff6b82',
                    fontSize:
                      '12px',
                  }}
                >
                  {formError}
                </div>
              )}

              <form
                onSubmit={
                  handleSubmit
                }
              >
                <div className="form-grid">
                  <div
                    className="form-group"
                    style={{
                      gridColumn:
                        '1 / -1',
                    }}
                  >
                    <label htmlFor="position-name">
                      Nombre
                    </label>

                    <input
                      id="position-name"
                      name="name"
                      value={
                        form.name
                      }
                      onChange={
                        handleChange
                      }
                      placeholder="Ej. Recepcionista"
                      maxLength={80}
                      autoComplete="off"
                      required
                      disabled={
                        saving
                      }
                    />

                    <span
                      style={{
                        color:
                          '#666666',
                        fontSize:
                          '10px',
                        textAlign:
                          'right',
                      }}
                    >
                      {
                        form.name.length
                      }
                      /80
                    </span>
                  </div>

                  <div
                    className="form-group"
                    style={{
                      gridColumn:
                        '1 / -1',
                    }}
                  >
                    <label htmlFor="position-description">
                      Descripción
                    </label>

                    <textarea
                      id="position-description"
                      name="description"
                      value={
                        form.description
                      }
                      onChange={
                        handleChange
                      }
                      placeholder="Descripción de las responsabilidades principales del cargo"
                      maxLength={500}
                      disabled={
                        saving
                      }
                    />

                    <span
                      style={{
                        color:
                          '#666666',
                        fontSize:
                          '10px',
                        textAlign:
                          'right',
                      }}
                    >
                      {
                        form.description.length
                      }
                      /500
                    </span>
                  </div>

                  <div
                    className="form-group"
                    style={{
                      gridColumn:
                        '1 / -1',
                    }}
                  >
                    <label htmlFor="position-status">
                      Estado
                    </label>

                    <select
                      id="position-status"
                      name="status"
                      value={
                        form.status
                      }
                      onChange={
                        handleChange
                      }
                      disabled={
                        saving
                      }
                    >
                      <option value="ACTIVE">
                        Activo
                      </option>
                      <option value="INACTIVE">
                        Inactivo
                      </option>
                    </select>
                  </div>

                  {editing && (
                    <div
                      className="form-group"
                      style={{
                        gridColumn:
                          '1 / -1',
                      }}
                    >
                      <div
                        style={{
                          padding:
                            '14px 16px',
                          background:
                            '#1a1a1a',
                          border:
                            '1px solid #333333',
                          borderRadius:
                            '8px',
                          display:
                            'grid',
                          gridTemplateColumns:
                            'repeat(auto-fit, minmax(140px, 1fr))',
                          gap:
                            '12px',
                        }}
                      >
                        <div>
                          <span
                            style={{
                              display:
                                'block',
                              color:
                                '#777777',
                              fontSize:
                                '10px',
                              marginBottom:
                                '5px',
                              textTransform:
                                'uppercase',
                            }}
                          >
                            Personal total
                          </span>

                          <strong>
                            {getEmployeeCount(
                              editing,
                            )}
                          </strong>
                        </div>

                        <div>
                          <span
                            style={{
                              display:
                                'block',
                              color:
                                '#777777',
                              fontSize:
                                '10px',
                              marginBottom:
                                '5px',
                              textTransform:
                                'uppercase',
                            }}
                          >
                            Personal activo
                          </span>

                          <strong>
                            {getActiveEmployeeCount(
                              editing,
                            )}
                          </strong>
                        </div>

                        <div>
                          <span
                            style={{
                              display:
                                'block',
                              color:
                                '#777777',
                              fontSize:
                                '10px',
                              marginBottom:
                                '5px',
                              textTransform:
                                'uppercase',
                            }}
                          >
                            Estado actual
                          </span>

                          <strong
                            style={{
                              color:
                                isActive(
                                  editing.status,
                                )
                                  ? '#5cc98a'
                                  : '#ff6b82',
                            }}
                          >
                            {isActive(
                              editing.status,
                            )
                              ? 'Activo'
                              : 'Inactivo'}
                          </strong>
                        </div>
                      </div>
                    </div>
                  )}

                  {editing &&
                    form.status ===
                      'INACTIVE' &&
                    getActiveEmployeeCount(
                      editing,
                    ) > 0 && (
                      <div
                        className="form-group"
                        style={{
                          gridColumn:
                            '1 / -1',
                        }}
                      >
                        <div
                          style={{
                            padding:
                              '12px 14px',
                            borderRadius:
                              '8px',
                            border:
                              '1px solid rgba(224, 0, 45, 0.35)',
                            background:
                              'rgba(224, 0, 45, 0.08)',
                            color:
                              '#ff8798',
                            fontSize:
                              '11px',
                          }}
                        >
                          No puedes inactivar este cargo porque todavía tiene {getActiveEmployeeCount(
                            editing,
                          )} empleado(s) activo(s) asignado(s).
                        </div>
                      </div>
                    )}
                </div>

                <div className="modal-actions">
                  <button
                    type="button"
                    className="cancel-button"
                    onClick={
                      resetForm
                    }
                    disabled={
                      saving
                    }
                  >
                    Cancelar
                  </button>

                  <button
                    type="submit"
                    className="save-button"
                    disabled={
                      saving ||
                      (editing &&
                        form.status ===
                          'INACTIVE' &&
                        getActiveEmployeeCount(
                          editing,
                        ) > 0)
                    }
                  >
                    {saving
                      ? 'Guardando...'
                      : editing
                        ? 'Guardar cambios'
                        : 'Guardar cargo'}
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
