import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_URL } from '../config/api';
import './Login.css';

// Se conserva localStorage.user porque App.jsx y Sidebar.jsx ya lo utilizan.
// El JWT se guarda en sessionStorage y se usará en las peticiones del ERP.
const USER_KEY = 'user';
const TOKEN_KEY = 'authToken';
const TOKEN_EXPIRY_KEY = 'authTokenExpiresAt';
const LOGIN_TIMEOUT_MS = 15000;
const MAX_USERNAME_LENGTH = 50;
const MAX_TOKEN_LENGTH = 4096;

function clearPreviousSession() {
  localStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_EXPIRY_KEY);
}

function getServerMessage(data, fallback) {
  const message = data?.message;
  if (typeof message === 'string' && message.trim()) {
    return message.trim().slice(0, 250);
  }
  if (Array.isArray(message)) {
    const text = message.filter((part) => typeof part === 'string').join(', ');
    if (text.trim()) return text.trim().slice(0, 250);
  }
  return fallback;
}

function validateLoginResponse(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('El servidor devolvió una respuesta de inicio de sesión inválida.');
  }

  const { user, token } = data;
  if (!user || typeof user !== 'object' || Array.isArray(user)) {
    throw new Error('El servidor no devolvió la información del usuario.');
  }

  if (
    !Number.isSafeInteger(Number(user.id)) ||
    Number(user.id) <= 0 ||
    typeof user.username !== 'string' ||
    !user.username.trim() ||
    typeof user.role !== 'string' ||
    !user.role.trim()
  ) {
    throw new Error('El servidor devolvió datos de usuario incompletos.');
  }

  if (user.status && user.status !== 'ACTIVE') {
    throw new Error('La cuenta no se encuentra activa.');
  }

  // Se valida el formato, no la firma: esa comprobación pertenece al backend.
  if (
    typeof token !== 'string' ||
    token.length > MAX_TOKEN_LENGTH ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
  ) {
    throw new Error('El servidor no devolvió un token de sesión válido.');
  }

  if (data.token_type && data.token_type !== 'Bearer') {
    throw new Error('El servidor devolvió un tipo de autenticación inesperado.');
  }

  const expiresIn = Number(data.expires_in);
  if (!Number.isInteger(expiresIn) || expiresIn <= 0 || expiresIn > 86400) {
    throw new Error('El servidor devolvió una duración de sesión inválida.');
  }

  return {
    user: {
      id: Number(user.id),
      username: user.username,
      role: user.role,
      id_role: user.id_role,
      status: user.status || 'ACTIVE',
    },
    token,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

function Login() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const requestInProgress = useRef(false);
  const requestController = useRef(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;

    // Si se llega al login tras cerrar sesión, eliminar también el JWT.
    // Solo se renderiza Login cuando App.jsx no encuentra un usuario activo.
    try {
      clearPreviousSession();
    } catch {
      // Si el almacenamiento está bloqueado, el envío posterior informará el error.
    }

    return () => {
      mounted.current = false;
      requestController.current?.abort();
    };
  }, []);

  const handleLogin = async (event) => {
    event.preventDefault();
    if (requestInProgress.current) return;

    setError('');
    const cleanUsername = username.trim();

    if (!cleanUsername) {
      setError('Ingresa tu usuario.');
      return;
    }
    if (cleanUsername.length > MAX_USERNAME_LENGTH) {
      setError(`El usuario no puede superar ${MAX_USERNAME_LENGTH} caracteres.`);
      return;
    }
    if (!password) {
      setError('Ingresa tu contraseña.');
      return;
    }

    requestInProgress.current = true;
    setLoading(true);

    const controller = new AbortController();
    requestController.current = controller;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, LOGIN_TIMEOUT_MS);

    try {
      const response = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          username: cleanUsername,
          password,
        }),
        cache: 'no-store',
        signal: controller.signal,
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        const fallback = response.status === 401
          ? 'Usuario o contraseña incorrectos.'
          : response.status === 429
            ? 'Demasiados intentos. Intenta nuevamente más tarde.'
            : response.status >= 500
              ? 'El servidor no pudo iniciar sesión. Intenta nuevamente.'
              : 'No se pudo iniciar sesión.';
        throw new Error(getServerMessage(data, fallback));
      }

      const session = validateLoginResponse(data);

      try {
        // Primero el token; luego el usuario. Si falla una escritura, no dejar
        // una sesión parcial ni permitir navegar a la aplicación.
        sessionStorage.setItem(TOKEN_KEY, session.token);
        sessionStorage.setItem(TOKEN_EXPIRY_KEY, String(session.expiresAt));
        localStorage.setItem(USER_KEY, JSON.stringify(session.user));
      } catch {
        try {
          clearPreviousSession();
        } catch {
          // Ignorar el fallo secundario de limpieza.
        }
        throw new Error('No se pudo guardar la sesión. Habilita el almacenamiento del navegador.');
      }

      if (!mounted.current) return;
      setPassword('');
      navigate('/home', { replace: true });
    } catch (loginError) {
      if (!mounted.current) return;

      if (loginError?.name === 'AbortError') {
        if (timedOut) {
          setError('La conexión tardó demasiado. Verifica el servidor e inténtalo otra vez.');
        }
      } else if (loginError instanceof TypeError) {
        setError('No se pudo conectar con el servidor. Verifica que el backend esté iniciado.');
      } else {
        setError(loginError?.message || 'Ocurrió un error al iniciar sesión.');
      }
    } finally {
      clearTimeout(timeout);
      requestInProgress.current = false;
      requestController.current = null;
      if (mounted.current) setLoading(false);
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
        <p>Ingresa a tu cuenta para continuar</p>

        <form onSubmit={handleLogin}>
          <div className="input-group">
            <label htmlFor="username">Usuario</label>
            <input
              id="username"
              name="username"
              type="text"
              placeholder="Ingrese usuario"
              value={username}
              onChange={(event) => {
                setUsername(event.target.value);
                if (error) setError('');
              }}
              autoComplete="username"
              maxLength={MAX_USERNAME_LENGTH}
              disabled={loading}
              required
              autoFocus
            />
          </div>

          <div className="input-group">
            <label htmlFor="password">Contraseña</label>
            <input
              id="password"
              name="password"
              type="password"
              placeholder="Ingrese contraseña"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                if (error) setError('');
              }}
              autoComplete="current-password"
              disabled={loading}
              required
            />
          </div>

          {error && (
            <span className="error" role="alert" aria-live="polite">
              {error}
            </span>
          )}

          <button type="submit" className="login-button" disabled={loading}>
            {loading ? 'INGRESANDO...' : 'INICIAR SESIÓN'}
          </button>
        </form>

        <footer>Gimnasio MQS</footer>
      </div>
    </div>
  );
}

export default Login;
