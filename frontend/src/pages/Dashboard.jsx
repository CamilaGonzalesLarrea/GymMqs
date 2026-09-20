import "./Dashboard.css";

function Dashboard() {

    return (

        <div className="dashboard">

            <aside className="sidebar">

                <img
                    src="/images/logo.jpg"
                    className="logo"
                    alt="Logo MQS"
                />

                <div className="brand">
                    <h2>MQS</h2>
                    <span>Recursos Humanos</span>
                </div>

                <nav className="menu">

                    <button>
                        <span>👥</span>
                        Empleados
                    </button>

                    <button>
                        <span>💼</span>
                        Cargos
                    </button>

                    <button>
                        <span>🕒</span>
                        Turnos
                    </button>

                    <button>
                        <span>📅</span>
                        Asistencia
                    </button>

                    <button>
                        <span>🏋</span>
                        Entrenadores
                    </button>

                    <button>
                        <span>📊</span>
                        Reportes
                    </button>

                </nav>

            </aside>


            <main className="content">

                <header className="dashboard-header">

                    <div>
                        <p className="section-name">
                            RECURSOS HUMANOS
                        </p>

                        <h1>
                            Dashboard
                        </h1>

                        <p className="welcome">
                            Gestión del personal del Gimnasio MQS
                        </p>
                    </div>

                    <div className="user-info">
                        <div className="user-avatar">
                            A
                        </div>

                        <div>
                            <strong>Administrador</strong>
                            <span>Usuario activo</span>
                        </div>
                    </div>

                </header>


                <section className="cards">

                    <div className="card">

                        <div className="card-icon">
                            👥
                        </div>

                        <div>
                            <span>Empleados</span>
                            <strong>15</strong>
                            <small>Personal registrado</small>
                        </div>

                    </div>


                    <div className="card">

                        <div className="card-icon">
                            🕒
                        </div>

                        <div>
                            <span>Turnos activos</span>
                            <strong>24</strong>
                            <small>Horarios asignados</small>
                        </div>

                    </div>


                    <div className="card">

                        <div className="card-icon">
                            📅
                        </div>

                        <div>
                            <span>Asistencia</span>
                            <strong>98%</strong>
                            <small>Cumplimiento actual</small>
                        </div>

                    </div>

                </section>


                <section className="dashboard-grid">

                    <div className="panel">

                        <div className="panel-header">

                            <div>
                                <h2>Actividad reciente</h2>
                                <p>Últimos movimientos del personal</p>
                            </div>

                        </div>


                        <div className="activity-list">

                            <div className="activity-item">
                                <div className="activity-dot"></div>

                                <div>
                                    <strong>Nuevo empleado registrado</strong>
                                    <span>Registro realizado recientemente</span>
                                </div>
                            </div>


                            <div className="activity-item">
                                <div className="activity-dot"></div>

                                <div>
                                    <strong>Turno actualizado</strong>
                                    <span>Se modificó un horario de trabajo</span>
                                </div>
                            </div>


                            <div className="activity-item">
                                <div className="activity-dot"></div>

                                <div>
                                    <strong>Asistencia registrada</strong>
                                    <span>Control de entrada y salida</span>
                                </div>
                            </div>

                        </div>

                    </div>


                    <div className="panel quick-panel">

                        <h2>Acciones rápidas</h2>

                        <button>
                            + Registrar empleado
                        </button>

                        <button>
                            + Asignar turno
                        </button>

                        <button>
                            Ver asistencia
                        </button>

                    </div>

                </section>

            </main>

        </div>

    );

}

export default Dashboard;