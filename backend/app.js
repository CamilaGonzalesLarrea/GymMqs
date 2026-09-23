const express = require('express');
const cors = require('cors');

const {
  createRepository,
} = require('./repositories/mysql.repository');

const {
  errorHandler,
  NotFoundException,
  BadRequestException,
} = require('./middlewares/errors');

function createApp(db, options = {}) {
  const app = express();

  const missingTableErrorCodes = new Set([
    'ER_NO_SUCH_TABLE',
    'ER_BAD_TABLE_ERROR',
  ]);

  const isMissingTableError = (error) =>
    Boolean(
      error &&
      typeof error === 'object' &&
      missingTableErrorCodes.has(error.code),
    );

  const safeListQuery = async (sql, fallback = []) => {
    try {
      const [rows] = await db.query(sql);
      return rows;
    } catch (error) {
      if (isMissingTableError(error)) {
        return fallback;
      }

      throw error;
    }
  };

  const normalizeShiftDay = (value = '') => {
    const raw = String(value || '')
      .trim()
      .toUpperCase();

    const dayMap = {
      MONDAY: 'MONDAY',
      TUESDAY: 'TUESDAY',
      WEDNESDAY: 'WEDNESDAY',
      THURSDAY: 'THURSDAY',
      FRIDAY: 'FRIDAY',
      SATURDAY: 'SATURDAY',
      SUNDAY: 'SUNDAY',
      LUNES: 'MONDAY',
      MARTES: 'TUESDAY',
      MIERCOLES: 'WEDNESDAY',
      JUEVES: 'THURSDAY',
      VIERNES: 'FRIDAY',
      SABADO: 'SATURDAY',
      DOMINGO: 'SUNDAY',
    };

    return dayMap[raw] || raw || 'MONDAY';
  };

  const normalizeAttendancePayload = (body = {}) => {
    const date =
      body.attendance_date ??
      body.date ??
      '';

    const entryTime =
      body.check_in ??
      body.entry_time ??
      '';

    const exitTime =
      body.check_out ??
      body.exit_time ??
      null;

    return {
      ...body,
      attendance_date: date,
      check_in: entryTime,
      check_out: exitTime,
      date,
      entry_time: entryTime,
      exit_time: exitTime,
    };
  };

  const getTableColumns = async (tableName) => {
    try {
      const databaseName =
        process.env.DB_NAME ||
        db?.config?.connectionConfig?.database ||
        '';

      if (!databaseName) {
        return new Set();
      }

      const [rows] = await db.query(
        `
          SELECT COLUMN_NAME
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = ?
            AND TABLE_NAME = ?
        `,
        [databaseName, tableName],
      );

      return new Set(
        (rows || []).map((row) => row.COLUMN_NAME),
      );
    } catch (error) {
      return new Set();
    }
  };

  app.use(cors());
  app.use(express.json());

  const customers = createRepository(
    db,
    'customers',
  );

  const plans = createRepository(
    db,
    'membership_plans',
  );

  const memberships = createRepository(
    db,
    'memberships',
  );

  const attendances = createRepository(
    db,
    'customer_attendances',
  );

  const Customers = require(
    './services/customers.service',
  );

  const Plans = require(
    './services/membership-plans.service',
  );

  const Memberships = require(
    './services/memberships.service',
  );

  const Attendances = require(
    './services/customer-attendances.service',
  );

  app.get('/', (req, res) => {
    res.send('Gimnasio MQS API');
  });

  app.use(
    '/api/auth',
    require('./routes/auth.routes')(
      db,
      options.verifyPassword,
    ),
  );

  app.use(
    '/customers',
    require('./routes/customers.routes')(
      new Customers(customers),
    ),
  );

  app.use(
    '/membership-plans',
    require('./routes/membership-plans.routes')(
      new Plans(plans),
    ),
  );

  app.use(
    '/memberships',
    require('./routes/memberships.routes')(
      new Memberships(
        memberships,
        customers,
        plans,
      ),
    ),
  );

  app.use(
    '/customer-attendances',
    require('./routes/customer-attendances.routes')(
      new Attendances(
        attendances,
        customers,
        memberships,
      ),
    ),
  );

  const employeesRouter = express.Router();

  employeesRouter.get(
    '/positions',
    async (req, res, next) => {
      try {
        const positions = await safeListQuery(`
          SELECT
            id_position,
            name,
            description,
            status
          FROM positions
          WHERE status = 'ACTIVE'
          ORDER BY name ASC
        `, []);

        return res.status(200).json(
          positions,
        );
      } catch (error) {
        return next(error);
      }
    },
  );

  employeesRouter.get(
    '/',
    async (req, res, next) => {
      try {
        const [employees] = await db.query(`
          SELECT
            e.id_employee,
            e.id_position,
            e.first_name,
            e.last_name,
            e.phone,
            e.email,
            e.hire_date,
            e.status,
            p.name AS position_name
          FROM employees e
          LEFT JOIN positions p
            ON e.id_position = p.id_position
          ORDER BY e.id_employee DESC
        `);

        return res.status(200).json(
          employees,
        );
      } catch (error) {
        return next(error);
      }
    },
  );

  employeesRouter.post(
    '/',
    async (req, res, next) => {
      try {
        const {
          id_position,
          first_name,
          last_name,
          phone,
          email,
          hire_date,
          status,
        } = req.body || {};

        if (
          !id_position ||
          typeof first_name !== 'string' ||
          !first_name.trim() ||
          typeof last_name !== 'string' ||
          !last_name.trim() ||
          !hire_date
        ) {
          throw new BadRequestException(
            'Complete los campos obligatorios',
          );
        }

        const normalizedStatus =
          String(status || 'ACTIVE')
            .trim()
            .toUpperCase();

        if (
          normalizedStatus !== 'ACTIVE' &&
          normalizedStatus !== 'INACTIVE'
        ) {
          throw new BadRequestException(
            'Estado de empleado inválido',
          );
        }

        const [result] = await db.query(
          `
            INSERT INTO employees
            (
              id_position,
              first_name,
              last_name,
              phone,
              email,
              hire_date,
              status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
          [
            Number(id_position),
            first_name.trim(),
            last_name.trim(),
            phone?.trim() || null,
            email?.trim() || null,
            hire_date,
            normalizedStatus,
          ],
        );

        return res.status(201).json({
          message:
            'Empleado registrado correctamente',
          id_employee: result.insertId,
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  employeesRouter.put(
    '/:id',
    async (req, res, next) => {
      try {
        const idEmployee = Number(req.params.id);

        if (!Number.isInteger(idEmployee)) {
          throw new BadRequestException(
            'El id del empleado es inválido',
          );
        }

        const {
          id_position,
          first_name,
          last_name,
          phone,
          email,
          hire_date,
          status,
        } = req.body || {};

        if (
          !id_position ||
          typeof first_name !== 'string' ||
          !first_name.trim() ||
          typeof last_name !== 'string' ||
          !last_name.trim() ||
          !hire_date
        ) {
          throw new BadRequestException(
            'Complete los campos obligatorios',
          );
        }

        const normalizedStatus =
          String(status || 'ACTIVE')
            .trim()
            .toUpperCase();

        if (
          normalizedStatus !== 'ACTIVE' &&
          normalizedStatus !== 'INACTIVE'
        ) {
          throw new BadRequestException(
            'Estado de empleado inválido',
          );
        }

        const [result] = await db.query(
          `
            UPDATE employees
            SET
              id_position = ?,
              first_name = ?,
              last_name = ?,
              phone = ?,
              email = ?,
              hire_date = ?,
              status = ?
            WHERE id_employee = ?
          `,
          [
            Number(id_position),
            first_name.trim(),
            last_name.trim(),
            phone?.trim() || null,
            email?.trim() || null,
            hire_date,
            normalizedStatus,
            idEmployee,
          ],
        );

        if (result.affectedRows === 0) {
          throw new NotFoundException(
            'Empleado no encontrado',
          );
        }

        return res.status(200).json({
          message: 'Empleado actualizado correctamente',
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  employeesRouter.patch(
    '/:id/status',
    async (req, res, next) => {
      try {
        const idEmployee = Number(req.params.id);
        const nextStatus = String(
          req.body?.status || '',
        )
          .trim()
          .toUpperCase();

        if (!Number.isInteger(idEmployee)) {
          throw new BadRequestException(
            'El id del empleado es inválido',
          );
        }

        if (
          nextStatus !== 'ACTIVE' &&
          nextStatus !== 'INACTIVE'
        ) {
          throw new BadRequestException(
            'Estado de empleado inválido',
          );
        }

        const [result] = await db.query(
          'UPDATE employees SET status = ? WHERE id_employee = ?',
          [nextStatus, idEmployee],
        );

        if (result.affectedRows === 0) {
          throw new NotFoundException(
            'Empleado no encontrado',
          );
        }

        return res.status(200).json({
          message: 'Estado actualizado correctamente',
          status: nextStatus,
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  app.use(
    '/api/employees',
    employeesRouter,
  );

  const positionsRouter = express.Router();

  positionsRouter.get(
    '/',
    async (req, res, next) => {
      try {
        const [positions] = await db.query(`
          SELECT
            id_position,
            name,
            description,
            status
          FROM positions
          ORDER BY id_position DESC
        `);

        return res.status(200).json(positions);
      } catch (error) {
        return next(error);
      }
    },
  );

  positionsRouter.post(
    '/',
    async (req, res, next) => {
      try {
        const { name, description, status } = req.body || {};

        if (
          typeof name !== 'string' ||
          !name.trim()
        ) {
          throw new BadRequestException(
            'El nombre del cargo es obligatorio',
          );
        }

        const normalizedStatus =
          String(status || 'ACTIVE')
            .trim()
            .toUpperCase();

        if (
          normalizedStatus !== 'ACTIVE' &&
          normalizedStatus !== 'INACTIVE'
        ) {
          throw new BadRequestException(
            'Estado de cargo inválido',
          );
        }

        const [result] = await db.query(
          `
            INSERT INTO positions
            (name, description, status)
            VALUES (?, ?, ?)
          `,
          [
            name.trim(),
            description?.trim() || null,
            normalizedStatus,
          ],
        );

        return res.status(201).json({
          message: 'Cargo registrado correctamente',
          id_position: result.insertId,
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  positionsRouter.put(
    '/:id',
    async (req, res, next) => {
      try {
        const idPosition = Number(req.params.id);
        const { name, description, status } = req.body || {};

        if (!Number.isInteger(idPosition)) {
          throw new BadRequestException(
            'El id del cargo es inválido',
          );
        }

        if (
          typeof name !== 'string' ||
          !name.trim()
        ) {
          throw new BadRequestException(
            'El nombre del cargo es obligatorio',
          );
        }

        const normalizedStatus =
          String(status || 'ACTIVE')
            .trim()
            .toUpperCase();

        if (
          normalizedStatus !== 'ACTIVE' &&
          normalizedStatus !== 'INACTIVE'
        ) {
          throw new BadRequestException(
            'Estado de cargo inválido',
          );
        }

        const [result] = await db.query(
          `
            UPDATE positions
            SET
              name = ?,
              description = ?,
              status = ?
            WHERE id_position = ?
          `,
          [
            name.trim(),
            description?.trim() || null,
            normalizedStatus,
            idPosition,
          ],
        );

        if (result.affectedRows === 0) {
          throw new NotFoundException(
            'Cargo no encontrado',
          );
        }

        return res.status(200).json({
          message: 'Cargo actualizado correctamente',
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  app.use('/api/positions', positionsRouter);

  const shiftsRouter = express.Router();

  shiftsRouter.get(
    '/',
    async (req, res, next) => {
      try {
        const columns = await getTableColumns('work_shifts');
        const dayColumn = ['day_of_week', 'day'].find((name) => columns.has(name)) || 'day_of_week';
        const startColumn = ['start_time', 'startTime'].find((name) => columns.has(name)) || 'start_time';
        const endColumn = ['end_time', 'endTime'].find((name) => columns.has(name)) || 'end_time';

        const shifts = await safeListQuery(
          `
            SELECT
              ws.id_shift,
              ws.id_employee,
              ws.${dayColumn} AS day,
              ws.${startColumn} AS start_time,
              ws.${endColumn} AS end_time,
              ws.status,
              CONCAT(e.first_name, ' ', e.last_name) AS employee_name
            FROM work_shifts ws
            LEFT JOIN employees e
              ON ws.id_employee = e.id_employee
            ORDER BY ws.id_shift DESC
          `,
          [],
        );

        return res.status(200).json(shifts);
      } catch (error) {
        if (isMissingTableError(error)) {
          return res.status(200).json([]);
        }

        return next(error);
      }
    },
  );

  shiftsRouter.post(
    '/',
    async (req, res, next) => {
      try {
        const {
          id_employee,
          day,
          start_time,
          end_time,
          status,
        } = req.body || {};

        const normalizedDay = normalizeShiftDay(day);

        if (
          !id_employee ||
          typeof normalizedDay !== 'string' ||
          !normalizedDay.trim() ||
          typeof start_time !== 'string' ||
          !start_time.trim() ||
          typeof end_time !== 'string' ||
          !end_time.trim()
        ) {
          throw new BadRequestException(
            'Complete los campos obligatorios del turno',
          );
        }

        const normalizedStatus =
          String(status || 'ACTIVE')
            .trim()
            .toUpperCase();

        if (
          normalizedStatus !== 'ACTIVE' &&
          normalizedStatus !== 'INACTIVE'
        ) {
          throw new BadRequestException(
            'Estado del turno inválido',
          );
        }

        const columns = await getTableColumns('work_shifts');
        const dayColumn = ['day_of_week', 'day'].find((name) => columns.has(name)) || 'day';
        const startColumn = ['start_time', 'startTime'].find((name) => columns.has(name)) || 'start_time';
        const endColumn = ['end_time', 'endTime'].find((name) => columns.has(name)) || 'end_time';

        const [result] = await db.query(
          `
            INSERT INTO work_shifts
            (id_employee, ${dayColumn}, ${startColumn}, ${endColumn}, status)
            VALUES (?, ?, ?, ?, ?)
          `,
          [
            Number(id_employee),
            normalizedDay,
            start_time,
            end_time,
            normalizedStatus,
          ],
        );

        return res.status(201).json({
          message: 'Turno registrado correctamente',
          id_shift: result.insertId,
        });
      } catch (error) {
        if (isMissingTableError(error)) {
          return next(
            new BadRequestException(
              'La tabla de turnos aún no existe en la base de datos.',
            ),
          );
        }

        return next(error);
      }
    },
  );

  shiftsRouter.put(
    '/:id',
    async (req, res, next) => {
      try {
        const idShift = Number(req.params.id);
        const {
          id_employee,
          day,
          start_time,
          end_time,
          status,
        } = req.body || {};

        const normalizedDay = normalizeShiftDay(day);

        if (!Number.isInteger(idShift)) {
          throw new BadRequestException(
            'El id del turno es inválido',
          );
        }

        if (
          !id_employee ||
          typeof normalizedDay !== 'string' ||
          !normalizedDay.trim() ||
          typeof start_time !== 'string' ||
          !start_time.trim() ||
          typeof end_time !== 'string' ||
          !end_time.trim()
        ) {
          throw new BadRequestException(
            'Complete los campos obligatorios del turno',
          );
        }

        const normalizedStatus =
          String(status || 'ACTIVE')
            .trim()
            .toUpperCase();

        if (
          normalizedStatus !== 'ACTIVE' &&
          normalizedStatus !== 'INACTIVE'
        ) {
          throw new BadRequestException(
            'Estado del turno inválido',
          );
        }

        const columns = await getTableColumns('work_shifts');
        const dayColumn = ['day_of_week', 'day'].find((name) => columns.has(name)) || 'day';
        const startColumn = ['start_time', 'startTime'].find((name) => columns.has(name)) || 'start_time';
        const endColumn = ['end_time', 'endTime'].find((name) => columns.has(name)) || 'end_time';

        const [result] = await db.query(
          `
            UPDATE work_shifts
            SET
              id_employee = ?,
              ${dayColumn} = ?,
              ${startColumn} = ?,
              ${endColumn} = ?,
              status = ?
            WHERE id_shift = ?
          `,
          [
            Number(id_employee),
            normalizedDay,
            start_time,
            end_time,
            normalizedStatus,
            idShift,
          ],
        );

        if (result.affectedRows === 0) {
          throw new NotFoundException(
            'Turno no encontrado',
          );
        }

        return res.status(200).json({
          message: 'Turno actualizado correctamente',
        });
      } catch (error) {
        if (isMissingTableError(error)) {
          return next(
            new BadRequestException(
              'La tabla de turnos aún no existe en la base de datos.',
            ),
          );
        }

        return next(error);
      }
    },
  );

  app.use('/api/shifts', shiftsRouter);

  const attendanceRouter = express.Router();

  attendanceRouter.get(
    '/',
    async (req, res, next) => {
      try {
        const columns = await getTableColumns('employee_attendances');
        const attendanceDateColumn = ['attendance_date', 'date'].find((name) => columns.has(name)) || 'attendance_date';
        const checkInColumn = ['check_in', 'entry_time'].find((name) => columns.has(name)) || 'check_in';
        const checkOutColumn = ['check_out', 'exit_time'].find((name) => columns.has(name)) || 'check_out';

        const rows = await safeListQuery(
          `
            SELECT
              ea.id_employee_attendance,
              ea.id_employee,
              ea.id_shift,
              ea.${attendanceDateColumn} AS date,
              ea.${checkInColumn} AS entry_time,
              ea.${checkOutColumn} AS exit_time,
              ea.notes,
              CONCAT(e.first_name, ' ', e.last_name) AS employee_name
            FROM employee_attendances ea
            LEFT JOIN employees e
              ON ea.id_employee = e.id_employee
            ORDER BY ea.id_employee_attendance DESC
          `,
          [],
        );

        return res.status(200).json(rows);
      } catch (error) {
        if (isMissingTableError(error)) {
          return res.status(200).json([]);
        }

        return next(error);
      }
    },
  );

  attendanceRouter.post(
    '/',
    async (req, res, next) => {
      try {
        const {
          id_employee,
          id_shift,
          date,
          entry_time,
          exit_time,
          notes,
        } = normalizeAttendancePayload(req.body || {});

        if (
          !id_employee ||
          !id_shift ||
          typeof date !== 'string' ||
          !date.trim() ||
          typeof entry_time !== 'string' ||
          !entry_time.trim()
        ) {
          throw new BadRequestException(
            'Complete los campos obligatorios de la asistencia',
          );
        }

        const columns = await getTableColumns('employee_attendances');
        const attendanceDateColumn = ['attendance_date', 'date'].find((name) => columns.has(name)) || 'attendance_date';
        const checkInColumn = ['check_in', 'entry_time'].find((name) => columns.has(name)) || 'check_in';
        const checkOutColumn = ['check_out', 'exit_time'].find((name) => columns.has(name)) || 'check_out';

        const [result] = await db.query(
          `
            INSERT INTO employee_attendances
            (id_employee, id_shift, ${attendanceDateColumn}, ${checkInColumn}, ${checkOutColumn}, notes)
            VALUES (?, ?, ?, ?, ?, ?)
          `,
          [
            Number(id_employee),
            id_shift ? Number(id_shift) : null,
            date,
            entry_time,
            exit_time || null,
            notes?.trim() || null,
          ],
        );

        return res.status(201).json({
          message: 'Asistencia registrada correctamente',
          id_employee_attendance: result.insertId,
        });
      } catch (error) {
        if (isMissingTableError(error)) {
          return next(
            new BadRequestException(
              'La tabla de asistencia aún no existe en la base de datos.',
            ),
          );
        }

        return next(error);
      }
    },
  );

  attendanceRouter.put(
    '/:id',
    async (req, res, next) => {
      try {
        const idAttendance = Number(req.params.id);
        const {
          id_employee,
          id_shift,
          date,
          entry_time,
          exit_time,
          notes,
        } = normalizeAttendancePayload(req.body || {});

        if (!Number.isInteger(idAttendance)) {
          throw new BadRequestException(
            'El id de la asistencia es inválido',
          );
        }

        if (
          !id_employee ||
          !id_shift ||
          typeof date !== 'string' ||
          !date.trim() ||
          typeof entry_time !== 'string' ||
          !entry_time.trim()
        ) {
          throw new BadRequestException(
            'Complete los campos obligatorios de la asistencia',
          );
        }

        const columns = await getTableColumns('employee_attendances');
        const attendanceDateColumn = ['attendance_date', 'date'].find((name) => columns.has(name)) || 'attendance_date';
        const checkInColumn = ['check_in', 'entry_time'].find((name) => columns.has(name)) || 'check_in';
        const checkOutColumn = ['check_out', 'exit_time'].find((name) => columns.has(name)) || 'check_out';

        const [result] = await db.query(
          `
            UPDATE employee_attendances
            SET
              id_employee = ?,
              id_shift = ?,
              ${attendanceDateColumn} = ?,
              ${checkInColumn} = ?,
              ${checkOutColumn} = ?,
              notes = ?
            WHERE id_employee_attendance = ?
          `,
          [
            Number(id_employee),
            id_shift ? Number(id_shift) : null,
            date,
            entry_time,
            exit_time || null,
            notes?.trim() || null,
            idAttendance,
          ],
        );

        if (result.affectedRows === 0) {
          throw new NotFoundException(
            'Asistencia no encontrada',
          );
        }

        return res.status(200).json({
          message: 'Asistencia actualizada correctamente',
        });
      } catch (error) {
        if (isMissingTableError(error)) {
          return next(
            new BadRequestException(
              'La tabla de asistencia aún no existe en la base de datos.',
            ),
          );
        }

        return next(error);
      }
    },
  );

  app.use('/api/employee-attendance', attendanceRouter);

  app.use((req, res, next) => {
    next(
      new NotFoundException(
        `Cannot ${req.method} ${req.path}`,
      ),
    );
  });

  app.use(errorHandler);

  return app;
}

module.exports = {
  createApp,
};