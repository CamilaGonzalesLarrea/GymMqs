import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_URL } from '../config/api';
import './Login.css';

function Login() {
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);


  const handleLogin = async (event) => {
    event.preventDefault();

    if (loading) {
      return;
    }

    setError('');

    const cleanUsername = username.trim();


    if (!cleanUsername) {
      setError('Ingresa tu usuario.');
      return;
    }

    if (!password) {
      setError('Ingresa tu contraseña.');
      return;
    }

    try {
      setLoading(true);

      const response = await fetch(
        `${API_URL}/api/auth/login`,
        {
          method: 'POST',

          headers: {
            'Content-Type': 'application/json',
          },

          body: JSON.stringify({
            username: cleanUsername,
            password,
          }),
        },
      );


      let data = null;

      try {
        data = await response.json();
      } catch {
        data = null;
      }

   

      if (response.ok) {
        if (!data?.user) {
          throw new Error(
            'El servidor inició sesión, pero no devolvió la información del usuario.',
          );
        }

  
        if (!data.user.role) {
          throw new Error(
            'El usuario no tiene un rol asignado.',
          );
        }

       
        localStorage.setItem(
          'user',
          JSON.stringify(data.user),
        );

      
        
        navigate('/home', {
          replace: true,
        });

        return;
      }

 

      let errorMessage =
        'Usuario o contraseña incorrectos.';

      if (Array.isArray(data?.message)) {
        errorMessage = data.message.join(', ');
      } else if (data?.message) {
        errorMessage = data.message;
      }

      setError(errorMessage);
    } catch (loginError) {
      console.error(
        'Error al iniciar sesión:',
        loginError,
      );

      if (loginError instanceof TypeError) {
        setError(
          'No se pudo conectar con el servidor. Verifica que el backend esté iniciado.',
        );
      } else {
        setError(
          loginError.message ||
            'Ocurrió un error al iniciar sesión.',
        );
      }
    } finally {
      setLoading(false);
    }
  };

  

  return (
    <div className="login-container">
      <div className="login-card">

        <img
          src="/images/logo.jpg"
          className="login-logo"
          alt="Logo Gimnasio MQS"
        />

        <h1>Bienvenido</h1>

        <p>
          Ingresa a tu cuenta para continuar
        </p>

        <form onSubmit={handleLogin}>

    
          <div className="input-group">
            <label htmlFor="username">
              Usuario
            </label>

            <input
              id="username"
              name="username"
              type="text"
              placeholder="Ingrese usuario"
              value={username}
              onChange={(event) => {
                setUsername(event.target.value);

                if (error) {
                  setError('');
                }
              }}
              autoComplete="username"
              disabled={loading}
              required
              autoFocus
            />
          </div>

     

          <div className="input-group">
            <label htmlFor="password">
              Contraseña
            </label>

            <input
              id="password"
              name="password"
              type="password"
              placeholder="Ingrese contraseña"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);

                if (error) {
                  setError('');
                }
              }}
              autoComplete="current-password"
              disabled={loading}
              required
            />
          </div>

        

          {error && (
            <span
              className="error"
              role="alert"
            >
              {error}
            </span>
          )}

        

          <button
            type="submit"
            className="login-button"
            disabled={loading}
          >
            {loading
              ? 'INGRESANDO...'
              : 'INICIAR SESIÓN'}
          </button>

        </form>

        <footer>
          Gimnasio MQS
        </footer>

      </div>
    </div>
  );
}

export default Login;