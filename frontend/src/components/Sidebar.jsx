import { NavLink } from "react-router-dom";
import "./Sidebar.css";

function Sidebar() {

    return (

        <aside className="sidebar">

            <div className="sidebar-logo">

                <img
                    src="/images/logo.jpg"
                    alt="MQS"
                />

                <div>
                    <strong>MQS</strong>
                    <span>Recursos Humanos</span>
                </div>

            </div>


            <nav className="sidebar-menu">

                <NavLink to="/dashboard">
                    Dashboard
                </NavLink>

                <NavLink to="/employees">
                    Empleados
                </NavLink>

                <NavLink to="/positions">
                    Cargos
                </NavLink>

                <NavLink to="/shifts">
                    Turnos
                </NavLink>

                <NavLink to="/attendance">
                    Asistencia
                </NavLink>

                <NavLink to="/trainers">
                    Entrenadores
                </NavLink>

                <NavLink to="/reports">
                    Reportes
                </NavLink>

            </nav>


            <div className="sidebar-bottom">

                <button>
                    Cerrar sesión
                </button>

            </div>

        </aside>

    );

}

export default Sidebar;