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
        const [positions] = await db.query(`
          SELECT
            id_position,
            name,
            description
          FROM positions
          WHERE status = 'ACTIVE'
          ORDER BY name ASC
        `);

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

  app.use(
    '/api/employees',
    employeesRouter,
  );

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