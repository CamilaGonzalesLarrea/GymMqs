const {
  BadRequestException,
  NotFoundException,
} = require('../middlewares/errors');

const {
  LessThanOrEqual,
  MoreThanOrEqual,
  Not,
} = require('../repositories/mysql.repository');

class MembershipsService {
  constructor(
    membershipRepository,
    customerRepository,
    membershipPlanRepository,
  ) {
    this.membershipRepository = membershipRepository;
    this.customerRepository = customerRepository;
    this.membershipPlanRepository =
      membershipPlanRepository;
  }

  // =====================================================
  // FECHAS
  // =====================================================

  parseDate(dateString, errorMessage) {
    if (
      !dateString ||
      !/^\d{4}-\d{2}-\d{2}$/.test(
        String(dateString),
      )
    ) {
      throw new BadRequestException(errorMessage);
    }

    const normalized = String(dateString);

    const date = new Date(
      `${normalized}T00:00:00.000Z`,
    );

    if (
      Number.isNaN(date.getTime()) ||
      date.toISOString().split('T')[0] !==
        normalized
    ) {
      throw new BadRequestException(errorMessage);
    }

    return date;
  }

  formatDate(date) {
    if (
      !(date instanceof Date) ||
      Number.isNaN(date.getTime())
    ) {
      throw new BadRequestException(
        'Fecha inválida',
      );
    }

    return date.toISOString().split('T')[0];
  }

  getToday() {
    const now = new Date();

    const year = now.getFullYear();

    const month = String(
      now.getMonth() + 1,
    ).padStart(2, '0');

    const day = String(
      now.getDate(),
    ).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  calculateEndDate(
    startDate,
    durationDays,
  ) {
    if (
      !(startDate instanceof Date) ||
      Number.isNaN(startDate.getTime())
    ) {
      throw new BadRequestException(
        'La fecha de inicio es inválida',
      );
    }

    if (
      !Number.isInteger(durationDays) ||
      durationDays <= 0
    ) {
      throw new BadRequestException(
        'La duración del plan debe ser mayor a cero',
      );
    }

    const endDate = new Date(startDate);

    endDate.setUTCDate(
      endDate.getUTCDate() +
        durationDays -
        1,
    );

    return this.formatDate(endDate);
  }

  // =====================================================
  // HELPERS INTERNOS
  // =====================================================

  normalizeStatus(value) {
    return String(value || '')
      .trim()
      .toUpperCase();
  }

  async findMembershipById(id) {
    const membership =
      await this.membershipRepository.findOne({
        where: {
          id_membership: id,
        },
      });

    if (!membership) {
      throw new NotFoundException(
        'Membresía no encontrada',
      );
    }

    return membership;
  }

  async findActiveCustomer(idCustomer) {
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

    if (
      this.normalizeStatus(customer.status) !==
      'ACTIVE'
    ) {
      throw new BadRequestException(
        'El cliente está inactivo',
      );
    }

    return customer;
  }

  async findActivePlan(idPlan) {
    const plan =
      await this.membershipPlanRepository.findOne({
        where: {
          id_plan: idPlan,
        },
      });

    if (!plan) {
      throw new NotFoundException(
        'Plan de membresía no encontrado',
      );
    }

    if (
      this.normalizeStatus(plan.status) !==
      'ACTIVE'
    ) {
      throw new BadRequestException(
        'El plan de membresía está inactivo',
      );
    }

    if (
      !Number.isInteger(
        Number(plan.duration_days),
      ) ||
      Number(plan.duration_days) <= 0
    ) {
      throw new BadRequestException(
        'El plan tiene una duración inválida',
      );
    }

    const numericPrice = Number(plan.price);

    if (
      !Number.isFinite(numericPrice) ||
      numericPrice < 0
    ) {
      throw new BadRequestException(
        'El plan tiene un precio inválido',
      );
    }

    return {
      ...plan,
      duration_days: Number(
        plan.duration_days,
      ),
      price: numericPrice,
    };
  }

  // =====================================================
  // ACTUALIZAR MEMBRESÍAS VENCIDAS
  // =====================================================

  async updateExpiredMemberships() {
    const today = this.getToday();

    /*
      Toda membresía ACTIVE cuya fecha de vencimiento
      sea anterior a hoy pasa automáticamente a EXPIRED.

      Si vence hoy, todavía permanece ACTIVE.

      Las membresías CANCELLED nunca deben pasar a
      EXPIRED porque ya terminaron por cancelación.
      expireBefore() debe afectar únicamente ACTIVE,
      como ya está planteado en el repositorio.
    */

    await this.membershipRepository.expireBefore(
      today,
    );
  }

  // =====================================================
  // LISTAR MEMBRESÍAS
  // =====================================================

  async findAll() {
    await this.updateExpiredMemberships();

    return this.membershipRepository.find({
      order: {
        id_membership: 'ASC',
      },
    });
  }

  // =====================================================
  // BUSCAR SUPERPOSICIONES
  // =====================================================

  async findOverlappingMembership(
    idCustomer,
    startDate,
    endDate,
  ) {
    return this.membershipRepository.findOne({
      where: [
        {
          id_customer: idCustomer,
          status: 'PENDING',
          start_date:
            LessThanOrEqual(endDate),
          end_date:
            MoreThanOrEqual(startDate),
        },
        {
          id_customer: idCustomer,
          status: 'ACTIVE',
          start_date:
            LessThanOrEqual(endDate),
          end_date:
            MoreThanOrEqual(startDate),
        },
      ],

      order: {
        id_membership: 'ASC',
      },
    });
  }

  // =====================================================
  // CREAR MEMBRESÍA
  // =====================================================

  async create(createMembershipDto) {
    await this.updateExpiredMemberships();

    const customer =
      await this.findActiveCustomer(
        createMembershipDto.id_customer,
      );

    const plan =
      await this.findActivePlan(
        createMembershipDto.id_plan,
      );

    const startDate = this.parseDate(
      createMembershipDto.start_date,
      'Fecha de inicio inválida',
    );

    const startDateString =
      this.formatDate(startDate);

    const endDateString =
      this.calculateEndDate(
        startDate,
        plan.duration_days,
      );

    const overlappingMembership =
      await this.findOverlappingMembership(
        customer.id_customer,
        startDateString,
        endDateString,
      );

    if (overlappingMembership) {
      throw new BadRequestException(
        `El cliente ya tiene una membresía pendiente o activa que se superpone con esas fechas (membresía #${overlappingMembership.id_membership})`,
      );
    }

    const membership =
      this.membershipRepository.create({
        id_customer: customer.id_customer,
        id_plan: plan.id_plan,
        start_date: startDateString,
        end_date: endDateString,

        /*
          El precio queda congelado con el valor
          existente al momento de crear la membresía.
        */
        applied_price: plan.price,

        /*
          Toda nueva membresía comienza PENDING.
        */
        status: 'PENDING',
      });

    return this.membershipRepository.save(
      membership,
    );
  }

  // =====================================================
  // RENOVAR MEMBRESÍA
  // =====================================================

  async renew(
    id,
    renewMembershipDto = {},
  ) {
    await this.updateExpiredMemberships();

    const currentMembership =
      await this.findMembershipById(id);

    const currentStatus =
      this.normalizeStatus(
        currentMembership.status,
      );

    if (
      currentStatus !== 'ACTIVE' &&
      currentStatus !== 'EXPIRED'
    ) {
      if (currentStatus === 'CANCELLED') {
        throw new BadRequestException(
          'No se puede renovar una membresía cancelada. Debe registrarse una nueva membresía.',
        );
      }

      throw new BadRequestException(
        'Solo se pueden renovar membresías activas o vencidas',
      );
    }

    const customer =
      await this.findActiveCustomer(
        currentMembership.id_customer,
      );

    const planId =
      renewMembershipDto.id_plan ??
      currentMembership.id_plan;

    const plan =
      await this.findActivePlan(planId);

    let startDate;

    if (currentStatus === 'ACTIVE') {
      /*
        Si todavía está activa, la renovación empieza
        el día siguiente a su fecha de vencimiento.
      */
      startDate = this.parseDate(
        currentMembership.end_date,
        'Fecha de vencimiento inválida',
      );

      startDate.setUTCDate(
        startDate.getUTCDate() + 1,
      );
    } else {
      /*
        Si ya está vencida, comienza en la fecha
        indicada o, si no se envía, hoy.
      */
      const renewalDate =
        renewMembershipDto.renewal_date ??
        this.getToday();

      startDate = this.parseDate(
        renewalDate,
        'Fecha de renovación inválida',
      );
    }

    const startDateString =
      this.formatDate(startDate);

    const endDateString =
      this.calculateEndDate(
        startDate,
        plan.duration_days,
      );

    const overlappingMembership =
      await this.findOverlappingMembership(
        customer.id_customer,
        startDateString,
        endDateString,
      );

    if (overlappingMembership) {
      throw new BadRequestException(
        `Ya existe una membresía pendiente o activa para ese período (membresía #${overlappingMembership.id_membership})`,
      );
    }

    /*
      Se crea una nueva membresía y NO se modifica la
      anterior. Esto conserva correctamente el historial.
    */
    const newMembership =
      this.membershipRepository.create({
        id_customer:
          currentMembership.id_customer,
        id_plan: plan.id_plan,
        start_date: startDateString,
        end_date: endDateString,
        applied_price: plan.price,
        status: 'PENDING',
      });

    return this.membershipRepository.save(
      newMembership,
    );
  }

  // =====================================================
  // ACTIVAR MEMBRESÍA
  // =====================================================

  async activate(id) {
    await this.updateExpiredMemberships();

    const membership =
      await this.findMembershipById(id);

    const membershipStatus =
      this.normalizeStatus(
        membership.status,
      );

    if (membershipStatus !== 'PENDING') {
      if (membershipStatus === 'CANCELLED') {
        throw new BadRequestException(
          'No se puede activar una membresía cancelada',
        );
      }

      throw new BadRequestException(
        'Solo se pueden activar membresías pendientes',
      );
    }

    await this.findActiveCustomer(
      membership.id_customer,
    );

    this.parseDate(
      membership.start_date,
      'La membresía tiene una fecha de inicio inválida',
    );

    this.parseDate(
      membership.end_date,
      'La membresía tiene una fecha de vencimiento inválida',
    );

    const today = this.getToday();

    if (membership.start_date > today) {
      throw new BadRequestException(
        `No se puede activar esta membresía todavía. Su vigencia comienza el ${membership.start_date}`,
      );
    }

    if (membership.end_date < today) {
      throw new BadRequestException(
        'No se puede activar esta membresía porque su período de vigencia ya terminó',
      );
    }

    const overlappingActiveMembership =
      await this.membershipRepository.findOne({
        where: {
          id_membership: Not(id),
          id_customer:
            membership.id_customer,
          status: 'ACTIVE',
          start_date: LessThanOrEqual(
            membership.end_date,
          ),
          end_date: MoreThanOrEqual(
            membership.start_date,
          ),
        },
      });

    if (overlappingActiveMembership) {
      throw new BadRequestException(
        `No se puede activar esta membresía porque se superpone con la membresía activa #${overlappingActiveMembership.id_membership}`,
      );
    }

    membership.status = 'ACTIVE';

    return this.membershipRepository.save(
      membership,
    );
  }

  // =====================================================
  // CANCELAR MEMBRESÍA
  // =====================================================

  async cancel(id) {
    /*
      Primero sincronizamos vencimientos para que una
      membresía ya vencida no pueda cancelarse como si
      siguiera activa.
    */
    await this.updateExpiredMemberships();

    const membership =
      await this.findMembershipById(id);

    const status =
      this.normalizeStatus(
        membership.status,
      );

    /*
      CANCELLED es un estado final.
      EXPIRED también es final por vencimiento natural.
    */
    if (status === 'CANCELLED') {
      throw new BadRequestException(
        'La membresía ya está cancelada',
      );
    }

    if (status === 'EXPIRED') {
      throw new BadRequestException(
        'No se puede cancelar una membresía que ya está vencida',
      );
    }

    /*
      Se permite cancelar:
      - PENDING: evita que una membresía programada
        llegue a activarse.
      - ACTIVE: detiene la membresía vigente.

      No cambiamos start_date, end_date ni
      applied_price. Así se conserva el historial
      exactamente como fue registrado.
    */
    if (
      status !== 'PENDING' &&
      status !== 'ACTIVE'
    ) {
      throw new BadRequestException(
        'Solo se pueden cancelar membresías pendientes o activas',
      );
    }

    membership.status = 'CANCELLED';

    return this.membershipRepository.save(
      membership,
    );
  }
}

module.exports = MembershipsService;
