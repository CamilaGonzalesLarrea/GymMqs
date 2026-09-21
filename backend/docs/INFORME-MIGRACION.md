# Informe de migración

Fecha de verificación: 20 de septiembre de 2026.

## 1. Funcionalidad de Camila

El proyecto base contiene `server.js`, `database.js`, `controllers/auth.controller.js`, `routes/auth.routes.js`, `package.json` y `package-lock.json`. CommonJS, Express 5, CORS abierto, parser JSON y MySQL2 con SSL. Solo implementa `POST /api/auth/login`.

El login busca `users` por `username`, une `roles` por `id_role`, verifica `password_hash` con Argon2 y responde `{message:"Login correcto",user:{id,username,role,id_role}}`. Conserva 401 con los mensajes originales para usuario inexistente y contraseña incorrecta, y 500 con `Error en base de datos`. El estado se consulta pero no se filtra. No hay CRUD de usuarios o roles, permisos, cookies, sesiones ni JWT emitidos. `jsonwebtoken` era una dependencia sin uso.

## 2. Funcionalidad de NestJS

Cuatro módulos funcionales, más la raíz `Hello World!`. Los controllers tienen 15 rutas en total. Los DTOs son declaraciones TypeScript sin decoradores de validación; `main.ts` no instala `ValidationPipe`. Las reglas efectivas están en los servicios y restricciones de MySQL. No hay repositories personalizados: se inyectaban repositories de TypeORM. No hay DELETE, búsqueda individual GET, paginación o filtros por query.

- Clientes: listado ascendente, alta, edición parcial, normalización de nombres y teléfono, mínimos de nombres, formato y longitud de teléfono, duplicados por teléfono y nombre completo, campos opcionales convertidos a null y cambio de estado con rechazo del mismo estado.
- Planes: listado, alta, edición y cambio de estado; errores 404 cuando el plan no existe. Nombre único y precio decimal en la entidad. No había validaciones explícitas en el servicio de planes.
- Membresías: listado y actualización de vencidas; creación PENDING con precio congelado, duración inclusiva, cliente y plan activos y sin superposición; renovación como registro nuevo; activación durante vigencia y sin otra activa superpuesta.
- Asistencias: listado descendente por fecha/hora/id, cliente activo, membresía ACTIVE vigente, fecha y hora local del mismo instante, última asistencia del mismo día, bloqueo si transcurrieron menos de 5 minutos o si la hora guardada está en el futuro. A los 5 minutos exactos se permite otra entrada. Hora almacenada inválida no bloquea el registro.

## 3. Migración y arquitectura

Se utilizó la estructura CommonJS de Camila: `routes/`, `controllers/`, `database.js` y `server.js`. Se añadieron `services/`, `repositories/`, `validators/`, `middlewares/`, `scripts/`, `test/` y documentación. `app.js` registra todas las rutas; `server.js` carga configuración, verifica MySQL y arranca un único servidor.

Los métodos de negocio se adaptaron desde los servicios fuente, sustituyendo inyección/decoradores y acceso TypeORM. Son JavaScript ejecutable independiente de NestJS. `mysql.repository.js` usa un mapa cerrado de tablas/columnas, parámetros `?`, SELECT explícitos, INSERT/UPDATE y lectura del registro guardado. La misma conexión lógica (un pool MySQL2 y un esquema) atiende autenticación y operaciones. No se añadieron entidades ni sincronización automática.

Se conservaron los cuatro módulos, la raíz y el login. No se migraron artefactos `dist`, dependencias empaquetadas ni configuraciones de herramientas exclusivas de NestJS como código del backend final. Los ZIP y carpetas originales permanecieron intactos y no se modificó ningún frontend.

## 4. Lista completa de endpoints

Ninguna ruta usa query params; los parámetros query extra no tienen efecto. `id` se interpreta como entero. Los errores de negocio son 400/404; errores internos son 500 sin stack trace. Conflictos de índice no contemplados específicamente se traducen a 409. Los duplicados de clientes conservan 400.

| Método | Ruta | Body / parámetro | Función y respuesta |
|---|---|---|---|
| GET | `/` | Ninguno | 200, texto `Hello World!` |
| POST | `/api/auth/login` | `username`, `password` | 200, contrato de Camila; 400 body inválido, 401 credenciales, 500 BD/hash |
| GET | `/customers` | Ninguno | 200, array ordenado por `id_customer ASC` |
| POST | `/customers` | `first_name`, `last_name`, `phone`; opcionales `email`, `birth_date`, `notes` | 201, cliente guardado; 400 datos/duplicados |
| PATCH | `/customers/:id` | Mismos campos, opcionales | 200, cliente editado; 400 validación/duplicados, 404 inexistente |
| PATCH | `/customers/:id/status` | `status`: ACTIVE o INACTIVE | 200, cliente; 400 estado inválido/repetido, 404 inexistente |
| GET | `/membership-plans` | Ninguno | 200, array de planes, sin orden impuesto como el original |
| POST | `/membership-plans` | `plan_name`, `duration_days`, `price`; opcional `description` | 201, plan; 400 validación, 409 nombre repetido |
| PATCH | `/membership-plans/:id` | Mismos campos, opcionales | 200, plan; 400 validación, 404 inexistente, 409 duplicado |
| PATCH | `/membership-plans/:id/status` | `status`: ACTIVE o INACTIVE | 200, plan; 400 estado inválido, 404 inexistente |
| GET | `/memberships` | Ninguno | Expira antiguas ACTIVE; 200, array por `id_membership ASC` |
| POST | `/memberships` | `id_customer`, `id_plan`, `start_date` YYYY-MM-DD | 201, nueva PENDING; 400 regla/fecha/superposición, 404 cliente/plan |
| POST | `/memberships/:id/renew` | Opcionales `id_plan`, `renewal_date`; acepta `{}` | 201, nueva PENDING; 400 regla/superposición/fecha, 404 registros |
| PATCH | `/memberships/:id/activate` | Sin body necesario | 200, membresía ACTIVE; 400 estado/vigencia/superposición, 404 registros |
| GET | `/customer-attendances` | Ninguno | 200, array por fecha DESC, hora DESC, id DESC |
| POST | `/customer-attendances` | `id_customer` | 201, asistencia; 400 id/inactividad/vigencia/duplicado, 404 cliente |

Las respuestas de operaciones son registros o arrays con nombres de columnas originales. MySQL DECIMAL se mantiene como string, DATE como YYYY-MM-DD, TIME como HH:mm:ss y DATETIME se serializa desde Date. Los campos adicionales a los contratos DTO se ignoran.

### Reglas de membresías preservadas

Antes de listar, crear, renovar o activar se actualizan solo las ACTIVE cuyo `end_date < hoy` a EXPIRED. No hay tarea programada ni actualización masiva al arrancar. Vencer hoy sigue siendo vigente.

La fecha final es inicio + duración - 1 día. Las fechas recibidas se comprueban por formato y calendario real. PENDING y ACTIVE bloquean la creación/renovación si `start_date <= finNuevo AND end_date >= inicioNuevo` para el mismo cliente. Precio y duración del plan deben ser válidos; el precio aplicado queda congelado.

Solo ACTIVE o EXPIRED pueden renovarse. ACTIVE inicia al día siguiente de su fin, e ignora `renewal_date`. EXPIRED inicia en `renewal_date` o en hoy. Se puede cambiar de plan; si no se envía `id_plan` se usa el previo. Se crea una fila nueva PENDING y se mantiene el historial.

La activación exige PENDING, cliente activo, fechas válidas y hoy dentro del intervalo inclusivo. No vuelve a consultar el estado del plan: se conserva esa regla original. Rechaza otra ACTIVE superpuesta excluyendo el propio id. No se añadió ninguna activación automática ni flujo de pagos.

## 5. Archivos nuevos

- `.env.example`
- `.gitignore`
- `README.md`
- `app.js`
- `controllers/customer-attendances.controller.js`
- `controllers/customers.controller.js`
- `controllers/membership-plans.controller.js`
- `controllers/memberships.controller.js`
- `docs/INFORME-MIGRACION.md`
- `docs/INVENTARIO.md`
- `middlewares/errors.js`
- `repositories/mysql.repository.js`
- `routes/customer-attendances.routes.js`
- `routes/customers.routes.js`
- `routes/membership-plans.routes.js`
- `routes/memberships.routes.js`
- `scripts/check-db.js`
- `scripts/check.js`
- `services/customer-attendances.service.js`
- `services/customers.service.js`
- `services/membership-plans.service.js`
- `services/memberships.service.js`
- `test/backend.test.js`
- `validators/operations.js`

## 6. Archivos del backend base modificados

- `server.js`: puerto configurable, arranque verificable, conexión previa y cierre ordenado.
- `database.js`: pool reutilizable MySQL2, configuración TLS por entorno, DATE como string y DECIMAL sin conversión a número.
- `controllers/auth.controller.js`: SQL/Argon2/respuesta preservados; adaptación a promesas, validación básica y captura de fallos de verificación.
- `routes/auth.routes.js`: recibe la dependencia de BD y mantiene POST `/login` bajo `/api/auth`.
- `package.json`: nombre/main/scripts/Node, retirada de dependencia JWT no usada.
- `package-lock.json`: regenerado mediante npm install para el proyecto unificado.

## 7. Dependencias agregadas

Ninguna dependencia adicional de ejecución respecto de Camila. Se usan `express`, `mysql2`, `dotenv`, `cors` y `argon2`; `nodemon` permanece como dependencia de desarrollo. Las validaciones son JavaScript explícito. Los tests usan `node:test` y el cliente HTTP de Node; no requieren otra biblioteca.

## 8. Dependencias eliminadas

`jsonwebtoken`, que Camila no utilizaba. No se incorporaron al proyecto final las dependencias del backend anterior: paquetes `@nestjs/*`, `typeorm`, `reflect-metadata`, `rxjs` ni su cadena de herramientas de compilación/testing. No hay dependencias directas de TypeScript, Vitest, Supertest, Oxlint o Nest CLI en el resultado.

## 9. Variables de entorno

| Variable | Uso |
|---|---|
| `DB_HOST` | Host del mismo MySQL, obligatorio |
| `DB_PORT` | Puerto, por defecto 3306 |
| `DB_USER` | Usuario MySQL, obligatorio |
| `DB_PASSWORD` | Contraseña MySQL; puede quedar vacía solo si esa cuenta no tiene contraseña |
| `DB_NAME` | Base existente, obligatoria |
| `PORT` | Puerto HTTP, por defecto 3000 |
| `DB_SSL` | `true` por defecto; `false` para conexiones sin TLS |
| `DB_SSL_REJECT_UNAUTHORIZED` | `false` por defecto, igual que los originales; `true` verifica el certificado |

`.env.example` no contiene credenciales reales. La prueba con MySQL tomó la configuración del ZIP únicamente en memoria, sin copiarla a la entrega.

## 10. Base de datos

**No fue necesario ningún cambio de estructura y no se ejecutó ninguna modificación del esquema ni de los datos reales.** Se verificaron nombres, tipos, claves y relaciones mediante `information_schema` en el MySQL accesible.

Tablas utilizadas: `users`, `roles`, `customers`, `membership_plans`, `memberships`, `customer_attendances`. Se conservaron PK `id_user`, `id_role`, `id_customer`, `id_plan`, `id_membership` e `id_attendance`. Relaciones verificadas: users→roles, memberships→customers/plans, customer_attendances→customers/memberships/users (`uploadedBy`). `createdBy` se conserva como columna; no se inventó una FK donde no existe.

Diferencia encontrada: la entidad de planes declaraba `plan_name varchar(100)` y `description text`, pero el esquema real tiene `varchar(50)` y `varchar(255)`. Se ajustó la validación del código a 50/255, sin ampliar columnas. Los demás campos utilizados existen. Algunas columnas con valores por defecto son nullable en la base aunque la entidad no lo indicara: no se alteraron.

Existen tablas de pagos, empleados y otras áreas en el esquema, pero estos ZIP no tienen sus módulos/API. No se crearon funcionalidades para esas tablas.

## 11. Diferencias y límites de equivalencia

No quedó ningún módulo o endpoint funcional sin migrar. Se preservan las reglas implementadas, pero se documentan estos ajustes:

- Se rechazan con 400 los tipos incorrectos, campos obligatorios ausentes y estados inválidos que antes podían acabar en 500 o depender de la configuración MySQL. Planes valida duración positiva y precio decimal no negativo con máximo 8 enteros y 2 decimales, acorde con DECIMAL(10,2); antes el servicio de planes delegaba esas restricciones a MySQL o a la creación de membresías.
- Se validan las longitudes del esquema real y fechas de nacimiento. No se añadió una regla nueva de formato de correo que no existía.
- Los cuerpos se limitan a campos documentados por los DTOs; campos de auditoría, claves y estados no declarados no se pueden inyectar mediante alta/edición. Los estados se cambian por las rutas existentes.
- Los duplicados de clientes mantienen sus mensajes y 400. Duplicados de planes se informan como 409 en lugar del error genérico de BD anterior. Se manejan referencias inválidas con 400 y conflictos de referencias con 409.
- Un hash Argon2 inválido devuelve 500 controlado. El original podía dejar escapar la excepción asíncrona. Los cuerpos malformados devuelven errores JSON sin trazas.
- Se relee la fila después de guardar para devolver valores y defaults efectivos de MySQL. Pueden aparecer campos null/default que una respuesta de inserción de TypeORM no hubiera incluido; no se renombraron campos.
- Se mantiene CORS abierto de Camila; el backend Nest original permitía explícitamente localhost:5173, que también queda permitido.
- El servidor falla al arrancar si no puede conectar, en lugar de escuchar sin una BD disponible. Se conservó la configuración TLS original y se hizo configurable.
- Las comprobaciones de duplicados/superposición siguen siendo comprobaciones antes de guardar, como el original; no se añadieron índices ni transacciones para cambiar su comportamiento ante concurrencia. No se ensayó carga concurrente.

## 12. Instrucciones exactas

En PowerShell, dentro de la carpeta entregada:

```powershell
npm.cmd install
Copy-Item .env.example .env
notepad .env
npm.cmd start
```

Completa los valores de conexión de tu base existente antes del último comando. No ejecutes `Copy-Item` si ya tienes `.env` configurado y quieres conservarlo. Desarrollo: `npm.cmd run dev`. No hay build de TypeScript: es JavaScript CommonJS.

Comprobaciones: `npm.cmd run check`, `npm.cmd test`, `npm.cmd run test:db`. Esta última requiere MySQL y es de solo lectura.

## 13. Resultados reales de verificación

| Comprobación | Resultado y alcance |
|---|---|
| `npm install` | Correcto: 119 paquetes instalados; npm informó 0 vulnerabilidades en esa ejecución |
| `npm run check` | Correcto: 23 archivos JavaScript; sintaxis válida y sin imports residuales de los frameworks eliminados |
| `npm test` | 24 pruebas, 24 aprobadas, 0 fallidas |
| Login Argon2 | Hash y verificación reales en pruebas; conserva respuesta, roles, 401 y comportamiento para usuario inactivo |
| Reglas y SQL | Ejecución con repositories/BD simulados: clientes, planes, fechas inclusivas y bisiestas, expiración, renovaciones, activación, superposición, asistencia, límite de 5 minutos, parámetros SQL y errores |
| MySQL real | Conexión TLS correcta con la configuración del ZIP; SELECT y metadatos de estructura comprobados |
| Arranque real | Se ejecutó la función de arranque usada por `server.js`, escuchó en puerto temporal 49457 y se cerró al terminar |
| HTTP contra MySQL real | GET `/`, `/customers`, `/membership-plans`, `/customer-attendances`: HTTP 200 y formas de respuesta correctas |
| Tipos y esquema | Proyecciones de los cuatro repositories, columnas existentes y tipos DATE/DECIMAL de registros disponibles comprobados |
| Análisis estático | Rutas, imports/exports, DTOs, servicios, entidades, dependencias, variables y correspondencia de tablas revisados |
| No verificado contra datos reales | Login con credenciales de una persona y operaciones INSERT/UPDATE; no se ejecutaron para no alterar datos reales. Tampoco GET `/memberships`, porque expira registros |

Las pruebas usan fallos de BD intencionales; los mensajes `Error login BD: ECONNREFUSED` y `Error de backend: Error` durante `npm test` pertenecen a esos casos y no indican una prueba fallida. Las pruebas Nest originales solo cubrían `Hello World!`; ese contrato se incluyó en la nueva suite. El lint específico de Nest/Oxlint no forma parte del Express base; se ejecutó la comprobación de sintaxis indicada, sin presentarla como un lint completo.
