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

  const validStatuses = new Set(['ACTIVE', 'INACTIVE']);
  const validShiftDays = new Set([
    'MONDAY',
    'TUESDAY',
    'WEDNESDAY',
    'THURSDAY',
    'FRIDAY',
    'SATURDAY',
    'SUNDAY',
  ]);

  const normalizeStatus = (value, defaultValue = 'ACTIVE') =>
    String(value || defaultValue).trim().toUpperCase();

  const requirePositiveInteger = (value, fieldName) => {
    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new BadRequestException(`${fieldName} inválido`);
    }

    return parsed;
  };

  const normalizeText = (value, maxLength = 255) => {
    const normalized = String(value ?? '').trim().replace(/\s+/g, ' ');

    if (normalized.length > maxLength) {
      throw new BadRequestException(
        `El texto no puede superar ${maxLength} caracteres`,
      );
    }

    return normalized;
  };

  const normalizeRequiredName = (value, label) => {
    const normalized = normalizeText(value, 80);

    if (!normalized) {
      throw new BadRequestException(`${label} es obligatorio`);
    }

    if (/\d/.test(normalized)) {
      throw new BadRequestException(
        `${label} no debe contener números`,
      );
    }

    return normalized;
  };

  const normalizeEmail = (value) => {
    const normalized = String(value ?? '').trim().toLowerCase();

    if (!normalized) {
      return null;
    }

    if (normalized.length > 150) {
      throw new BadRequestException(
        'El correo electrónico es demasiado largo',
      );
    }

    const emailRegex =
      /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

    if (!emailRegex.test(normalized)) {
      throw new BadRequestException(
        'El correo electrónico no tiene un formato válido',
      );
    }

    return normalized;
  };

  const normalizePhone = (value) => {
    const raw = String(value ?? '').trim();

    if (!raw) {
      return null;
    }

    const digits = raw.replace(/\D/g, '');

    if (digits.length < 7 || digits.length > 15) {
      throw new BadRequestException(
        'El teléfono debe contener entre 7 y 15 dígitos',
      );
    }

    return digits;
  };

  const isValidDateString = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
      return false;
    }

    const [year, month, day] = String(value)
      .split('-')
      .map(Number);

    const date = new Date(
      Date.UTC(year, month - 1, day),
    );

    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  };

  const todayDateString = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  };

  const normalizeDate = (
    value,
    label,
    { allowFuture = true } = {},
  ) => {
    const normalized = String(value || '').trim();

    if (!isValidDateString(normalized)) {
      throw new BadRequestException(
        `${label} no tiene una fecha válida`,
      );
    }

    if (!allowFuture && normalized > todayDateString()) {
      throw new BadRequestException(
        `${label} no puede ser una fecha futura`,
      );
    }

    return normalized;
  };

  const normalizeTime = (value, label, required = true) => {
    const raw = String(value ?? '').trim();

    if (!raw) {
      if (required) {
        throw new BadRequestException(
          `${label} es obligatoria`,
        );
      }

      return null;
    }

    const match = raw.match(
      /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/,
    );

    if (!match) {
      throw new BadRequestException(
        `${label} debe tener formato HH:MM`,
      );
    }

    return `${match[1]}:${match[2]}:${match[3] || '00'}`;
  };

  const timeToSeconds = (value) => {
    const normalized = normalizeTime(
      value,
      'Hora',
      true,
    );

    const [hours, minutes, seconds] =
      normalized.split(':').map(Number);

    return hours * 3600 + minutes * 60 + seconds;
  };

  const minutesBetween = (start, end) => {
    if (!start || !end) {
      return null;
    }

    return Math.round(
      (timeToSeconds(end) - timeToSeconds(start)) / 60,
    );
  };

  const getDayFromDate = (dateValue) => {
    const normalized = String(dateValue || '').trim();

    if (!isValidDateString(normalized)) {
      throw new BadRequestException(
        'La fecha de asistencia no es válida',
      );
    }

    const [year, month, day] = normalized
      .split('-')
      .map(Number);

    const weekday = new Date(
      Date.UTC(year, month - 1, day, 12, 0, 0),
    ).getUTCDay();

    const days = [
      'SUNDAY',
      'MONDAY',
      'TUESDAY',
      'WEDNESDAY',
      'THURSDAY',
      'FRIDAY',
      'SATURDAY',
    ];

    return days[weekday];
  };

  const validateStatus = (
    value,
    label,
    defaultValue = 'ACTIVE',
  ) => {
    const normalized = normalizeStatus(
      value,
      defaultValue,
    );

    if (!validStatuses.has(normalized)) {
      throw new BadRequestException(
        `Estado de ${label} inválido`,
      );
    }

    return normalized;
  };

  const getShiftColumns = async () => {
    const columns = await getTableColumns(
      'work_shifts',
    );

    return {
      day:
        ['day_of_week', 'day'].find(
          (name) => columns.has(name),
        ) || 'day_of_week',
      start:
        ['start_time', 'startTime'].find(
          (name) => columns.has(name),
        ) || 'start_time',
      end:
        ['end_time', 'endTime'].find(
          (name) => columns.has(name),
        ) || 'end_time',
    };
  };

  const getAttendanceColumns = async () => {
    const columns = await getTableColumns(
      'employee_attendances',
    );

    return {
      date:
        ['attendance_date', 'date'].find(
          (name) => columns.has(name),
        ) || 'attendance_date',
      entry:
        ['check_in', 'entry_time'].find(
          (name) => columns.has(name),
        ) || 'check_in',
      exit:
        ['check_out', 'exit_time'].find(
          (name) => columns.has(name),
        ) || 'check_out',
    };
  };

  const getEmployeeById = async (idEmployee) => {
    const [rows] = await db.query(
      `
        SELECT
          e.id_employee,
          e.id_position,
          e.first_name,
          e.last_name,
          e.phone,
          e.email,
          e.hire_date,
          e.status,
          p.name AS position_name,
          p.status AS position_status
        FROM employees e
        LEFT JOIN positions p
          ON e.id_position = p.id_position
        WHERE e.id_employee = ?
        LIMIT 1
      `,
      [idEmployee],
    );

    return rows[0] || null;
  };

  const getPositionById = async (idPosition) => {
    const [rows] = await db.query(
      `
        SELECT
          id_position,
          name,
          description,
          status
        FROM positions
        WHERE id_position = ?
        LIMIT 1
      `,
      [idPosition],
    );

    return rows[0] || null;
  };

  const ensurePositionAvailable = async (
    idPosition,
    employeeStatus = 'ACTIVE',
  ) => {
    const position = await getPositionById(
      idPosition,
    );

    if (!position) {
      throw new NotFoundException(
        'Cargo no encontrado',
      );
    }

    if (
      employeeStatus === 'ACTIVE' &&
      String(position.status).toUpperCase() !== 'ACTIVE'
    ) {
      throw new BadRequestException(
        'No se puede asignar un cargo inactivo a un empleado activo',
      );
    }

    return position;
  };

  const ensureEmployeeUniqueData = async ({
    phone,
    email,
    firstName,
    lastName,
    excludeEmployeeId = null,
  }) => {
    const conditions = [];
    const params = [];

    if (phone) {
      conditions.push(`
        REPLACE(
          REPLACE(
            REPLACE(
              REPLACE(
                REPLACE(COALESCE(phone, ''), ' ', ''),
                '-', ''
              ),
              '(', ''
            ),
            ')', ''
          ),
          '+', ''
        ) = ?
      `);
      params.push(phone);
    }

    if (email) {
      conditions.push(
        'LOWER(TRIM(COALESCE(email, \'\'))) = ?',
      );
      params.push(email);
    }

    if (firstName && lastName) {
      conditions.push(
        '(LOWER(TRIM(first_name)) = ? AND LOWER(TRIM(last_name)) = ?)',
      );
      params.push(
        firstName.toLowerCase(),
        lastName.toLowerCase(),
      );
    }

    if (!conditions.length) {
      return;
    }

    let sql = `
      SELECT
        id_employee,
        first_name,
        last_name,
        phone,
        email
      FROM employees
      WHERE (${conditions.join(' OR ')})
    `;

    if (excludeEmployeeId) {
      sql += ' AND id_employee <> ?';
      params.push(excludeEmployeeId);
    }

    sql += ' LIMIT 1';

    const [rows] = await db.query(sql, params);
    const duplicate = rows[0];

    if (!duplicate) {
      return;
    }

    const duplicatePhone =
      phone &&
      String(duplicate.phone || '')
        .replace(/\D/g, '') === phone;

    const duplicateEmail =
      email &&
      String(duplicate.email || '')
        .trim()
        .toLowerCase() === email;

    const duplicateName =
      firstName &&
      lastName &&
      String(duplicate.first_name || '')
        .trim()
        .toLowerCase() === firstName.toLowerCase() &&
      String(duplicate.last_name || '')
        .trim()
        .toLowerCase() === lastName.toLowerCase();

    if (duplicatePhone) {
      throw new BadRequestException(
        'Ya existe un empleado con ese teléfono',
      );
    }

    if (duplicateEmail) {
      throw new BadRequestException(
        'Ya existe un empleado con ese correo electrónico',
      );
    }

    if (duplicateName) {
      throw new BadRequestException(
        'Ya existe un empleado con el mismo nombre y apellido',
      );
    }
  };

  const ensurePositionNameUnique = async (
    name,
    excludePositionId = null,
  ) => {
    let sql = `
      SELECT id_position
      FROM positions
      WHERE LOWER(TRIM(name)) = ?
    `;

    const params = [name.toLowerCase()];

    if (excludePositionId) {
      sql += ' AND id_position <> ?';
      params.push(excludePositionId);
    }

    sql += ' LIMIT 1';

    const [rows] = await db.query(sql, params);

    if (rows.length) {
      throw new BadRequestException(
        'Ya existe un cargo con ese nombre',
      );
    }
  };

  const getShiftById = async (idShift) => {
    const shiftColumns = await getShiftColumns();

    const [rows] = await db.query(
      `
        SELECT
          ws.id_shift,
          ws.id_employee,
          ws.${shiftColumns.day} AS day,
          ws.${shiftColumns.start} AS start_time,
          ws.${shiftColumns.end} AS end_time,
          ws.status,
          CONCAT(
            e.first_name,
            ' ',
            e.last_name
          ) AS employee_name,
          e.status AS employee_status
        FROM work_shifts ws
        LEFT JOIN employees e
          ON ws.id_employee = e.id_employee
        WHERE ws.id_shift = ?
        LIMIT 1
      `,
      [idShift],
    );

    return rows[0] || null;
  };

  const validateShiftDay = (value) => {
    const normalized = normalizeShiftDay(value);

    if (!validShiftDays.has(normalized)) {
      throw new BadRequestException(
        'El día del turno es inválido',
      );
    }

    return normalized;
  };

  const validateShiftTimeRange = (
    startTime,
    endTime,
  ) => {
    const normalizedStart = normalizeTime(
      startTime,
      'La hora de entrada',
      true,
    );

    const normalizedEnd = normalizeTime(
      endTime,
      'La hora de salida',
      true,
    );

    if (
      timeToSeconds(normalizedEnd) <=
      timeToSeconds(normalizedStart)
    ) {
      throw new BadRequestException(
        'La hora de salida debe ser posterior a la hora de entrada',
      );
    }

    const durationMinutes =
      minutesBetween(
        normalizedStart,
        normalizedEnd,
      );

    if (durationMinutes > 16 * 60) {
      throw new BadRequestException(
        'Un turno no puede superar 16 horas',
      );
    }

    return {
      startTime: normalizedStart,
      endTime: normalizedEnd,
      durationMinutes,
    };
  };

  const ensureNoShiftOverlap = async ({
    idEmployee,
    day,
    startTime,
    endTime,
    excludeShiftId = null,
  }) => {
    const shiftColumns = await getShiftColumns();

    let sql = `
      SELECT
        id_shift,
        ${shiftColumns.start} AS start_time,
        ${shiftColumns.end} AS end_time
      FROM work_shifts
      WHERE id_employee = ?
        AND ${shiftColumns.day} = ?
        AND status = 'ACTIVE'
        AND ? < ${shiftColumns.end}
        AND ? > ${shiftColumns.start}
    `;

    const params = [
      idEmployee,
      day,
      startTime,
      endTime,
    ];

    if (excludeShiftId) {
      sql += ' AND id_shift <> ?';
      params.push(excludeShiftId);
    }

    sql += ' LIMIT 1';

    const [rows] = await db.query(sql, params);

    if (rows.length) {
      const conflict = rows[0];

      throw new BadRequestException(
        `El empleado ya tiene un turno activo que se superpone (${String(
          conflict.start_time,
        ).slice(0, 5)} - ${String(
          conflict.end_time,
        ).slice(0, 5)})`,
      );
    }
  };

  const enrichAttendanceRow = (row) => {
    const scheduledStart =
      row.shift_start_time || null;

    const scheduledEnd =
      row.shift_end_time || null;

    const entryTime =
      row.entry_time || null;

    const exitTime =
      row.exit_time || null;

    let lateMinutes = null;
    let workedMinutes = null;
    let scheduledMinutes = null;
    let overtimeMinutes = null;
    let punctuality = 'SIN_DATOS';

    if (scheduledStart && entryTime) {
      lateMinutes = Math.max(
        0,
        minutesBetween(
          scheduledStart,
          entryTime,
        ),
      );

      punctuality =
        lateMinutes > 0
          ? 'LATE'
          : 'ON_TIME';
    }

    if (entryTime && exitTime) {
      workedMinutes = Math.max(
        0,
        minutesBetween(
          entryTime,
          exitTime,
        ),
      );
    }

    if (scheduledStart && scheduledEnd) {
      scheduledMinutes = Math.max(
        0,
        minutesBetween(
          scheduledStart,
          scheduledEnd,
        ),
      );
    }

    if (
      workedMinutes !== null &&
      scheduledMinutes !== null
    ) {
      overtimeMinutes = Math.max(
        0,
        workedMinutes - scheduledMinutes,
      );
    }

    return {
      ...row,
      late_minutes: lateMinutes,
      worked_minutes: workedMinutes,
      scheduled_minutes: scheduledMinutes,
      overtime_minutes: overtimeMinutes,
      punctuality,
    };
  };

  const getAttendanceById = async (
    idAttendance,
  ) => {
    const attendanceColumns =
      await getAttendanceColumns();

    const [rows] = await db.query(
      `
        SELECT
          id_employee_attendance,
          id_employee,
          id_shift,
          ${attendanceColumns.date} AS date,
          ${attendanceColumns.entry} AS entry_time,
          ${attendanceColumns.exit} AS exit_time,
          notes
        FROM employee_attendances
        WHERE id_employee_attendance = ?
        LIMIT 1
      `,
      [idAttendance],
    );

    return rows[0] || null;
  };

  const validateAttendanceRelation = async ({
    idEmployee,
    idShift,
    date,
    entryTime,
    exitTime,
    requireActive = true,
  }) => {
    const employee = await getEmployeeById(
      idEmployee,
    );

    if (!employee) {
      throw new NotFoundException(
        'Empleado no encontrado',
      );
    }

    if (
      requireActive &&
      String(employee.status).toUpperCase() !== 'ACTIVE'
    ) {
      throw new BadRequestException(
        'No se puede registrar asistencia para un empleado inactivo',
      );
    }

    if (
      employee.hire_date &&
      String(employee.hire_date).slice(0, 10) > date
    ) {
      throw new BadRequestException(
        'La asistencia no puede ser anterior a la fecha de contratación del empleado',
      );
    }

    const shift = await getShiftById(idShift);

    if (!shift) {
      throw new NotFoundException(
        'Turno no encontrado',
      );
    }

    if (
      Number(shift.id_employee) !==
      Number(idEmployee)
    ) {
      throw new BadRequestException(
        'El turno seleccionado no pertenece al empleado',
      );
    }

    if (
      requireActive &&
      String(shift.status).toUpperCase() !== 'ACTIVE'
    ) {
      throw new BadRequestException(
        'El turno seleccionado está inactivo',
      );
    }

    const expectedDay = validateShiftDay(
      shift.day,
    );

    const actualDay = getDayFromDate(date);

    if (expectedDay !== actualDay) {
      throw new BadRequestException(
        'La fecha de asistencia no corresponde al día del turno seleccionado',
      );
    }

    if (
      exitTime &&
      timeToSeconds(exitTime) <
        timeToSeconds(entryTime)
    ) {
      throw new BadRequestException(
        'La hora de salida no puede ser anterior a la hora de entrada',
      );
    }

    return {
      employee,
      shift,
    };
  };

  const ensureNoDuplicateAttendance = async ({
    idEmployee,
    idShift,
    date,
    excludeAttendanceId = null,
  }) => {
    const attendanceColumns =
      await getAttendanceColumns();

    let sql = `
      SELECT id_employee_attendance
      FROM employee_attendances
      WHERE id_employee = ?
        AND id_shift = ?
        AND ${attendanceColumns.date} = ?
    `;

    const params = [
      idEmployee,
      idShift,
      date,
    ];

    if (excludeAttendanceId) {
      sql +=
        ' AND id_employee_attendance <> ?';
      params.push(excludeAttendanceId);
    }

    sql += ' LIMIT 1';

    const [rows] = await db.query(sql, params);

    if (rows.length) {
      throw new BadRequestException(
        'Ya existe una asistencia para este empleado, turno y fecha',
      );
    }
  };

  const employeesRouter = express.Router();

  employeesRouter.get(
    '/positions',
    async (req, res, next) => {
      try {
        const [positions] = await db.query(`
          SELECT
            id_position,
            name,
            description,
            status
          FROM positions
          WHERE status = 'ACTIVE'
          ORDER BY name ASC
        `);

        return res.status(200).json(positions);
      } catch (error) {
        return next(error);
      }
    },
  );

  employeesRouter.get(
    '/',
    async (req, res, next) => {
      try {
        const conditions = [];
        const params = [];

        const status = String(
          req.query.status || '',
        )
          .trim()
          .toUpperCase();

        if (status) {
          if (!validStatuses.has(status)) {
            throw new BadRequestException(
              'Estado de empleado inválido',
            );
          }

          conditions.push('e.status = ?');
          params.push(status);
        }

        if (req.query.id_position) {
          const idPosition =
            requirePositiveInteger(
              req.query.id_position,
              'El id del cargo',
            );

          conditions.push(
            'e.id_position = ?',
          );
          params.push(idPosition);
        }

        const search = normalizeText(
          req.query.search || '',
          100,
        );

        if (search) {
          conditions.push(`
            (
              CONCAT(
                e.first_name,
                ' ',
                e.last_name
              ) LIKE ?
              OR e.phone LIKE ?
              OR e.email LIKE ?
              OR p.name LIKE ?
            )
          `);

          const term = `%${search}%`;

          params.push(
            term,
            term,
            term,
            term,
          );
        }

        let sql = `
          SELECT
            e.id_employee,
            e.id_position,
            e.first_name,
            e.last_name,
            e.phone,
            e.email,
            e.hire_date,
            e.status,
            p.name AS position_name,
            p.status AS position_status
          FROM employees e
          LEFT JOIN positions p
            ON e.id_position = p.id_position
        `;

        if (conditions.length) {
          sql += ` WHERE ${conditions.join(' AND ')}`;
        }

        sql += `
          ORDER BY
            e.status = 'ACTIVE' DESC,
            e.id_employee DESC
        `;

        const [employees] = await db.query(
          sql,
          params,
        );

        return res.status(200).json(
          employees,
        );
      } catch (error) {
        return next(error);
      }
    },
  );

  employeesRouter.get(
    '/:id',
    async (req, res, next) => {
      try {
        const idEmployee =
          requirePositiveInteger(
            req.params.id,
            'El id del empleado',
          );

        const employee = await getEmployeeById(
          idEmployee,
        );

        if (!employee) {
          throw new NotFoundException(
            'Empleado no encontrado',
          );
        }

        return res.status(200).json(employee);
      } catch (error) {
        return next(error);
      }
    },
  );

  employeesRouter.post(
    '/',
    async (req, res, next) => {
      try {
        const idPosition =
          requirePositiveInteger(
            req.body?.id_position,
            'El id del cargo',
          );

        const firstName =
          normalizeRequiredName(
            req.body?.first_name,
            'El nombre',
          );

        const lastName =
          normalizeRequiredName(
            req.body?.last_name,
            'El apellido',
          );

        const phone = normalizePhone(
          req.body?.phone,
        );

        const email = normalizeEmail(
          req.body?.email,
        );

        const hireDate = normalizeDate(
          req.body?.hire_date,
          'La fecha de contratación',
          { allowFuture: false },
        );

        const status = validateStatus(
          req.body?.status,
          'empleado',
        );

        await ensurePositionAvailable(
          idPosition,
          status,
        );

        await ensureEmployeeUniqueData({
          phone,
          email,
          firstName,
          lastName,
        });

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
            idPosition,
            firstName,
            lastName,
            phone,
            email,
            hireDate,
            status,
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
        const idEmployee =
          requirePositiveInteger(
            req.params.id,
            'El id del empleado',
          );

        const current = await getEmployeeById(
          idEmployee,
        );

        if (!current) {
          throw new NotFoundException(
            'Empleado no encontrado',
          );
        }

        const idPosition =
          requirePositiveInteger(
            req.body?.id_position,
            'El id del cargo',
          );

        const firstName =
          normalizeRequiredName(
            req.body?.first_name,
            'El nombre',
          );

        const lastName =
          normalizeRequiredName(
            req.body?.last_name,
            'El apellido',
          );

        const phone = normalizePhone(
          req.body?.phone,
        );

        const email = normalizeEmail(
          req.body?.email,
        );

        const hireDate = normalizeDate(
          req.body?.hire_date,
          'La fecha de contratación',
          { allowFuture: false },
        );

        const status = validateStatus(
          req.body?.status,
          'empleado',
          current.status,
        );

        await ensurePositionAvailable(
          idPosition,
          status,
        );

        await ensureEmployeeUniqueData({
          phone,
          email,
          firstName,
          lastName,
          excludeEmployeeId: idEmployee,
        });

        await db.query(
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
            idPosition,
            firstName,
            lastName,
            phone,
            email,
            hireDate,
            status,
            idEmployee,
          ],
        );

        if (status === 'INACTIVE') {
          try {
            await db.query(
              `
                UPDATE work_shifts
                SET status = 'INACTIVE'
                WHERE id_employee = ?
                  AND status = 'ACTIVE'
              `,
              [idEmployee],
            );
          } catch (error) {
            if (!isMissingTableError(error)) {
              throw error;
            }
          }
        }

        return res.status(200).json({
          message:
            'Empleado actualizado correctamente',
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
        const idEmployee =
          requirePositiveInteger(
            req.params.id,
            'El id del empleado',
          );

        const current = await getEmployeeById(
          idEmployee,
        );

        if (!current) {
          throw new NotFoundException(
            'Empleado no encontrado',
          );
        }

        const nextStatus = validateStatus(
          req.body?.status,
          'empleado',
        );

        if (nextStatus === 'ACTIVE') {
          await ensurePositionAvailable(
            current.id_position,
            'ACTIVE',
          );
        }

        await db.query(
          `
            UPDATE employees
            SET status = ?
            WHERE id_employee = ?
          `,
          [nextStatus, idEmployee],
        );

        let disabledShifts = 0;

        if (nextStatus === 'INACTIVE') {
          try {
            const [shiftResult] =
              await db.query(
                `
                  UPDATE work_shifts
                  SET status = 'INACTIVE'
                  WHERE id_employee = ?
                    AND status = 'ACTIVE'
                `,
                [idEmployee],
              );

            disabledShifts =
              shiftResult.affectedRows || 0;
          } catch (error) {
            if (!isMissingTableError(error)) {
              throw error;
            }
          }
        }

        return res.status(200).json({
          message:
            'Estado actualizado correctamente',
          status: nextStatus,
          disabled_shifts: disabledShifts,
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
        const conditions = [];
        const params = [];

        const status = String(
          req.query.status || '',
        )
          .trim()
          .toUpperCase();

        if (status) {
          if (!validStatuses.has(status)) {
            throw new BadRequestException(
              'Estado de cargo inválido',
            );
          }

          conditions.push('p.status = ?');
          params.push(status);
        }

        const search = normalizeText(
          req.query.search || '',
          100,
        );

        if (search) {
          conditions.push(
            '(p.name LIKE ? OR p.description LIKE ?)',
          );
          params.push(
            `%${search}%`,
            `%${search}%`,
          );
        }

        let sql = `
          SELECT
            p.id_position,
            p.name,
            p.description,
            p.status,
            COUNT(e.id_employee) AS employee_count,
            SUM(
              CASE
                WHEN e.status = 'ACTIVE'
                THEN 1
                ELSE 0
              END
            ) AS active_employee_count
          FROM positions p
          LEFT JOIN employees e
            ON e.id_position = p.id_position
        `;

        if (conditions.length) {
          sql += ` WHERE ${conditions.join(' AND ')}`;
        }

        sql += `
          GROUP BY
            p.id_position,
            p.name,
            p.description,
            p.status
          ORDER BY
            p.status = 'ACTIVE' DESC,
            p.name ASC
        `;

        const [positions] = await db.query(
          sql,
          params,
        );

        return res.status(200).json(positions);
      } catch (error) {
        return next(error);
      }
    },
  );

  positionsRouter.get(
    '/:id',
    async (req, res, next) => {
      try {
        const idPosition =
          requirePositiveInteger(
            req.params.id,
            'El id del cargo',
          );

        const [rows] = await db.query(
          `
            SELECT
              p.id_position,
              p.name,
              p.description,
              p.status,
              COUNT(e.id_employee) AS employee_count,
              SUM(
                CASE
                  WHEN e.status = 'ACTIVE'
                  THEN 1
                  ELSE 0
                END
              ) AS active_employee_count
            FROM positions p
            LEFT JOIN employees e
              ON e.id_position = p.id_position
            WHERE p.id_position = ?
            GROUP BY
              p.id_position,
              p.name,
              p.description,
              p.status
            LIMIT 1
          `,
          [idPosition],
        );

        if (!rows.length) {
          throw new NotFoundException(
            'Cargo no encontrado',
          );
        }

        return res.status(200).json(rows[0]);
      } catch (error) {
        return next(error);
      }
    },
  );

  positionsRouter.post(
    '/',
    async (req, res, next) => {
      try {
        const name = normalizeText(
          req.body?.name,
          80,
        );

        if (!name) {
          throw new BadRequestException(
            'El nombre del cargo es obligatorio',
          );
        }

        const description =
          normalizeText(
            req.body?.description || '',
            500,
          ) || null;

        const status = validateStatus(
          req.body?.status,
          'cargo',
        );

        await ensurePositionNameUnique(name);

        const [result] = await db.query(
          `
            INSERT INTO positions
            (name, description, status)
            VALUES (?, ?, ?)
          `,
          [
            name,
            description,
            status,
          ],
        );

        return res.status(201).json({
          message:
            'Cargo registrado correctamente',
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
        const idPosition =
          requirePositiveInteger(
            req.params.id,
            'El id del cargo',
          );

        const current = await getPositionById(
          idPosition,
        );

        if (!current) {
          throw new NotFoundException(
            'Cargo no encontrado',
          );
        }

        const name = normalizeText(
          req.body?.name,
          80,
        );

        if (!name) {
          throw new BadRequestException(
            'El nombre del cargo es obligatorio',
          );
        }

        const description =
          normalizeText(
            req.body?.description || '',
            500,
          ) || null;

        const status = validateStatus(
          req.body?.status,
          'cargo',
          current.status,
        );

        await ensurePositionNameUnique(
          name,
          idPosition,
        );

        if (status === 'INACTIVE') {
          const [rows] = await db.query(
            `
              SELECT COUNT(*) AS total
              FROM employees
              WHERE id_position = ?
                AND status = 'ACTIVE'
            `,
            [idPosition],
          );

          const activeEmployees =
            Number(rows[0]?.total || 0);

          if (activeEmployees > 0) {
            throw new BadRequestException(
              `No se puede inactivar el cargo porque tiene ${activeEmployees} empleado(s) activo(s) asignado(s)`,
            );
          }
        }

        await db.query(
          `
            UPDATE positions
            SET
              name = ?,
              description = ?,
              status = ?
            WHERE id_position = ?
          `,
          [
            name,
            description,
            status,
            idPosition,
          ],
        );

        return res.status(200).json({
          message:
            'Cargo actualizado correctamente',
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  positionsRouter.patch(
    '/:id/status',
    async (req, res, next) => {
      try {
        const idPosition =
          requirePositiveInteger(
            req.params.id,
            'El id del cargo',
          );

        const current = await getPositionById(
          idPosition,
        );

        if (!current) {
          throw new NotFoundException(
            'Cargo no encontrado',
          );
        }

        const nextStatus = validateStatus(
          req.body?.status,
          'cargo',
        );

        if (nextStatus === 'INACTIVE') {
          const [rows] = await db.query(
            `
              SELECT COUNT(*) AS total
              FROM employees
              WHERE id_position = ?
                AND status = 'ACTIVE'
            `,
            [idPosition],
          );

          const activeEmployees =
            Number(rows[0]?.total || 0);

          if (activeEmployees > 0) {
            throw new BadRequestException(
              `No se puede inactivar el cargo porque tiene ${activeEmployees} empleado(s) activo(s) asignado(s)`,
            );
          }
        }

        await db.query(
          `
            UPDATE positions
            SET status = ?
            WHERE id_position = ?
          `,
          [nextStatus, idPosition],
        );

        return res.status(200).json({
          message:
            'Estado del cargo actualizado correctamente',
          status: nextStatus,
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  app.use(
    '/api/positions',
    positionsRouter,
  );

  const shiftsRouter = express.Router();

  shiftsRouter.get(
    '/',
    async (req, res, next) => {
      try {
        const shiftColumns =
          await getShiftColumns();

        const conditions = [];
        const params = [];

        if (req.query.id_employee) {
          const idEmployee =
            requirePositiveInteger(
              req.query.id_employee,
              'El id del empleado',
            );

          conditions.push(
            'ws.id_employee = ?',
          );
          params.push(idEmployee);
        }

        const status = String(
          req.query.status || '',
        )
          .trim()
          .toUpperCase();

        if (status) {
          if (!validStatuses.has(status)) {
            throw new BadRequestException(
              'Estado del turno inválido',
            );
          }

          conditions.push('ws.status = ?');
          params.push(status);
        }

        if (req.query.day) {
          const day = validateShiftDay(
            req.query.day,
          );

          conditions.push(
            `ws.${shiftColumns.day} = ?`,
          );
          params.push(day);
        }

        let sql = `
          SELECT
            ws.id_shift,
            ws.id_employee,
            ws.${shiftColumns.day} AS day,
            ws.${shiftColumns.start} AS start_time,
            ws.${shiftColumns.end} AS end_time,
            ws.status,
            CONCAT(
              e.first_name,
              ' ',
              e.last_name
            ) AS employee_name,
            e.status AS employee_status,
            p.name AS position_name
          FROM work_shifts ws
          LEFT JOIN employees e
            ON ws.id_employee = e.id_employee
          LEFT JOIN positions p
            ON e.id_position = p.id_position
        `;

        if (conditions.length) {
          sql += ` WHERE ${conditions.join(' AND ')}`;
        }

        sql += `
          ORDER BY
            ws.status = 'ACTIVE' DESC,
            FIELD(
              ws.${shiftColumns.day},
              'MONDAY',
              'TUESDAY',
              'WEDNESDAY',
              'THURSDAY',
              'FRIDAY',
              'SATURDAY',
              'SUNDAY'
            ),
            ws.${shiftColumns.start} ASC,
            ws.id_shift DESC
        `;

        const [shifts] = await db.query(
          sql,
          params,
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

  shiftsRouter.get(
    '/:id',
    async (req, res, next) => {
      try {
        const idShift =
          requirePositiveInteger(
            req.params.id,
            'El id del turno',
          );

        const shift = await getShiftById(
          idShift,
        );

        if (!shift) {
          throw new NotFoundException(
            'Turno no encontrado',
          );
        }

        return res.status(200).json(shift);
      } catch (error) {
        return next(error);
      }
    },
  );

  shiftsRouter.post(
    '/',
    async (req, res, next) => {
      try {
        const idEmployee =
          requirePositiveInteger(
            req.body?.id_employee,
            'El id del empleado',
          );

        const day = validateShiftDay(
          req.body?.day,
        );

        const {
          startTime,
          endTime,
          durationMinutes,
        } = validateShiftTimeRange(
          req.body?.start_time,
          req.body?.end_time,
        );

        const status = validateStatus(
          req.body?.status,
          'turno',
        );

        const employee = await getEmployeeById(
          idEmployee,
        );

        if (!employee) {
          throw new NotFoundException(
            'Empleado no encontrado',
          );
        }

        if (
          status === 'ACTIVE' &&
          String(employee.status).toUpperCase() !== 'ACTIVE'
        ) {
          throw new BadRequestException(
            'No se puede asignar un turno activo a un empleado inactivo',
          );
        }

        if (status === 'ACTIVE') {
          await ensureNoShiftOverlap({
            idEmployee,
            day,
            startTime,
            endTime,
          });
        }

        const shiftColumns =
          await getShiftColumns();

        const [result] = await db.query(
          `
            INSERT INTO work_shifts
            (
              id_employee,
              ${shiftColumns.day},
              ${shiftColumns.start},
              ${shiftColumns.end},
              status
            )
            VALUES (?, ?, ?, ?, ?)
          `,
          [
            idEmployee,
            day,
            startTime,
            endTime,
            status,
          ],
        );

        return res.status(201).json({
          message:
            'Turno registrado correctamente',
          id_shift: result.insertId,
          duration_minutes: durationMinutes,
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
        const idShift =
          requirePositiveInteger(
            req.params.id,
            'El id del turno',
          );

        const current = await getShiftById(
          idShift,
        );

        if (!current) {
          throw new NotFoundException(
            'Turno no encontrado',
          );
        }

        const idEmployee =
          requirePositiveInteger(
            req.body?.id_employee,
            'El id del empleado',
          );

        const day = validateShiftDay(
          req.body?.day,
        );

        const {
          startTime,
          endTime,
          durationMinutes,
        } = validateShiftTimeRange(
          req.body?.start_time,
          req.body?.end_time,
        );

        const status = validateStatus(
          req.body?.status,
          'turno',
          current.status,
        );

        const employee = await getEmployeeById(
          idEmployee,
        );

        if (!employee) {
          throw new NotFoundException(
            'Empleado no encontrado',
          );
        }

        if (
          status === 'ACTIVE' &&
          String(employee.status).toUpperCase() !== 'ACTIVE'
        ) {
          throw new BadRequestException(
            'No se puede asignar un turno activo a un empleado inactivo',
          );
        }

        if (status === 'ACTIVE') {
          await ensureNoShiftOverlap({
            idEmployee,
            day,
            startTime,
            endTime,
            excludeShiftId: idShift,
          });
        }

        const shiftColumns =
          await getShiftColumns();

        await db.query(
          `
            UPDATE work_shifts
            SET
              id_employee = ?,
              ${shiftColumns.day} = ?,
              ${shiftColumns.start} = ?,
              ${shiftColumns.end} = ?,
              status = ?
            WHERE id_shift = ?
          `,
          [
            idEmployee,
            day,
            startTime,
            endTime,
            status,
            idShift,
          ],
        );

        return res.status(200).json({
          message:
            'Turno actualizado correctamente',
          duration_minutes: durationMinutes,
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

  shiftsRouter.patch(
    '/:id/status',
    async (req, res, next) => {
      try {
        const idShift =
          requirePositiveInteger(
            req.params.id,
            'El id del turno',
          );

        const shift = await getShiftById(
          idShift,
        );

        if (!shift) {
          throw new NotFoundException(
            'Turno no encontrado',
          );
        }

        const nextStatus = validateStatus(
          req.body?.status,
          'turno',
        );

        if (nextStatus === 'ACTIVE') {
          const employee = await getEmployeeById(
            shift.id_employee,
          );

          if (
            !employee ||
            String(employee.status).toUpperCase() !== 'ACTIVE'
          ) {
            throw new BadRequestException(
              'No se puede activar el turno porque el empleado está inactivo',
            );
          }

          await ensureNoShiftOverlap({
            idEmployee: shift.id_employee,
            day: validateShiftDay(shift.day),
            startTime: normalizeTime(
              shift.start_time,
              'La hora de entrada',
            ),
            endTime: normalizeTime(
              shift.end_time,
              'La hora de salida',
            ),
            excludeShiftId: idShift,
          });
        }

        await db.query(
          `
            UPDATE work_shifts
            SET status = ?
            WHERE id_shift = ?
          `,
          [nextStatus, idShift],
        );

        return res.status(200).json({
          message:
            'Estado del turno actualizado correctamente',
          status: nextStatus,
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  app.use(
    '/api/shifts',
    shiftsRouter,
  );

  const attendanceRouter = express.Router();

  attendanceRouter.get(
    '/',
    async (req, res, next) => {
      try {
        const attendanceColumns =
          await getAttendanceColumns();

        const shiftColumns =
          await getShiftColumns();

        const conditions = [];
        const params = [];

        if (req.query.id_employee) {
          const idEmployee =
            requirePositiveInteger(
              req.query.id_employee,
              'El id del empleado',
            );

          conditions.push(
            'ea.id_employee = ?',
          );
          params.push(idEmployee);
        }

        if (req.query.id_shift) {
          const idShift =
            requirePositiveInteger(
              req.query.id_shift,
              'El id del turno',
            );

          conditions.push(
            'ea.id_shift = ?',
          );
          params.push(idShift);
        }

        if (req.query.date_from) {
          const dateFrom = normalizeDate(
            req.query.date_from,
            'La fecha inicial',
          );

          conditions.push(
            `ea.${attendanceColumns.date} >= ?`,
          );
          params.push(dateFrom);
        }

        if (req.query.date_to) {
          const dateTo = normalizeDate(
            req.query.date_to,
            'La fecha final',
          );

          conditions.push(
            `ea.${attendanceColumns.date} <= ?`,
          );
          params.push(dateTo);
        }

        let sql = `
          SELECT
            ea.id_employee_attendance,
            ea.id_employee,
            ea.id_shift,
            ea.${attendanceColumns.date} AS date,
            ea.${attendanceColumns.entry} AS entry_time,
            ea.${attendanceColumns.exit} AS exit_time,
            ea.notes,
            CONCAT(
              e.first_name,
              ' ',
              e.last_name
            ) AS employee_name,
            e.status AS employee_status,
            p.name AS position_name,
            ws.${shiftColumns.day} AS shift_day,
            ws.${shiftColumns.start} AS shift_start_time,
            ws.${shiftColumns.end} AS shift_end_time,
            ws.status AS shift_status
          FROM employee_attendances ea
          LEFT JOIN employees e
            ON ea.id_employee = e.id_employee
          LEFT JOIN positions p
            ON e.id_position = p.id_position
          LEFT JOIN work_shifts ws
            ON ea.id_shift = ws.id_shift
        `;

        if (conditions.length) {
          sql += ` WHERE ${conditions.join(' AND ')}`;
        }

        sql += `
          ORDER BY
            ea.${attendanceColumns.date} DESC,
            ea.${attendanceColumns.entry} DESC,
            ea.id_employee_attendance DESC
        `;

        const [rows] = await db.query(
          sql,
          params,
        );

        return res.status(200).json(
          rows.map(enrichAttendanceRow),
        );
      } catch (error) {
        if (isMissingTableError(error)) {
          return res.status(200).json([]);
        }

        return next(error);
      }
    },
  );

  attendanceRouter.get(
    '/:id',
    async (req, res, next) => {
      try {
        const idAttendance =
          requirePositiveInteger(
            req.params.id,
            'El id de la asistencia',
          );

        const attendanceColumns =
          await getAttendanceColumns();

        const shiftColumns =
          await getShiftColumns();

        const [rows] = await db.query(
          `
            SELECT
              ea.id_employee_attendance,
              ea.id_employee,
              ea.id_shift,
              ea.${attendanceColumns.date} AS date,
              ea.${attendanceColumns.entry} AS entry_time,
              ea.${attendanceColumns.exit} AS exit_time,
              ea.notes,
              CONCAT(
                e.first_name,
                ' ',
                e.last_name
              ) AS employee_name,
              p.name AS position_name,
              ws.${shiftColumns.day} AS shift_day,
              ws.${shiftColumns.start} AS shift_start_time,
              ws.${shiftColumns.end} AS shift_end_time
            FROM employee_attendances ea
            LEFT JOIN employees e
              ON ea.id_employee = e.id_employee
            LEFT JOIN positions p
              ON e.id_position = p.id_position
            LEFT JOIN work_shifts ws
              ON ea.id_shift = ws.id_shift
            WHERE ea.id_employee_attendance = ?
            LIMIT 1
          `,
          [idAttendance],
        );

        if (!rows.length) {
          throw new NotFoundException(
            'Asistencia no encontrada',
          );
        }

        return res.status(200).json(
          enrichAttendanceRow(rows[0]),
        );
      } catch (error) {
        return next(error);
      }
    },
  );

  attendanceRouter.post(
    '/',
    async (req, res, next) => {
      try {
        const payload =
          normalizeAttendancePayload(
            req.body || {},
          );

        const idEmployee =
          requirePositiveInteger(
            payload.id_employee,
            'El id del empleado',
          );

        const idShift =
          requirePositiveInteger(
            payload.id_shift,
            'El id del turno',
          );

        const date = normalizeDate(
          payload.date,
          'La fecha de asistencia',
          { allowFuture: false },
        );

        const entryTime = normalizeTime(
          payload.entry_time,
          'La hora de entrada',
          true,
        );

        const exitTime = normalizeTime(
          payload.exit_time,
          'La hora de salida',
          false,
        );

        const notes =
          normalizeText(
            payload.notes || '',
            1000,
          ) || null;

        const { shift } =
          await validateAttendanceRelation({
            idEmployee,
            idShift,
            date,
            entryTime,
            exitTime,
            requireActive: true,
          });

        await ensureNoDuplicateAttendance({
          idEmployee,
          idShift,
          date,
        });

        const attendanceColumns =
          await getAttendanceColumns();

        const [result] = await db.query(
          `
            INSERT INTO employee_attendances
            (
              id_employee,
              id_shift,
              ${attendanceColumns.date},
              ${attendanceColumns.entry},
              ${attendanceColumns.exit},
              notes
            )
            VALUES (?, ?, ?, ?, ?, ?)
          `,
          [
            idEmployee,
            idShift,
            date,
            entryTime,
            exitTime,
            notes,
          ],
        );

        const metrics = enrichAttendanceRow({
          entry_time: entryTime,
          exit_time: exitTime,
          shift_start_time:
            shift.start_time,
          shift_end_time:
            shift.end_time,
        });

        return res.status(201).json({
          message:
            'Asistencia registrada correctamente',
          id_employee_attendance:
            result.insertId,
          late_minutes:
            metrics.late_minutes,
          worked_minutes:
            metrics.worked_minutes,
          scheduled_minutes:
            metrics.scheduled_minutes,
          overtime_minutes:
            metrics.overtime_minutes,
          punctuality:
            metrics.punctuality,
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
        const idAttendance =
          requirePositiveInteger(
            req.params.id,
            'El id de la asistencia',
          );

        const current =
          await getAttendanceById(
            idAttendance,
          );

        if (!current) {
          throw new NotFoundException(
            'Asistencia no encontrada',
          );
        }

        const payload =
          normalizeAttendancePayload(
            req.body || {},
          );

        const idEmployee =
          requirePositiveInteger(
            payload.id_employee,
            'El id del empleado',
          );

        const idShift =
          requirePositiveInteger(
            payload.id_shift,
            'El id del turno',
          );

        const date = normalizeDate(
          payload.date,
          'La fecha de asistencia',
          { allowFuture: false },
        );

        const entryTime = normalizeTime(
          payload.entry_time,
          'La hora de entrada',
          true,
        );

        const exitTime = normalizeTime(
          payload.exit_time,
          'La hora de salida',
          false,
        );

        const notes =
          normalizeText(
            payload.notes || '',
            1000,
          ) || null;

        await validateAttendanceRelation({
          idEmployee,
          idShift,
          date,
          entryTime,
          exitTime,
          requireActive: false,
        });

        await ensureNoDuplicateAttendance({
          idEmployee,
          idShift,
          date,
          excludeAttendanceId:
            idAttendance,
        });

        const attendanceColumns =
          await getAttendanceColumns();

        await db.query(
          `
            UPDATE employee_attendances
            SET
              id_employee = ?,
              id_shift = ?,
              ${attendanceColumns.date} = ?,
              ${attendanceColumns.entry} = ?,
              ${attendanceColumns.exit} = ?,
              notes = ?
            WHERE id_employee_attendance = ?
          `,
          [
            idEmployee,
            idShift,
            date,
            entryTime,
            exitTime,
            notes,
            idAttendance,
          ],
        );

        const shift = await getShiftById(
          idShift,
        );

        const metrics = enrichAttendanceRow({
          entry_time: entryTime,
          exit_time: exitTime,
          shift_start_time:
            shift?.start_time || null,
          shift_end_time:
            shift?.end_time || null,
        });

        return res.status(200).json({
          message:
            'Asistencia actualizada correctamente',
          late_minutes:
            metrics.late_minutes,
          worked_minutes:
            metrics.worked_minutes,
          scheduled_minutes:
            metrics.scheduled_minutes,
          overtime_minutes:
            metrics.overtime_minutes,
          punctuality:
            metrics.punctuality,
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

  app.use(
    '/api/employee-attendance',
    attendanceRouter,
  );


  const validPayrollStatuses = new Set([
    'GENERATED',
    'PAID',
    'CANCELLED',
  ]);

  const normalizeMoney = (
    value,
    label,
    { allowZero = false } = {},
  ) => {
    const raw = String(value ?? '').trim();

    if (!raw) {
      throw new BadRequestException(
        `${label} es obligatorio`,
      );
    }

    const normalizedRaw = raw.replace(',', '.');
    const amount = Number(normalizedRaw);

    if (!Number.isFinite(amount)) {
      throw new BadRequestException(
        `${label} debe ser un monto válido`,
      );
    }

    if (
      (allowZero && amount < 0) ||
      (!allowZero && amount <= 0)
    ) {
      throw new BadRequestException(
        allowZero
          ? `${label} no puede ser negativo`
          : `${label} debe ser mayor a 0`,
      );
    }

    if (amount > 99999999.99) {
      throw new BadRequestException(
        `${label} supera el monto máximo permitido`,
      );
    }

    return Math.round(
      (amount + Number.EPSILON) * 100,
    ) / 100;
  };

  const normalizePayrollMonth = (value) => {
    const month = Number(value);

    if (
      !Number.isInteger(month) ||
      month < 1 ||
      month > 12
    ) {
      throw new BadRequestException(
        'El mes de la planilla debe estar entre 1 y 12',
      );
    }

    return month;
  };

  const normalizePayrollYear = (value) => {
    const year = Number(value);
    const currentYear =
      new Date().getFullYear();

    if (
      !Number.isInteger(year) ||
      year < 2000 ||
      year > currentYear
    ) {
      throw new BadRequestException(
        `El año de la planilla debe estar entre 2000 y ${currentYear}`,
      );
    }

    return year;
  };

  const validatePayrollPeriod = (
    monthValue,
    yearValue,
  ) => {
    const month =
      normalizePayrollMonth(monthValue);
    const year =
      normalizePayrollYear(yearValue);

    const now = new Date();
    const currentKey =
      now.getFullYear() * 100 +
      (now.getMonth() + 1);
    const requestedKey =
      year * 100 + month;

    if (requestedKey > currentKey) {
      throw new BadRequestException(
        'No se puede generar una planilla para un periodo futuro',
      );
    }

    return {
      month,
      year,
    };
  };

  const getMonthStartDate = (
    year,
    month,
  ) => {
    return [
      year,
      String(month).padStart(2, '0'),
      '01',
    ].join('-');
  };

  const getMonthEndDate = (
    year,
    month,
  ) => {
    const date = new Date(
      Date.UTC(year, month, 0),
    );

    return [
      date.getUTCFullYear(),
      String(
        date.getUTCMonth() + 1,
      ).padStart(2, '0'),
      String(
        date.getUTCDate(),
      ).padStart(2, '0'),
    ].join('-');
  };

  const getDaysInMonth = (
    year,
    month,
  ) =>
    new Date(
      Date.UTC(year, month, 0),
    ).getUTCDate();

  const addDaysToDate = (
    dateValue,
    days,
  ) => {
    const normalized =
      normalizeDate(
        dateValue,
        'La fecha',
      );

    const [year, month, day] =
      normalized.split('-').map(Number);

    const date = new Date(
      Date.UTC(
        year,
        month - 1,
        day,
      ),
    );

    date.setUTCDate(
      date.getUTCDate() + days,
    );

    return [
      date.getUTCFullYear(),
      String(
        date.getUTCMonth() + 1,
      ).padStart(2, '0'),
      String(
        date.getUTCDate(),
      ).padStart(2, '0'),
    ].join('-');
  };

  const countDaysInclusive = (
    startDate,
    endDate,
  ) => {
    const start =
      normalizeDate(
        startDate,
        'La fecha inicial',
      );

    const end =
      normalizeDate(
        endDate,
        'La fecha final',
      );

    if (end < start) {
      return 0;
    }

    const [startYear, startMonth, startDay] =
      start.split('-').map(Number);

    const [endYear, endMonth, endDay] =
      end.split('-').map(Number);

    const startUtc = Date.UTC(
      startYear,
      startMonth - 1,
      startDay,
    );

    const endUtc = Date.UTC(
      endYear,
      endMonth - 1,
      endDay,
    );

    return (
      Math.floor(
        (endUtc - startUtc) /
          86400000,
      ) + 1
    );
  };

  const roundMoney = (value) =>
    Math.round(
      (Number(value) +
        Number.EPSILON) *
        100,
    ) / 100;

  const buildPayrollCalculation = ({
    employee,
    salaries,
    periodStart,
    periodEnd,
    daysInMonth,
  }) => {
    const hireDate =
      normalizeDate(
        String(
          employee.hire_date,
        ).slice(0, 10),
        'La fecha de contratación',
      );

    const payableStart =
      hireDate > periodStart
        ? hireDate
        : periodStart;

    const salaryHistory = [
      ...salaries,
    ]
      .map((salary) => ({
        ...salary,
        effective_date:
          String(
            salary.effective_date,
          ).slice(0, 10),
        base_salary:
          normalizeMoney(
            salary.base_salary,
            'El salario base',
          ),
      }))
      .filter(
        (salary) =>
          salary.effective_date <=
          periodEnd,
      )
      .sort((a, b) => {
        if (
          a.effective_date !==
          b.effective_date
        ) {
          return a.effective_date.localeCompare(
            b.effective_date,
          );
        }

        return (
          Number(a.id_salary) -
          Number(b.id_salary)
        );
      });

    const salaryAtStart =
      [...salaryHistory]
        .reverse()
        .find(
          (salary) =>
            salary.effective_date <=
            payableStart,
        );

    if (!salaryAtStart) {
      return {
        error:
          'NO_SALARY_AT_PERIOD_START',
      };
    }

    const relevantChanges =
      salaryHistory.filter(
        (salary) =>
          salary.effective_date >
            payableStart &&
          salary.effective_date <=
            periodEnd,
      );

    const segments = [
      {
        ...salaryAtStart,
        segment_start:
          payableStart,
      },
      ...relevantChanges.map(
        (salary) => ({
          ...salary,
          segment_start:
            salary.effective_date,
        }),
      ),
    ];

    let proratedBase = 0;

    for (
      let index = 0;
      index < segments.length;
      index += 1
    ) {
      const current =
        segments[index];

      const next =
        segments[index + 1];

      const segmentEnd =
        next
          ? addDaysToDate(
              next.segment_start,
              -1,
            )
          : periodEnd;

      const segmentDays =
        countDaysInclusive(
          current.segment_start,
          segmentEnd,
        );

      if (segmentDays <= 0) {
        continue;
      }

      proratedBase +=
        (
          current.base_salary *
          segmentDays
        ) / daysInMonth;
    }

    const referenceSalary =
      salaryHistory[
        salaryHistory.length - 1
      ];

    return {
      id_employee:
        employee.id_employee,
      first_name:
        employee.first_name,
      last_name:
        employee.last_name,
      hire_date:
        hireDate,
      id_salary:
        referenceSalary.id_salary,
      salary_status:
        referenceSalary.status,
      salary_effective_date:
        referenceSalary.effective_date,
      base_salary:
        roundMoney(proratedBase),
      payable_start:
        payableStart,
      payable_end:
        periodEnd,
      payable_days:
        countDaysInclusive(
          payableStart,
          periodEnd,
        ),
      salary_segments:
        segments.length,
    };
  };

  const normalizePayrollStatus = (
    value,
    defaultValue = 'GENERATED',
  ) => {
    const status = String(
      value || defaultValue,
    )
      .trim()
      .toUpperCase();

    if (
      !validPayrollStatuses.has(status)
    ) {
      throw new BadRequestException(
        'Estado de planilla inválido',
      );
    }

    return status;
  };

  const withTransaction = async (
    handler,
  ) => {
    if (
      typeof db.getConnection !==
      'function'
    ) {
      return handler(db);
    }

    const connection =
      await db.getConnection();

    try {
      await connection.beginTransaction();

      const result =
        await handler(connection);

      await connection.commit();

      return result;
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
      }

      throw error;
    } finally {
      if (
        typeof connection.release ===
        'function'
      ) {
        connection.release();
      }
    }
  };

  const getSalaryById = async (
    idSalary,
    executor = db,
  ) => {
    const [rows] =
      await executor.query(
        `
          SELECT
            s.id_salary,
            s.id_employee,
            s.base_salary,
            s.effective_date,
            s.status,
            s.creationDate,
            CONCAT(
              e.first_name,
              ' ',
              e.last_name
            ) AS employee_name,
            e.status AS employee_status,
            e.hire_date,
            p.name AS position_name
          FROM salaries s
          INNER JOIN employees e
            ON s.id_employee = e.id_employee
          LEFT JOIN positions p
            ON e.id_position = p.id_position
          WHERE s.id_salary = ?
          LIMIT 1
        `,
        [idSalary],
      );

    return rows[0] || null;
  };

  const getPayrollById = async (
    idPayroll,
    executor = db,
  ) => {
    const [rows] =
      await executor.query(
        `
          SELECT
            py.id_payroll,
            py.payroll_month,
            py.payroll_year,
            py.payment_date,
            py.status,
            py.creationDate,
            COUNT(
              CASE
                WHEN pd.status = 'ACTIVE'
                THEN pd.id_payroll_detail
                ELSE NULL
              END
            ) AS employee_count,
            COALESCE(
              SUM(
                CASE
                  WHEN pd.status = 'ACTIVE'
                  THEN pd.base_salary
                  ELSE 0
                END
              ),
              0
            ) AS total_base_salary,
            COALESCE(
              SUM(
                CASE
                  WHEN pd.status = 'ACTIVE'
                  THEN pd.net_salary
                  ELSE 0
                END
              ),
              0
            ) AS total_net_salary
          FROM payrolls py
          LEFT JOIN payroll_details pd
            ON py.id_payroll =
              pd.id_payroll
          WHERE py.id_payroll = ?
          GROUP BY
            py.id_payroll,
            py.payroll_month,
            py.payroll_year,
            py.payment_date,
            py.status,
            py.creationDate
          LIMIT 1
        `,
        [idPayroll],
      );

    return rows[0] || null;
  };

  const getPayrollDetailById = async (
    idPayrollDetail,
    executor = db,
  ) => {
    const [rows] =
      await executor.query(
        `
          SELECT
            pd.id_payroll_detail,
            pd.id_payroll,
            pd.id_employee,
            pd.id_salary,
            pd.base_salary,
            pd.net_salary,
            pd.status,
            pd.creationDate,
            py.payroll_month,
            py.payroll_year,
            py.payment_date,
            py.status AS payroll_status,
            CONCAT(
              e.first_name,
              ' ',
              e.last_name
            ) AS employee_name,
            e.status AS employee_status,
            p.name AS position_name,
            s.effective_date AS salary_effective_date
          FROM payroll_details pd
          INNER JOIN payrolls py
            ON pd.id_payroll =
              py.id_payroll
          INNER JOIN employees e
            ON pd.id_employee =
              e.id_employee
          LEFT JOIN positions p
            ON e.id_position =
              p.id_position
          INNER JOIN salaries s
            ON pd.id_salary =
              s.id_salary
          WHERE pd.id_payroll_detail = ?
          LIMIT 1
        `,
        [idPayrollDetail],
      );

    return rows[0] || null;
  };

  const ensureSalaryDateUnique =
    async ({
      idEmployee,
      effectiveDate,
      excludeSalaryId = null,
      executor = db,
    }) => {
      let sql = `
        SELECT id_salary
        FROM salaries
        WHERE id_employee = ?
          AND effective_date = ?
      `;

      const params = [
        idEmployee,
        effectiveDate,
      ];

      if (excludeSalaryId) {
        sql +=
          ' AND id_salary <> ?';
        params.push(excludeSalaryId);
      }

      sql += ' LIMIT 1';

      const [rows] =
        await executor.query(
          sql,
          params,
        );

      if (rows.length) {
        throw new BadRequestException(
          'Ya existe un salario para este empleado con la misma fecha de vigencia',
        );
      }
    };

  const ensureSalaryCanBeActive =
    async ({
      idEmployee,
      effectiveDate,
      excludeSalaryId = null,
      executor = db,
    }) => {
      let sql = `
        SELECT
          id_salary,
          effective_date
        FROM salaries
        WHERE id_employee = ?
      `;

      const params = [idEmployee];

      if (excludeSalaryId) {
        sql +=
          ' AND id_salary <> ?';
        params.push(excludeSalaryId);
      }

      sql += `
        ORDER BY
          effective_date DESC,
          id_salary DESC
        LIMIT 1
      `;

      const [rows] =
        await executor.query(
          sql,
          params,
        );

      const latest = rows[0];

      if (
        latest &&
        String(
          latest.effective_date,
        ).slice(0, 10) >
          effectiveDate
      ) {
        throw new BadRequestException(
          'No se puede activar un salario con una fecha anterior a un salario más reciente',
        );
      }
    };

  const salariesRouter =
    express.Router();

  salariesRouter.get(
    '/',
    async (req, res, next) => {
      try {
        const conditions = [];
        const params = [];

        if (req.query.id_employee) {
          const idEmployee =
            requirePositiveInteger(
              req.query.id_employee,
              'El id del empleado',
            );

          conditions.push(
            's.id_employee = ?',
          );
          params.push(idEmployee);
        }

        const status = String(
          req.query.status || '',
        )
          .trim()
          .toUpperCase();

        if (status) {
          if (
            !validStatuses.has(status)
          ) {
            throw new BadRequestException(
              'Estado de salario inválido',
            );
          }

          conditions.push(
            's.status = ?',
          );
          params.push(status);
        }

        if (
          req.query.effective_from
        ) {
          const effectiveFrom =
            normalizeDate(
              req.query.effective_from,
              'La fecha inicial',
            );

          conditions.push(
            's.effective_date >= ?',
          );
          params.push(effectiveFrom);
        }

        if (
          req.query.effective_to
        ) {
          const effectiveTo =
            normalizeDate(
              req.query.effective_to,
              'La fecha final',
            );

          conditions.push(
            's.effective_date <= ?',
          );
          params.push(effectiveTo);
        }

        const search =
          normalizeText(
            req.query.search || '',
            100,
          );

        if (search) {
          conditions.push(`
            (
              CONCAT(
                e.first_name,
                ' ',
                e.last_name
              ) LIKE ?
              OR p.name LIKE ?
            )
          `);

          const term = `%${search}%`;

          params.push(
            term,
            term,
          );
        }

        let sql = `
          SELECT
            s.id_salary,
            s.id_employee,
            s.base_salary,
            s.effective_date,
            s.status,
            s.creationDate,
            CONCAT(
              e.first_name,
              ' ',
              e.last_name
            ) AS employee_name,
            e.status AS employee_status,
            p.name AS position_name
          FROM salaries s
          INNER JOIN employees e
            ON s.id_employee =
              e.id_employee
          LEFT JOIN positions p
            ON e.id_position =
              p.id_position
        `;

        if (conditions.length) {
          sql += ` WHERE ${conditions.join(
            ' AND ',
          )}`;
        }

        sql += `
          ORDER BY
            s.effective_date DESC,
            s.id_salary DESC
        `;

        const [rows] =
          await db.query(
            sql,
            params,
          );

        return res
          .status(200)
          .json(rows);
      } catch (error) {
        if (
          isMissingTableError(error)
        ) {
          return next(
            new BadRequestException(
              'La tabla de salarios aún no existe en la base de datos.',
            ),
          );
        }

        return next(error);
      }
    },
  );

  salariesRouter.get(
    '/employee/:id/current',
    async (req, res, next) => {
      try {
        const idEmployee =
          requirePositiveInteger(
            req.params.id,
            'El id del empleado',
          );

        const employee =
          await getEmployeeById(
            idEmployee,
          );

        if (!employee) {
          throw new NotFoundException(
            'Empleado no encontrado',
          );
        }

        const [rows] =
          await db.query(
            `
              SELECT
                s.id_salary,
                s.id_employee,
                s.base_salary,
                s.effective_date,
                s.status,
                s.creationDate,
                CONCAT(
                  e.first_name,
                  ' ',
                  e.last_name
                ) AS employee_name,
                p.name AS position_name
              FROM salaries s
              INNER JOIN employees e
                ON s.id_employee =
                  e.id_employee
              LEFT JOIN positions p
                ON e.id_position =
                  p.id_position
              WHERE s.id_employee = ?
                AND s.status = 'ACTIVE'
                AND s.effective_date <= CURDATE()
              ORDER BY
                s.effective_date DESC,
                s.id_salary DESC
              LIMIT 1
            `,
            [idEmployee],
          );

        return res
          .status(200)
          .json(rows[0] || null);
      } catch (error) {
        if (
          isMissingTableError(error)
        ) {
          return next(
            new BadRequestException(
              'La tabla de salarios aún no existe en la base de datos.',
            ),
          );
        }

        return next(error);
      }
    },
  );

  salariesRouter.get(
    '/employee/:id',
    async (req, res, next) => {
      try {
        const idEmployee =
          requirePositiveInteger(
            req.params.id,
            'El id del empleado',
          );

        const employee =
          await getEmployeeById(
            idEmployee,
          );

        if (!employee) {
          throw new NotFoundException(
            'Empleado no encontrado',
          );
        }

        const [rows] =
          await db.query(
            `
              SELECT
                s.id_salary,
                s.id_employee,
                s.base_salary,
                s.effective_date,
                s.status,
                s.creationDate,
                CONCAT(
                  e.first_name,
                  ' ',
                  e.last_name
                ) AS employee_name,
                p.name AS position_name
              FROM salaries s
              INNER JOIN employees e
                ON s.id_employee =
                  e.id_employee
              LEFT JOIN positions p
                ON e.id_position =
                  p.id_position
              WHERE s.id_employee = ?
              ORDER BY
                s.effective_date DESC,
                s.id_salary DESC
            `,
            [idEmployee],
          );

        return res
          .status(200)
          .json(rows);
      } catch (error) {
        if (
          isMissingTableError(error)
        ) {
          return next(
            new BadRequestException(
              'La tabla de salarios aún no existe en la base de datos.',
            ),
          );
        }

        return next(error);
      }
    },
  );

  salariesRouter.get(
    '/:id',
    async (req, res, next) => {
      try {
        const idSalary =
          requirePositiveInteger(
            req.params.id,
            'El id del salario',
          );

        const salary =
          await getSalaryById(
            idSalary,
          );

        if (!salary) {
          throw new NotFoundException(
            'Salario no encontrado',
          );
        }

        return res
          .status(200)
          .json(salary);
      } catch (error) {
        if (
          isMissingTableError(error)
        ) {
          return next(
            new BadRequestException(
              'La tabla de salarios aún no existe en la base de datos.',
            ),
          );
        }

        return next(error);
      }
    },
  );

  salariesRouter.post(
    '/',
    async (req, res, next) => {
      try {
        const idEmployee =
          requirePositiveInteger(
            req.body?.id_employee,
            'El id del empleado',
          );

        const baseSalary =
          normalizeMoney(
            req.body?.base_salary,
            'El salario base',
          );

        const effectiveDate =
          normalizeDate(
            req.body?.effective_date,
            'La fecha de vigencia',
            { allowFuture: false },
          );

        const status =
          validateStatus(
            req.body?.status,
            'salario',
          );

        const employee =
          await getEmployeeById(
            idEmployee,
          );

        if (!employee) {
          throw new NotFoundException(
            'Empleado no encontrado',
          );
        }

        if (
          employee.hire_date &&
          String(
            employee.hire_date,
          ).slice(0, 10) >
            effectiveDate
        ) {
          throw new BadRequestException(
            'La fecha de vigencia del salario no puede ser anterior a la fecha de contratación',
          );
        }

        if (
          status === 'ACTIVE' &&
          String(
            employee.status,
          ).toUpperCase() !==
            'ACTIVE'
        ) {
          throw new BadRequestException(
            'No se puede asignar un salario activo a un empleado inactivo',
          );
        }

        await ensureSalaryDateUnique({
          idEmployee,
          effectiveDate,
        });

        if (status === 'ACTIVE') {
          await ensureSalaryCanBeActive({
            idEmployee,
            effectiveDate,
          });
        }

        const result =
          await withTransaction(
            async (executor) => {
              if (
                status === 'ACTIVE'
              ) {
                await executor.query(
                  `
                    UPDATE salaries
                    SET status = 'INACTIVE'
                    WHERE id_employee = ?
                      AND status = 'ACTIVE'
                  `,
                  [idEmployee],
                );
              }

              const [insertResult] =
                await executor.query(
                  `
                    INSERT INTO salaries
                    (
                      id_employee,
                      base_salary,
                      effective_date,
                      status
                    )
                    VALUES (?, ?, ?, ?)
                  `,
                  [
                    idEmployee,
                    baseSalary,
                    effectiveDate,
                    status,
                  ],
                );

              return insertResult;
            },
          );

        return res
          .status(201)
          .json({
            message:
              'Salario registrado correctamente',
            id_salary:
              result.insertId,
          });
      } catch (error) {
        if (
          isMissingTableError(error)
        ) {
          return next(
            new BadRequestException(
              'La tabla de salarios aún no existe en la base de datos.',
            ),
          );
        }

        return next(error);
      }
    },
  );

  salariesRouter.put(
    '/:id',
    async (req, res, next) => {
      try {
        const idSalary =
          requirePositiveInteger(
            req.params.id,
            'El id del salario',
          );

        const current =
          await getSalaryById(
            idSalary,
          );

        if (!current) {
          throw new NotFoundException(
            'Salario no encontrado',
          );
        }

        const idEmployee =
          requirePositiveInteger(
            req.body?.id_employee ??
              current.id_employee,
            'El id del empleado',
          );

        const baseSalary =
          normalizeMoney(
            req.body?.base_salary ??
              current.base_salary,
            'El salario base',
          );

        const effectiveDate =
          normalizeDate(
            req.body
              ?.effective_date ??
              String(
                current.effective_date,
              ).slice(0, 10),
            'La fecha de vigencia',
            { allowFuture: false },
          );

        const status =
          validateStatus(
            req.body?.status,
            'salario',
            current.status,
          );

        const employee =
          await getEmployeeById(
            idEmployee,
          );

        if (!employee) {
          throw new NotFoundException(
            'Empleado no encontrado',
          );
        }

        if (
          employee.hire_date &&
          String(
            employee.hire_date,
          ).slice(0, 10) >
            effectiveDate
        ) {
          throw new BadRequestException(
            'La fecha de vigencia del salario no puede ser anterior a la fecha de contratación',
          );
        }

        if (
          status === 'ACTIVE' &&
          String(
            employee.status,
          ).toUpperCase() !==
            'ACTIVE'
        ) {
          throw new BadRequestException(
            'No se puede activar un salario de un empleado inactivo',
          );
        }

        const [detailRows] =
          await db.query(
            `
              SELECT COUNT(*) AS total
              FROM payroll_details
              WHERE id_salary = ?
            `,
            [idSalary],
          );

        const usedInPayroll =
          Number(
            detailRows[0]?.total ||
              0,
          ) > 0;

        if (
          usedInPayroll &&
          (
            Number(idEmployee) !==
              Number(
                current.id_employee,
              ) ||
            effectiveDate !==
              String(
                current.effective_date,
              ).slice(0, 10)
          )
        ) {
          throw new BadRequestException(
            'No se puede cambiar el empleado ni la fecha de un salario que ya fue usado en una planilla',
          );
        }

        await ensureSalaryDateUnique({
          idEmployee,
          effectiveDate,
          excludeSalaryId:
            idSalary,
        });

        if (status === 'ACTIVE') {
          await ensureSalaryCanBeActive({
            idEmployee,
            effectiveDate,
            excludeSalaryId:
              idSalary,
          });
        }

        await withTransaction(
          async (executor) => {
            if (
              status === 'ACTIVE'
            ) {
              await executor.query(
                `
                  UPDATE salaries
                  SET status = 'INACTIVE'
                  WHERE id_employee = ?
                    AND id_salary <> ?
                    AND status = 'ACTIVE'
                `,
                [
                  idEmployee,
                  idSalary,
                ],
              );
            }

            await executor.query(
              `
                UPDATE salaries
                SET
                  id_employee = ?,
                  base_salary = ?,
                  effective_date = ?,
                  status = ?
                WHERE id_salary = ?
              `,
              [
                idEmployee,
                baseSalary,
                effectiveDate,
                status,
                idSalary,
              ],
            );
          },
        );

        return res
          .status(200)
          .json({
            message:
              'Salario actualizado correctamente',
          });
      } catch (error) {
        if (
          isMissingTableError(error)
        ) {
          return next(
            new BadRequestException(
              'No se pudo actualizar el salario porque faltan las tablas de salarios o planillas en la base de datos.',
            ),
          );
        }

        return next(error);
      }
    },
  );

  salariesRouter.patch(
    '/:id/status',
    async (req, res, next) => {
      try {
        const idSalary =
          requirePositiveInteger(
            req.params.id,
            'El id del salario',
          );

        const current =
          await getSalaryById(
            idSalary,
          );

        if (!current) {
          throw new NotFoundException(
            'Salario no encontrado',
          );
        }

        const nextStatus =
          validateStatus(
            req.body?.status,
            'salario',
          );

        if (
          nextStatus === 'ACTIVE'
        ) {
          if (
            String(
              current.employee_status,
            ).toUpperCase() !==
              'ACTIVE'
          ) {
            throw new BadRequestException(
              'No se puede activar el salario porque el empleado está inactivo',
            );
          }

          await ensureSalaryCanBeActive({
            idEmployee:
              current.id_employee,
            effectiveDate:
              String(
                current.effective_date,
              ).slice(0, 10),
            excludeSalaryId:
              idSalary,
          });
        }

        await withTransaction(
          async (executor) => {
            if (
              nextStatus === 'ACTIVE'
            ) {
              await executor.query(
                `
                  UPDATE salaries
                  SET status = 'INACTIVE'
                  WHERE id_employee = ?
                    AND id_salary <> ?
                    AND status = 'ACTIVE'
                `,
                [
                  current.id_employee,
                  idSalary,
                ],
              );
            }

            await executor.query(
              `
                UPDATE salaries
                SET status = ?
                WHERE id_salary = ?
              `,
              [
                nextStatus,
                idSalary,
              ],
            );
          },
        );

        return res
          .status(200)
          .json({
            message:
              'Estado del salario actualizado correctamente',
            status: nextStatus,
          });
      } catch (error) {
        if (
          isMissingTableError(error)
        ) {
          return next(
            new BadRequestException(
              'La tabla de salarios aún no existe en la base de datos.',
            ),
          );
        }

        return next(error);
      }
    },
  );

  app.use(
    '/api/salaries',
    salariesRouter,
  );

  const payrollsRouter =
    express.Router();

  payrollsRouter.get(
    '/',
    async (req, res, next) => {
      try {
        const conditions = [];
        const params = [];

        if (req.query.month) {
          const month =
            normalizePayrollMonth(
              req.query.month,
            );

          conditions.push(
            'py.payroll_month = ?',
          );
          params.push(month);
        }

        if (req.query.year) {
          const year =
            normalizePayrollYear(
              req.query.year,
            );

          conditions.push(
            'py.payroll_year = ?',
          );
          params.push(year);
        }

        const status = String(
          req.query.status || '',
        )
          .trim()
          .toUpperCase();

        if (status) {
          if (
            !validPayrollStatuses.has(
              status,
            )
          ) {
            throw new BadRequestException(
              'Estado de planilla inválido',
            );
          }

          conditions.push(
            'py.status = ?',
          );
          params.push(status);
        }

        let sql = `
          SELECT
            py.id_payroll,
            py.payroll_month,
            py.payroll_year,
            py.payment_date,
            py.status,
            py.creationDate,
            COUNT(
              CASE
                WHEN pd.status = 'ACTIVE'
                THEN pd.id_payroll_detail
                ELSE NULL
              END
            ) AS employee_count,
            COALESCE(
              SUM(
                CASE
                  WHEN pd.status = 'ACTIVE'
                  THEN pd.base_salary
                  ELSE 0
                END
              ),
              0
            ) AS total_base_salary,
            COALESCE(
              SUM(
                CASE
                  WHEN pd.status = 'ACTIVE'
                  THEN pd.net_salary
                  ELSE 0
                END
              ),
              0
            ) AS total_net_salary
          FROM payrolls py
          LEFT JOIN payroll_details pd
            ON py.id_payroll =
              pd.id_payroll
        `;

        if (conditions.length) {
          sql += ` WHERE ${conditions.join(
            ' AND ',
          )}`;
        }

        sql += `
          GROUP BY
            py.id_payroll,
            py.payroll_month,
            py.payroll_year,
            py.payment_date,
            py.status,
            py.creationDate
          ORDER BY
            py.payroll_year DESC,
            py.payroll_month DESC,
            py.id_payroll DESC
        `;

        const [rows] =
          await db.query(
            sql,
            params,
          );

        return res
          .status(200)
          .json(rows);
      } catch (error) {
        if (
          isMissingTableError(error)
        ) {
          return next(
            new BadRequestException(
              'Las tablas de planillas aún no existen en la base de datos.',
            ),
          );
        }

        return next(error);
      }
    },
  );

  payrollsRouter.get(
    '/:id',
    async (req, res, next) => {
      try {
        const idPayroll =
          requirePositiveInteger(
            req.params.id,
            'El id de la planilla',
          );

        const payroll =
          await getPayrollById(
            idPayroll,
          );

        if (!payroll) {
          throw new NotFoundException(
            'Planilla no encontrada',
          );
        }

        const [details] =
          await db.query(
            `
              SELECT
                pd.id_payroll_detail,
                pd.id_payroll,
                pd.id_employee,
                pd.id_salary,
                pd.base_salary,
                pd.net_salary,
                pd.status,
                CONCAT(
                  e.first_name,
                  ' ',
                  e.last_name
                ) AS employee_name,
                e.status AS employee_status,
                p.name AS position_name,
                s.effective_date AS salary_effective_date
              FROM payroll_details pd
              INNER JOIN employees e
                ON pd.id_employee =
                  e.id_employee
              LEFT JOIN positions p
                ON e.id_position =
                  p.id_position
              INNER JOIN salaries s
                ON pd.id_salary =
                  s.id_salary
              WHERE pd.id_payroll = ?
              ORDER BY
                employee_name ASC
            `,
            [idPayroll],
          );

        return res
          .status(200)
          .json({
            ...payroll,
            details,
          });
      } catch (error) {
        if (
          isMissingTableError(error)
        ) {
          return next(
            new BadRequestException(
              'Las tablas de planillas aún no existen en la base de datos.',
            ),
          );
        }

        return next(error);
      }
    },
  );

  payrollsRouter.post(
    '/',
    async (req, res, next) => {
      try {
        const {
          month,
          year,
        } = validatePayrollPeriod(
          req.body?.payroll_month,
          req.body?.payroll_year,
        );

        const periodStart =
          getMonthStartDate(
            year,
            month,
          );

        const periodEnd =
          getMonthEndDate(
            year,
            month,
          );

        const daysInMonth =
          getDaysInMonth(
            year,
            month,
          );

        const [existingRows] =
          await db.query(
            `
              SELECT
                id_payroll,
                status
              FROM payrolls
              WHERE payroll_month = ?
                AND payroll_year = ?
                AND status <> 'CANCELLED'
              LIMIT 1
            `,
            [
              month,
              year,
            ],
          );

        if (existingRows.length) {
          throw new BadRequestException(
            'Ya existe una planilla vigente para ese mes y año',
          );
        }

        /*
          Traemos todos los salarios históricos que
          podrían afectar el periodo.

          Esto permite calcular correctamente:
          - empleados contratados a mitad de mes;
          - cambios de salario dentro del mismo mes.

          No se crean nuevas tablas ni campos.
          payroll_details conserva un único registro
          por empleado con el monto base ya
          proporcional al periodo trabajado.
        */
        const [rawRows] =
          await db.query(
            `
              SELECT
                e.id_employee,
                e.first_name,
                e.last_name,
                e.hire_date,
                e.status AS employee_status,
                s.id_salary,
                s.base_salary,
                s.effective_date,
                s.status AS salary_status
              FROM employees e
              LEFT JOIN salaries s
                ON s.id_employee =
                  e.id_employee
                AND s.effective_date <= ?
              WHERE e.status = 'ACTIVE'
                AND e.hire_date <= ?
              ORDER BY
                e.first_name ASC,
                e.last_name ASC,
                e.id_employee ASC,
                s.effective_date ASC,
                s.id_salary ASC
            `,
            [
              periodEnd,
              periodEnd,
            ],
          );

        if (!rawRows.length) {
          throw new BadRequestException(
            'No hay empleados activos para generar la planilla de ese periodo',
          );
        }

        const employeesMap =
          new Map();

        for (const row of rawRows) {
          const key =
            Number(
              row.id_employee,
            );

          if (
            !employeesMap.has(key)
          ) {
            employeesMap.set(
              key,
              {
                employee: {
                  id_employee:
                    row.id_employee,
                  first_name:
                    row.first_name,
                  last_name:
                    row.last_name,
                  hire_date:
                    row.hire_date,
                  employee_status:
                    row.employee_status,
                },
                salaries: [],
              },
            );
          }

          if (row.id_salary) {
            employeesMap
              .get(key)
              .salaries.push({
                id_salary:
                  row.id_salary,
                base_salary:
                  row.base_salary,
                effective_date:
                  row.effective_date,
                status:
                  row.salary_status,
              });
          }
        }

        const payrollEmployees = [];
        const employeesWithoutSalary = [];

        for (
          const {
            employee,
            salaries,
          } of employeesMap.values()
        ) {
          const calculation =
            buildPayrollCalculation({
              employee,
              salaries,
              periodStart,
              periodEnd,
              daysInMonth,
            });

          if (
            calculation.error ===
            'NO_SALARY_AT_PERIOD_START'
          ) {
            employeesWithoutSalary.push(
              employee,
            );
            continue;
          }

          payrollEmployees.push(
            calculation,
          );
        }

        if (
          employeesWithoutSalary.length
        ) {
          const names =
            employeesWithoutSalary
              .slice(0, 5)
              .map(
                (employee) =>
                  `${employee.first_name} ${employee.last_name}`,
              )
              .join(', ');

          const extra =
            employeesWithoutSalary.length >
            5
              ? ` y ${
                  employeesWithoutSalary.length -
                  5
                } más`
              : '';

          throw new BadRequestException(
            `No se puede generar la planilla porque hay empleados sin un salario vigente desde el inicio de su periodo trabajado: ${names}${extra}`,
          );
        }

        if (
          !payrollEmployees.length
        ) {
          throw new BadRequestException(
            'No hay empleados con salario válido para generar la planilla de ese periodo',
          );
        }

        const now = new Date();
        const currentPeriodKey =
          now.getFullYear() * 100 +
          (now.getMonth() + 1);
        const requestedPeriodKey =
          year * 100 + month;

        /*
          Para la planilla del mes actual, el salario
          más reciente usado como referencia debe
          continuar activo.

          Los salarios anteriores pueden estar
          INACTIVE porque forman parte legítima del
          historial y se utilizan para prorratear
          periodos anteriores al cambio.
        */
        if (
          requestedPeriodKey ===
          currentPeriodKey
        ) {
          const withoutActiveSalary =
            payrollEmployees.filter(
              (employee) =>
                String(
                  employee.salary_status ||
                    '',
                ).toUpperCase() !==
                'ACTIVE',
            );

          if (
            withoutActiveSalary.length
          ) {
            const names =
              withoutActiveSalary
                .slice(0, 5)
                .map(
                  (employee) =>
                    `${employee.first_name} ${employee.last_name}`,
                )
                .join(', ');

            const extra =
              withoutActiveSalary.length >
              5
                ? ` y ${
                    withoutActiveSalary.length -
                    5
                  } más`
                : '';

            throw new BadRequestException(
              `No se puede generar la planilla actual porque hay empleados sin salario activo: ${names}${extra}`,
            );
          }
        }

        const invalidAmounts =
          payrollEmployees.filter(
            (employee) =>
              !Number.isFinite(
                Number(
                  employee.base_salary,
                ),
              ) ||
              Number(
                employee.base_salary,
              ) <= 0,
          );

        if (invalidAmounts.length) {
          const names =
            invalidAmounts
              .slice(0, 5)
              .map(
                (employee) =>
                  `${employee.first_name} ${employee.last_name}`,
              )
              .join(', ');

          throw new BadRequestException(
            `No se puede generar la planilla porque el cálculo proporcional produjo un monto inválido para: ${names}`,
          );
        }

        const result =
          await withTransaction(
            async (executor) => {
              const [payrollResult] =
                await executor.query(
                  `
                    INSERT INTO payrolls
                    (
                      payroll_month,
                      payroll_year,
                      payment_date,
                      status
                    )
                    VALUES (?, ?, NULL, 'GENERATED')
                  `,
                  [
                    month,
                    year,
                  ],
                );

              const idPayroll =
                payrollResult.insertId;

              for (
                const employee of
                payrollEmployees
              ) {
                const baseSalary =
                  normalizeMoney(
                    employee.base_salary,
                    'El salario base proporcional',
                  );

                await executor.query(
                  `
                    INSERT INTO payroll_details
                    (
                      id_payroll,
                      id_employee,
                      id_salary,
                      base_salary,
                      net_salary,
                      status
                    )
                    VALUES (?, ?, ?, ?, ?, 'ACTIVE')
                  `,
                  [
                    idPayroll,
                    employee.id_employee,
                    employee.id_salary,
                    baseSalary,
                    baseSalary,
                  ],
                );
              }

              return {
                idPayroll,
                employeeCount:
                  payrollEmployees.length,
              };
            },
          );

        const payroll =
          await getPayrollById(
            result.idPayroll,
          );

        const proratedEmployees =
          payrollEmployees.filter(
            (employee) =>
              employee.payable_days <
                daysInMonth ||
              employee.salary_segments >
                1,
          ).length;

        return res
          .status(201)
          .json({
            message:
              'Planilla generada correctamente',
            ...payroll,
            calculation: {
              period_start:
                periodStart,
              period_end:
                periodEnd,
              days_in_month:
                daysInMonth,
              employees_prorated:
                proratedEmployees,
            },
          });
      } catch (error) {
        if (
          isMissingTableError(error)
        ) {
          return next(
            new BadRequestException(
              'No se puede generar la planilla porque faltan las tablas salaries, payrolls o payroll_details.',
            ),
          );
        }

        return next(error);
      }
    },
  );

  payrollsRouter.patch(
    '/:id/status',
    async (req, res, next) => {
      try {
        const idPayroll =
          requirePositiveInteger(
            req.params.id,
            'El id de la planilla',
          );

        const current =
          await getPayrollById(
            idPayroll,
          );

        if (!current) {
          throw new NotFoundException(
            'Planilla no encontrada',
          );
        }

        const nextStatus =
          normalizePayrollStatus(
            req.body?.status,
          );

        const currentStatus =
          normalizePayrollStatus(
            current.status,
          );

        if (
          currentStatus === 'PAID' &&
          nextStatus !== 'PAID'
        ) {
          throw new BadRequestException(
            'Una planilla pagada no puede volver a otro estado',
          );
        }

        if (
          currentStatus ===
            'CANCELLED' &&
          nextStatus !== 'CANCELLED'
        ) {
          throw new BadRequestException(
            'Una planilla cancelada no puede reactivarse',
          );
        }

        let paymentDate =
          current.payment_date
            ? String(
                current.payment_date,
              ).slice(0, 10)
            : null;

        if (
          nextStatus === 'PAID'
        ) {
          const [detailRows] =
            await db.query(
              `
                SELECT
                  COUNT(*) AS total
                FROM payroll_details
                WHERE id_payroll = ?
                  AND status = 'ACTIVE'
              `,
              [idPayroll],
            );

          const activeDetails =
            Number(
              detailRows[0]?.total ||
                0,
            );

          if (activeDetails === 0) {
            throw new BadRequestException(
              'No se puede pagar una planilla sin detalles activos',
            );
          }

          paymentDate =
            req.body?.payment_date
              ? normalizeDate(
                  req.body.payment_date,
                  'La fecha de pago',
                  {
                    allowFuture:
                      false,
                  },
                )
              : todayDateString();
        }

        if (
          nextStatus ===
          'CANCELLED'
        ) {
          paymentDate = null;
        }

        await db.query(
          `
            UPDATE payrolls
            SET
              status = ?,
              payment_date = ?
            WHERE id_payroll = ?
          `,
          [
            nextStatus,
            paymentDate,
            idPayroll,
          ],
        );

        return res
          .status(200)
          .json({
            message:
              nextStatus === 'PAID'
                ? 'Planilla marcada como pagada correctamente'
                : nextStatus ===
                    'CANCELLED'
                  ? 'Planilla cancelada correctamente'
                  : 'Estado de planilla actualizado correctamente',
            status: nextStatus,
            payment_date:
              paymentDate,
          });
      } catch (error) {
        if (
          isMissingTableError(error)
        ) {
          return next(
            new BadRequestException(
              'Las tablas de planillas aún no existen en la base de datos.',
            ),
          );
        }

        return next(error);
      }
    },
  );

  app.use(
    '/api/payrolls',
    payrollsRouter,
  );

  const payrollDetailsRouter =
    express.Router();

  payrollDetailsRouter.get(
    '/',
    async (req, res, next) => {
      try {
        const conditions = [];
        const params = [];

        if (req.query.id_payroll) {
          const idPayroll =
            requirePositiveInteger(
              req.query.id_payroll,
              'El id de la planilla',
            );

          conditions.push(
            'pd.id_payroll = ?',
          );
          params.push(idPayroll);
        }

        if (req.query.id_employee) {
          const idEmployee =
            requirePositiveInteger(
              req.query.id_employee,
              'El id del empleado',
            );

          conditions.push(
            'pd.id_employee = ?',
          );
          params.push(idEmployee);
        }

        const status = String(
          req.query.status || '',
        )
          .trim()
          .toUpperCase();

        if (status) {
          if (
            !validStatuses.has(status)
          ) {
            throw new BadRequestException(
              'Estado de detalle de planilla inválido',
            );
          }

          conditions.push(
            'pd.status = ?',
          );
          params.push(status);
        }

        let sql = `
          SELECT
            pd.id_payroll_detail,
            pd.id_payroll,
            pd.id_employee,
            pd.id_salary,
            pd.base_salary,
            pd.net_salary,
            pd.status,
            pd.creationDate,
            py.payroll_month,
            py.payroll_year,
            py.payment_date,
            py.status AS payroll_status,
            CONCAT(
              e.first_name,
              ' ',
              e.last_name
            ) AS employee_name,
            e.status AS employee_status,
            p.name AS position_name,
            s.effective_date AS salary_effective_date
          FROM payroll_details pd
          INNER JOIN payrolls py
            ON pd.id_payroll =
              py.id_payroll
          INNER JOIN employees e
            ON pd.id_employee =
              e.id_employee
          LEFT JOIN positions p
            ON e.id_position =
              p.id_position
          INNER JOIN salaries s
            ON pd.id_salary =
              s.id_salary
        `;

        if (conditions.length) {
          sql += ` WHERE ${conditions.join(
            ' AND ',
          )}`;
        }

        sql += `
          ORDER BY
            py.payroll_year DESC,
            py.payroll_month DESC,
            employee_name ASC
        `;

        const [rows] =
          await db.query(
            sql,
            params,
          );

        return res
          .status(200)
          .json(rows);
      } catch (error) {
        if (
          isMissingTableError(error)
        ) {
          return next(
            new BadRequestException(
              'La tabla de detalles de planilla aún no existe en la base de datos.',
            ),
          );
        }

        return next(error);
      }
    },
  );

  payrollDetailsRouter.get(
    '/:id',
    async (req, res, next) => {
      try {
        const idPayrollDetail =
          requirePositiveInteger(
            req.params.id,
            'El id del detalle de planilla',
          );

        const detail =
          await getPayrollDetailById(
            idPayrollDetail,
          );

        if (!detail) {
          throw new NotFoundException(
            'Detalle de planilla no encontrado',
          );
        }

        return res
          .status(200)
          .json(detail);
      } catch (error) {
        if (
          isMissingTableError(error)
        ) {
          return next(
            new BadRequestException(
              'La tabla de detalles de planilla aún no existe en la base de datos.',
            ),
          );
        }

        return next(error);
      }
    },
  );

  payrollDetailsRouter.patch(
    '/:id/net-salary',
    async (req, res, next) => {
      try {
        const idPayrollDetail =
          requirePositiveInteger(
            req.params.id,
            'El id del detalle de planilla',
          );

        const detail =
          await getPayrollDetailById(
            idPayrollDetail,
          );

        if (!detail) {
          throw new NotFoundException(
            'Detalle de planilla no encontrado',
          );
        }

        if (
          String(
            detail.payroll_status,
          ).toUpperCase() !==
            'GENERATED'
        ) {
          throw new BadRequestException(
            'Solo se puede ajustar el salario neto mientras la planilla está generada y pendiente de pago',
          );
        }

        const netSalary =
          normalizeMoney(
            req.body?.net_salary,
            'El salario neto',
            { allowZero: true },
          );

        await db.query(
          `
            UPDATE payroll_details
            SET net_salary = ?
            WHERE id_payroll_detail = ?
          `,
          [
            netSalary,
            idPayrollDetail,
          ],
        );

        return res
          .status(200)
          .json({
            message:
              'Salario neto actualizado correctamente',
            net_salary:
              netSalary,
          });
      } catch (error) {
        if (
          isMissingTableError(error)
        ) {
          return next(
            new BadRequestException(
              'La tabla de detalles de planilla aún no existe en la base de datos.',
            ),
          );
        }

        return next(error);
      }
    },
  );

  payrollDetailsRouter.patch(
    '/:id/status',
    async (req, res, next) => {
      try {
        const idPayrollDetail =
          requirePositiveInteger(
            req.params.id,
            'El id del detalle de planilla',
          );

        const detail =
          await getPayrollDetailById(
            idPayrollDetail,
          );

        if (!detail) {
          throw new NotFoundException(
            'Detalle de planilla no encontrado',
          );
        }

        if (
          String(
            detail.payroll_status,
          ).toUpperCase() !==
            'GENERATED'
        ) {
          throw new BadRequestException(
            'No se puede modificar el detalle de una planilla pagada o cancelada',
          );
        }

        const nextStatus =
          validateStatus(
            req.body?.status,
            'detalle de planilla',
          );

        await db.query(
          `
            UPDATE payroll_details
            SET status = ?
            WHERE id_payroll_detail = ?
          `,
          [
            nextStatus,
            idPayrollDetail,
          ],
        );

        return res
          .status(200)
          .json({
            message:
              'Estado del detalle actualizado correctamente',
            status: nextStatus,
          });
      } catch (error) {
        if (
          isMissingTableError(error)
        ) {
          return next(
            new BadRequestException(
              'La tabla de detalles de planilla aún no existe en la base de datos.',
            ),
          );
        }

        return next(error);
      }
    },
  );

  app.use(
    '/api/payroll-details',
    payrollDetailsRouter,
  );

  const hrRouter = express.Router();

  hrRouter.get(
    '/dashboard',
    async (req, res, next) => {
      try {
        const [
          [employeeRows],
          [positionRows],
        ] = await Promise.all([
          db.query(`
            SELECT
              COUNT(*) AS total_employees,
              SUM(
                CASE
                  WHEN status = 'ACTIVE'
                  THEN 1
                  ELSE 0
                END
              ) AS active_employees,
              SUM(
                CASE
                  WHEN status = 'INACTIVE'
                  THEN 1
                  ELSE 0
                END
              ) AS inactive_employees
            FROM employees
          `),
          db.query(`
            SELECT
              COUNT(*) AS total_positions,
              SUM(
                CASE
                  WHEN status = 'ACTIVE'
                  THEN 1
                  ELSE 0
                END
              ) AS active_positions
            FROM positions
          `),
        ]);

        let shiftSummary = {
          total_shifts: 0,
          active_shifts: 0,
        };

        let attendanceSummary = {
          today_attendances: 0,
          today_late: 0,
          today_completed: 0,
        };

        try {
          const [shiftRows] = await db.query(`
            SELECT
              COUNT(*) AS total_shifts,
              SUM(
                CASE
                  WHEN status = 'ACTIVE'
                  THEN 1
                  ELSE 0
                END
              ) AS active_shifts
            FROM work_shifts
          `);

          shiftSummary =
            shiftRows[0] || shiftSummary;
        } catch (error) {
          if (!isMissingTableError(error)) {
            throw error;
          }
        }

        try {
          const attendanceColumns =
            await getAttendanceColumns();

          const shiftColumns =
            await getShiftColumns();

          const [attendanceRows] =
            await db.query(
              `
                SELECT
                  COUNT(*) AS today_attendances,
                  SUM(
                    CASE
                      WHEN ea.${attendanceColumns.entry}
                        > ws.${shiftColumns.start}
                      THEN 1
                      ELSE 0
                    END
                  ) AS today_late,
                  SUM(
                    CASE
                      WHEN ea.${attendanceColumns.exit}
                        IS NOT NULL
                      THEN 1
                      ELSE 0
                    END
                  ) AS today_completed
                FROM employee_attendances ea
                LEFT JOIN work_shifts ws
                  ON ea.id_shift = ws.id_shift
                WHERE ea.${attendanceColumns.date}
                  = CURDATE()
              `,
            );

          attendanceSummary =
            attendanceRows[0] ||
            attendanceSummary;
        } catch (error) {
          if (!isMissingTableError(error)) {
            throw error;
          }
        }

        return res.status(200).json({
          employees:
            employeeRows[0] || {},
          positions:
            positionRows[0] || {},
          shifts: shiftSummary,
          attendance: attendanceSummary,
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  hrRouter.get(
    '/reports/summary',
    async (req, res, next) => {
      try {
        const dateFrom = req.query.date_from
          ? normalizeDate(
              req.query.date_from,
              'La fecha inicial',
            )
          : null;

        const dateTo = req.query.date_to
          ? normalizeDate(
              req.query.date_to,
              'La fecha final',
            )
          : null;

        if (
          dateFrom &&
          dateTo &&
          dateFrom > dateTo
        ) {
          throw new BadRequestException(
            'La fecha inicial no puede ser posterior a la fecha final',
          );
        }

        const attendanceColumns =
          await getAttendanceColumns();

        const shiftColumns =
          await getShiftColumns();

        const conditions = [];
        const params = [];

        if (dateFrom) {
          conditions.push(
            `ea.${attendanceColumns.date} >= ?`,
          );
          params.push(dateFrom);
        }

        if (dateTo) {
          conditions.push(
            `ea.${attendanceColumns.date} <= ?`,
          );
          params.push(dateTo);
        }

        let attendanceWhere = '';

        if (conditions.length) {
          attendanceWhere =
            `WHERE ${conditions.join(' AND ')}`;
        }

        const [
          [generalRows],
          [byEmployeeRows],
          [byPositionRows],
        ] = await Promise.all([
          db.query(
            `
              SELECT
                COUNT(*) AS attendance_records,
                COUNT(
                  DISTINCT ea.id_employee
                ) AS employees_with_attendance,
                SUM(
                  CASE
                    WHEN ea.${attendanceColumns.entry}
                      > ws.${shiftColumns.start}
                    THEN 1
                    ELSE 0
                  END
                ) AS late_records,
                SUM(
                  CASE
                    WHEN ea.${attendanceColumns.exit}
                      IS NOT NULL
                    THEN 1
                    ELSE 0
                  END
                ) AS completed_records
              FROM employee_attendances ea
              LEFT JOIN work_shifts ws
                ON ea.id_shift = ws.id_shift
              ${attendanceWhere}
            `,
            params,
          ),
          db.query(
            `
              SELECT
                e.id_employee,
                CONCAT(
                  e.first_name,
                  ' ',
                  e.last_name
                ) AS employee_name,
                p.name AS position_name,
                COUNT(
                  ea.id_employee_attendance
                ) AS attendance_count,
                SUM(
                  CASE
                    WHEN ea.${attendanceColumns.entry}
                      > ws.${shiftColumns.start}
                    THEN 1
                    ELSE 0
                  END
                ) AS late_count,
                ROUND(
                  SUM(
                    CASE
                      WHEN ea.${attendanceColumns.exit}
                        IS NOT NULL
                      THEN
                        TIMESTAMPDIFF(
                          MINUTE,
                          CONCAT(
                            ea.${attendanceColumns.date},
                            ' ',
                            ea.${attendanceColumns.entry}
                          ),
                          CONCAT(
                            ea.${attendanceColumns.date},
                            ' ',
                            ea.${attendanceColumns.exit}
                          )
                        )
                      ELSE 0
                    END
                  ) / 60,
                  2
                ) AS worked_hours
              FROM employees e
              LEFT JOIN positions p
                ON e.id_position = p.id_position
              LEFT JOIN employee_attendances ea
                ON e.id_employee = ea.id_employee
              LEFT JOIN work_shifts ws
                ON ea.id_shift = ws.id_shift
              ${
                conditions.length
                  ? `WHERE ${conditions
                      .map((condition) =>
                        condition.replace(
                          /^ea\./,
                          'ea.',
                        ),
                      )
                      .join(' AND ')}`
                  : ''
              }
              GROUP BY
                e.id_employee,
                e.first_name,
                e.last_name,
                p.name
              ORDER BY
                attendance_count DESC,
                employee_name ASC
            `,
            params,
          ),
          db.query(`
            SELECT
              p.id_position,
              p.name AS position_name,
              COUNT(e.id_employee) AS total_employees,
              SUM(
                CASE
                  WHEN e.status = 'ACTIVE'
                  THEN 1
                  ELSE 0
                END
              ) AS active_employees
            FROM positions p
            LEFT JOIN employees e
              ON e.id_position = p.id_position
            GROUP BY
              p.id_position,
              p.name
            ORDER BY
              active_employees DESC,
              p.name ASC
          `),
        ]);

        return res.status(200).json({
          range: {
            date_from: dateFrom,
            date_to: dateTo,
          },
          general: generalRows[0] || {},
          by_employee: byEmployeeRows,
          by_position: byPositionRows,
        });
      } catch (error) {
        if (isMissingTableError(error)) {
          return res.status(200).json({
            range: {
              date_from:
                req.query.date_from || null,
              date_to:
                req.query.date_to || null,
            },
            general: {
              attendance_records: 0,
              employees_with_attendance: 0,
              late_records: 0,
              completed_records: 0,
            },
            by_employee: [],
            by_position: [],
          });
        }

        return next(error);
      }
    },
  );

  app.use('/api/hr', hrRouter);

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