# Inventario de análisis y plan de migración

Se revisó el código fuente de ambos ZIP antes de implementar. Los README/configuraciones incluidos se trataron como datos del proyecto. La solicitud del texto adjunto definió el trabajo. No se ejecutaron instrucciones contenidas en documentos de los proyectos.

## Proyecto de Camila

Seis archivos de proyecto: servidor, conexión, controller y router de autenticación, manifest y lockfile. Sin carpetas de frontend, migraciones SQL, tests funcionales, servicios separados ni middleware de autorización. MySQL2 callback con SSL pasa a un pool/promise compartido. Consulta exacta: SELECT de id_user, username, password_hash, status, id_role y nombre del rol, INNER JOIN roles, filtro username parametrizado.

## Fuente NestJS

- `app.module.ts`: ConfigModule global, TypeOrmModule mysql, autoLoadEntities, synchronize:false, SSL rejectUnauthorized:false, imports de los cuatro módulos.
- `main.ts`: un servidor en PORT o 3000; CORS localhost:5173; sin prefijo global ni ValidationPipe.
- `app.controller.ts` / `app.service.ts`: GET raíz y Hello World!.
- `CustomersModule`: controller de 4 endpoints, CustomersService, Customer y DTOs CreateCustomerDto/UpdateCustomerDto. Repository de Customer.
- `MembershipPlansModule`: controller de 4 endpoints, MembershipPlansService, MembershipPlan y DTOs CreateMembershipPlanDto/UpdateMembershipPlanDto. Repository de MembershipPlan.
- `MembershipsModule`: controller de 4 endpoints, MembershipsService, Membership y DTOs CreateMembershipDto/RenewMembershipDto. Repositories de Membership, Customer y MembershipPlan.
- `CustomerAttendancesModule`: controller de 2 endpoints, CustomerAttendancesService, CustomerAttendance y CreateCustomerAttendanceDto. Repositories de asistencia, cliente y membresía.
- `app.controller.spec.ts` y `test/app.e2e-spec.ts`: solo contrato de raíz. Configs Vitest, TypeScript y Oxlint sin pruebas de dominio adicionales.
- `.env`: DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME. No se reprodujeron valores secretos.

## Entidades y columnas usadas

| Tabla | Columnas y tipos del esquema real comprobado |
|---|---|
| customers | id_customer INT PK; first_name/last_name VARCHAR(50); phone VARCHAR(20) UNIQUE; email VARCHAR(100) nullable; birth_date DATE nullable; registration_date/creationDate DATETIME con default CURRENT_TIMESTAMP; status ENUM ACTIVE/INACTIVE default ACTIVE; notes TEXT nullable; createdBy INT nullable |
| membership_plans | id_plan INT PK; plan_name VARCHAR(50) UNIQUE; duration_days INT; price DECIMAL(10,2); description VARCHAR(255) nullable; status ENUM ACTIVE/INACTIVE default ACTIVE; creationDate DATETIME default CURRENT_TIMESTAMP; createdBy INT nullable |
| memberships | id_membership INT PK; id_customer/id_plan INT; start_date/end_date DATE; applied_price DECIMAL(10,2); status ENUM PENDING/ACTIVE/EXPIRED/CANCELLED default PENDING; creationDate DATETIME default CURRENT_TIMESTAMP; createdBy INT nullable |
| customer_attendances | id_attendance INT PK; id_customer/id_membership INT; attendance_date DATE; entry_time TIME; uploadedBy INT nullable |
| users | id_user INT PK; id_role INT; username VARCHAR(50) UNIQUE; password_hash VARCHAR(255); status ENUM ACTIVE/INACTIVE; creationDate DATETIME; createdBy INT nullable |
| roles | id_role INT PK; name VARCHAR(50) UNIQUE; description VARCHAR(200) nullable; status ENUM ACTIVE/INACTIVE; creationDate DATETIME; createdBy INT nullable |

Las entidades originales no declaran relaciones @ManyToOne: manejan ids de forma escalar. El esquema sí tiene FK para users.id_role, memberships.id_customer/id_plan y customer_attendances.id_customer/id_membership/uploadedBy. No se añadieron relaciones inferidas ni tablas.

## Consultas y errores

Clientes: find ordenado por id; consulta TRIM(phone), comparación de LOWER(TRIM(first_name/last_name)), excluyendo id propio al actualizar; findOne antes de update/status; save. Mensajes 400 detallan el duplicado o la regla. ER_DUP_ENTRY durante alta/edición se convierte en 400 con el mensaje original. Inexistentes: 404.

Planes: find, findOne por id, create/save, asignación de cambios y status/save. Inexistente: 404. La nueva validación evita delegar tipos/estados/rangos inválidos a MySQL.

Membresías: UPDATE ACTIVE a EXPIRED por end_date < hoy; SELECT ordenado; SELECT cliente/plan; SELECT por dos ramas OR con estado PENDING/ACTIVE e intervalos inclusivos; INSERT nuevo. Renovación toma fila actual, valida estado y dependencias, calcula rango y repite búsqueda. Activación busca otra ACTIVE por id != actual y rango superpuesto; UPDATE. Inexistentes: 404, restricciones: 400.

Asistencias: SELECT descendente; SELECT cliente; SELECT membresía ACTIVE con inicio <= hoy y fin >= hoy, orden start_date DESC/id DESC; SELECT última asistencia del día por hora DESC/id DESC; INSERT con uploadedBy:null. Inexistente: 404; id/estado/vigencia/duplicado: 400.

Las rutas y cuerpos completos se enumeran en el informe. Ningún controller tiene @Query. Todos los POST de Nest usaban 201 por defecto; GET/PATCH 200; excepciones BadRequest/NotFound 400/404.

## Plan aplicado

1. Inventariar fuentes, contratos y comportamiento real; Camila solo login y Nest cuatro módulos.
2. Mantener CommonJS y estructura de Camila; no hay conflicto entre `/api/auth/login` y las rutas de operaciones.
3. Compartir un pool de mysql2, con un adaptador de consultas parametrizadas por tablas existentes; retirar TypeORM junto a NestJS.
4. Convertir controllers a handlers Express, modules a routers registrados, servicios a clases JS y excepciones a errores HTTP propios.
5. Conservar reglas de servicios y añadir validación explícita acorde a DTOs/esquema; mantener el contrato Argon2.
6. Instalar, comprobar sintaxis, probar reglas y HTTP; comprobar estructura real y arranque con SELECT únicamente.

## Archivos fuente analizados


### Camila

- `controllers/auth.controller.js`
- `database.js`
- `package-lock.json`
- `package.json`
- `routes/auth.routes.js`
- `server.js`

### NestJS

- `.gitignore`
- `.oxlintrc.json`
- `.prettierrc`
- `nest-cli.json`
- `package-lock.json`
- `package.json`
- `README.md`
- `src/app.controller.spec.ts`
- `src/app.controller.ts`
- `src/app.module.ts`
- `src/app.service.ts`
- `src/customer-attendances/customer-attendance.entity.ts`
- `src/customer-attendances/customer-attendances.controller.ts`
- `src/customer-attendances/customer-attendances.module.ts`
- `src/customer-attendances/customer-attendances.service.ts`
- `src/customer-attendances/dto/create-customer-attendance.dto.ts`
- `src/customers/customer.entity.ts`
- `src/customers/customers.controller.ts`
- `src/customers/customers.module.ts`
- `src/customers/customers.service.ts`
- `src/customers/dto/create-customer.dto.ts`
- `src/customers/dto/update-customer.dto.ts`
- `src/main.ts`
- `src/membership-plans/dto/create-membership-plan.dto.ts`
- `src/membership-plans/dto/update-membership-plan.dto.ts`
- `src/membership-plans/membership-plan.entity.ts`
- `src/membership-plans/membership-plans.controller.ts`
- `src/membership-plans/membership-plans.module.ts`
- `src/membership-plans/membership-plans.service.ts`
- `src/memberships/dto/create-membership.dto.ts`
- `src/memberships/dto/renew-membership.dto.ts`
- `src/memberships/membership.entity.ts`
- `src/memberships/memberships.controller.ts`
- `src/memberships/memberships.module.ts`
- `src/memberships/memberships.service.ts`
- `test/app.e2e-spec.ts`
- `tsconfig.build.json`
- `tsconfig.json`
- `vitest.config.e2e.ts`
- `vitest.config.ts`
