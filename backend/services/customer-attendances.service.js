const { BadRequestException, NotFoundException } = require('../middlewares/errors');
const { LessThanOrEqual, MoreThanOrEqual, Not } = require('../repositories/mysql.repository');

class CustomerAttendancesService {
 
                   duplicateWindowMinutes = 5;

  constructor(attendanceRepository, customerRepository, membershipRepository) {
    this.attendanceRepository = attendanceRepository;
    this.customerRepository = customerRepository;
    this.membershipRepository = membershipRepository;
  }

  // =====================================================
  // LISTAR ASISTENCIAS
  // =====================================================

  findAll() {
    return this.attendanceRepository.find({
      order: {
        attendance_date: 'DESC',
        entry_time: 'DESC',
        id_attendance: 'DESC',
      },
    });
  }

  // =====================================================
  // FECHA Y HORA
  // =====================================================

          formatCurrentDate(date      )         {
    const year = date.getFullYear();

    const month = String(
      date.getMonth() + 1,
    ).padStart(2, '0');

    const day = String(date.getDate()).padStart(
      2,
      '0',
    );

    return `${year}-${month}-${day}`;
  }

          formatCurrentTime(date      )         {
    const hours = String(
      date.getHours(),
    ).padStart(2, '0');

    const minutes = String(
      date.getMinutes(),
    ).padStart(2, '0');

    const seconds = String(
      date.getSeconds(),
    ).padStart(2, '0');

    return `${hours}:${minutes}:${seconds}`;
  }

          timeToSeconds(time        )         {
    const parts = time.split(':');

    if (parts.length !== 3) {
      return Number.NaN;
    }

    const hours = Number(parts[0]);
    const minutes = Number(parts[1]);
    const seconds = Number(parts[2]);

    if (
      !Number.isInteger(hours) ||
      !Number.isInteger(minutes) ||
      !Number.isInteger(seconds) ||
      hours < 0 ||
      hours > 23 ||
      minutes < 0 ||
      minutes > 59 ||
      seconds < 0 ||
      seconds > 59
    ) {
      return Number.NaN;
    }

    return (
      hours * 3600 +
      minutes * 60 +
      seconds
    );
  }

  // =====================================================
  // VALIDAR REGISTRO REPETIDO MUY CERCANO
  // =====================================================

          async validateRecentDuplicate(
    idCustomer        ,
    attendanceDate        ,
    entryTime        ,
  )                {
    /*
     * Buscamos únicamente la asistencia más reciente
     * del cliente durante el día actual.
     */
    const lastAttendance =
      await this.attendanceRepository.findOne({
        where: {
          id_customer: idCustomer,
          attendance_date: attendanceDate,
        },
        order: {
          entry_time: 'DESC',
          id_attendance: 'DESC',
        },
      });

    if (!lastAttendance) {
      return;
    }

    const currentSeconds =
      this.timeToSeconds(entryTime);

    const previousSeconds =
      this.timeToSeconds(
        lastAttendance.entry_time,
      );

    /*
     * Si hubiera un dato de hora inválido en la BD,
     * no dejamos que eso rompa el registro normal.
     */
    if (
      Number.isNaN(currentSeconds) ||
      Number.isNaN(previousSeconds)
    ) {
      return;
    }

    const differenceSeconds =
      currentSeconds - previousSeconds;

    const duplicateWindowSeconds =
      this.duplicateWindowMinutes * 60;

    /*
     * Si el último registro fue hace menos de
     * 5 minutos, consideramos que probablemente
     * es un duplicado accidental.
     *
     * Después de ese período se permite registrar
     * otra entrada el mismo día.
     */
    if (
      differenceSeconds >= 0 &&
      differenceSeconds <
        duplicateWindowSeconds
    ) {
      throw new BadRequestException(
        `El cliente ya registró una asistencia a las ${lastAttendance.entry_time}. Deben pasar al menos ${this.duplicateWindowMinutes} minutos antes de registrar otra entrada.`,
      );
    }

    /*
     * Protección adicional por si existiera en la BD
     * una hora posterior a la hora actual.
     */
    if (differenceSeconds < 0) {
      throw new BadRequestException(
        `Existe una asistencia registrada hoy a las ${lastAttendance.entry_time}. Verifica la fecha y hora del sistema antes de registrar otra entrada.`,
      );
    }
  }

  // =====================================================
  // REGISTRAR ASISTENCIA
  // =====================================================

  async create(
    createCustomerAttendanceDto                             ,
  ) {
    // ---------------------------------------------------
    // VALIDAR IDENTIFICADOR
    // ---------------------------------------------------

    const idCustomer = Number(
      createCustomerAttendanceDto.id_customer,
    );

    if (
      !Number.isInteger(idCustomer) ||
      idCustomer <= 0
    ) {
      throw new BadRequestException(
        'El identificador del cliente es inválido',
      );
    }

    // ---------------------------------------------------
    // CLIENTE
    // ---------------------------------------------------

    const customer =
      await this.customerRepository.findOne({
        where: {
          id_customer: idCustomer,
        },
      });

    if (!customer) {
      throw new NotFoundException(
        'Cliente no encontrado',
      );
    }

    if (customer.status !== 'ACTIVE') {
      throw new BadRequestException(
        'El cliente está inactivo',
      );
    }

    /*
     * Utilizamos el mismo instante para obtener
     * fecha y hora y evitar inconsistencias si la
     * operación ocurre exactamente a medianoche.
     */
    const now = new Date();

    const attendanceDate =
      this.formatCurrentDate(now);

    const entryTime =
      this.formatCurrentTime(now);

    // ---------------------------------------------------
    // VALIDAR MEMBRESÍA ACTIVA Y VIGENTE
    // ---------------------------------------------------

    const membership =
      await this.membershipRepository.findOne({
        where: {
          id_customer: customer.id_customer,

          status: 'ACTIVE',

          start_date:
            LessThanOrEqual(attendanceDate),

          end_date:
            MoreThanOrEqual(attendanceDate),
        },

        order: {
          start_date: 'DESC',
          id_membership: 'DESC',
        },
      });

    if (!membership) {
      throw new BadRequestException(
        'El cliente no tiene una membresía activa y vigente',
      );
    }

    // ---------------------------------------------------
    // EVITAR DUPLICADOS ACCIDENTALES
    // ---------------------------------------------------

    await this.validateRecentDuplicate(
      customer.id_customer,
      attendanceDate,
      entryTime,
    );

    // ---------------------------------------------------
    // REGISTRAR ASISTENCIA
    // ---------------------------------------------------

    const attendance =
      this.attendanceRepository.create({
        id_customer: customer.id_customer,

        id_membership:
          membership.id_membership,

        attendance_date:
          attendanceDate,

        entry_time: entryTime,

        uploadedBy: null,
      });

    return this.attendanceRepository.save(
      attendance,
    );
  }
}
module.exports = CustomerAttendancesService;
