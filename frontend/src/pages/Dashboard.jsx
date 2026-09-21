import Sidebar from "../components/Sidebar";
import "./Dashboard.css";

function Dashboard() {

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
                            A
                        </div>

                        <div>
                            <strong>
                                Administrador
                            </strong>

                            <small>
                                Usuario activo
                            </small>
                        </div>

                    </div>

                </header>


                <section className="dashboard-cards">

                    <div className="dashboard-card">

                        <span>
                            Empleados
                        </span>

                        <strong>
                            15
                        </strong>

                        <small>
                            Personal registrado
                        </small>

                    </div>


                    <div className="dashboard-card">

                        <span>
                            Turnos
                        </span>

                        <strong>
                            24
                        </strong>

                        <small>
                            Horarios registrados
                        </small>

                    </div>


                    <div className="dashboard-card">

                        <span>
                            Asistencia
                        </span>

                        <strong>
                            98%
                        </strong>

                        <small>
                            Cumplimiento actual
                        </small>

                    </div>

                </section>


                <section className="dashboard-panels">

                    <div className="dashboard-panel">

                        <h2>
                            Actividad reciente
                        </h2>

                        <p>
                            Registros recientes del personal
                        </p>


                        <div className="activity">

                            <div>
                                <strong>
                                    Registro de empleados
                                </strong>

                                <span>
                                    Información del personal registrada.
                                </span>
                            </div>


                            <div>
                                <strong>
                                    Control de turnos
                                </strong>

                                <span>
                                    Horarios asignados al personal.
                                </span>
                            </div>


                            <div>
                                <strong>
                                    Control de asistencia
                                </strong>

                                <span>
                                    Registro de entrada y salida.
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


                        <button>
                            Registrar empleado
                        </button>

                        <button>
                            Asignar turno
                        </button>

                        <button>
                            Consultar asistencia
                        </button>

                    </div>

                </section>

            </main>

        </div>

    );

}

export default Dashboard;