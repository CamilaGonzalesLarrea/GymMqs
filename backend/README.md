# Backend unificado Express

Un único servidor Express basado en el backend de Camila. Conserva el login Argon2 y migra clientes, planes, membresías, renovaciones, activación y asistencias. No contiene NestJS ni TypeORM. Usa las tablas existentes de una sola base MySQL.

## Ejecución en PowerShell

Requisito: Node.js 20 o superior y MySQL con el esquema existente del gimnasio. Verificado con Node.js 24.21.0 y el MySQL local disponible.

Abre una terminal dentro de `backend-unificado-express` y ejecuta:

```powershell
npm.cmd install
Copy-Item .env.example .env
notepad .env
npm.cmd start
```

Copia en `.env` los valores de conexión de tu entorno: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` y `DB_NAME`. La contraseña real no está incluida. Usa la misma base donde están `users`, `roles`, `customers`, `membership_plans`, `memberships` y `customer_attendances`.

`PORT=3000` mantiene el puerto original. `DB_SSL=true` y `DB_SSL_REJECT_UNAUTHORIZED=false` conservan la configuración TLS de ambos proyectos. Para un MySQL sin TLS, configura `DB_SSL=false`. Puedes habilitar verificación del certificado con `DB_SSL_REJECT_UNAUTHORIZED=true` si tu entorno la admite.

El servidor verifica la conexión antes de escuchar. Si faltan variables o MySQL no está disponible, termina con error. No crea tablas ni modifica el esquema. Utiliza la zona horaria local del proceso para el día actual y la hora de asistencia, como el original; conserva la misma zona al desplegarlo.

No requiere compilación. Desarrollo con recarga: `npm.cmd run dev`.

## Comprobaciones

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run test:db
```

`check` comprueba la sintaxis y dependencias residuales en el código. `test` ejecuta 24 pruebas sin acceso a tu base de datos, con Argon2 real y acceso a datos simulado. `test:db` requiere `.env`, inicia temporalmente el servidor en un puerto libre, realiza consultas de solo lectura y lo cierra.

`test:db` no llama a `GET /memberships`: ese endpoint, por diseño original, actualiza membresías vencidas. Tampoco ejecuta inserciones ni actualizaciones de prueba.

## Compatibilidad

El login sigue en `POST /api/auth/login`; las operaciones mantienen sus rutas sin prefijo `/api`. Los POST de operaciones devuelven 201, los PATCH y GET devuelven 200. CORS conserva el comportamiento de Camila (`*`).

El login original consulta `status` pero no bloquea usuarios inactivos. Esa conducta se mantiene. No había sesiones, emisión JWT ni middleware que protegiera las rutas. No se añadió un mecanismo nuevo.

Consulta [el informe completo](docs/INFORME-MIGRACION.md) para los 16 endpoints, reglas conservadas, archivos modificados, diferencias, base de datos y resultados de verificación; [el inventario](docs/INVENTARIO.md) documenta el código de origen.
