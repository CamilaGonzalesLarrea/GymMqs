import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./Login.css";


function Login(){

    const navigate = useNavigate();

    const [username,setUsername] = useState("");
    const [password,setPassword] = useState("");

    const [error,setError] = useState("");


    const handleLogin = async()=>{

        try{

            const response = await fetch(
                "http://localhost:3000/api/auth/login",
                {
                    method:"POST",

                    headers:{
                        "Content-Type":"application/json"
                    },

                    body:JSON.stringify({
                        username,
                        password
                    })
                }
            );


            const data = await response.json();


            if(response.ok){

                localStorage.setItem(
                    "user",
                    JSON.stringify(data.user)
                );


                navigate("/dashboard");

            }else{

                setError(data.message);

            }


        }catch(error){

            console.log(error);

            setError(
                "No se pudo conectar con el servidor"
            );

        }

    };


return(

<div className="login-container">


    <div className="login-card">


        <img
        src="/images/logo.jpg"
        className="login-logo"
        />


        <h1>
            Bienvenido
        </h1>

        <p>
            Ingresa a tu cuenta para continuar
        </p>



        <div className="input-group">

            <label>
                Usuario
            </label>

            <input

            type="text"

            placeholder="Ingrese usuario"

            value={username}

            onChange={
                (e)=>setUsername(e.target.value)
            }

            />

        </div>




        <div className="input-group">

            <label>
                Contraseña
            </label>


            <input

            type="password"

            placeholder="Ingrese contraseña"

            value={password}

            onChange={
                (e)=>setPassword(e.target.value)
            }

            />

        </div>



        {
            error &&
            <span className="error">
                {error}
            </span>
        }



        <button
        className="login-button"
        onClick={handleLogin}
        >
             INICIAR SESIÓN
        </button>



        <footer>
            Gimnasio MQS
        </footer>


    </div>


</div>

)


}


export default Login;