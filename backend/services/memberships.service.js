const { BadRequestException, NotFoundException } = require('../middlewares/errors');
const { LessThanOrEqual, MoreThanOrEqual, Not } = require('../repositories/mysql.repository');

class MembershipsService {
  constructor(membershipRepository, customerRepository, membershipPlanRepository) {
    this.membershipRepository = membershipRepository;
    this.customerRepository = customerRepository;
    this.membershipPlanRepository = membershipPlanRepository;
  }

  // =====================================================
  // FECHAS
  // =====================================================

          parseDate(
    dateString        ,
    errorMessage        ,
  )       {
    if (
      !dateString ||
      !/^\d{4}-\d{2}-\d{2}$/.test(dateString)
    ) {
      throw new BadRequestException(errorMessage);
    }

    const date = new Date(
      `${dateString}T00:00:00.000Z`,
    );

    if (
      Number.isNaN(date.getTime()) ||
      date.toISOString().split('T')[0] !==
        dateString
    ) {
      throw new BadRequestException(errorMessage);
    }

    return date;
  }

          formatDate(date      )         {
    return date.toISOString().split('T')[0];
  }

          getToday()         {
    const now = new Date();

    const year = now.getFullYear();

    const month = String(
      now.getMonth() + 1,
    ).padStart(2, '0');

    const day = String(now.getDate()).padStart(
      2,
      '0',
    );

    return `${year}-${month}-${day}`;
  }

          calculateEndDate(
    startDate      ,
    durationDays        ,
  )         {
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
      endDate.getUTCDate() + durationDays - 1,
    );

    return this.formatDate(endDate);
  }

  // =====================================================
  // ACTUALIZAR MEMBRESÍAS VENCIDAS
  // =====================================================

          async updateExpiredMemberships()                {
    const today = this.getToday();

    /*
      Toda membresía marcada como ACTIVE cuya fecha
      de vencimiento sea anterior a hoy pasa
      automáticamente a EXPIRED.

      Ejemplo:
      end_date = 2026-09-14
      hoy      = 2026-09-15
      => EXPIRED

      Si vence hoy, todavía permanece ACTIVE.
    */

    await this.membershipRepository.expireBefore(today);
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
    idCustomer        ,
    startDate        ,
    endDate        ,
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

  async create(
    createMembershipDto                     ,
  ) {
    /*
      Antes de validar superposiciones actualizamos
      membresías antiguas que ya vencieron.
    */
    await this.updateExpiredMemberships();

    // ---------------------------------------------------
    // CLIENTE
    // ---------------------------------------------------

    const customer =
      await this.customerRepository.findOne({
        where: {
          id_customer:
            createMembershipDto.id_customer,
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

    // ---------------------------------------------------
    // PLAN
    // ---------------------------------------------------

    const plan =
      await this.membershipPlanRepository.findOne({
        where: {
          id_plan:
            createMembershipDto.id_plan,
        },
      });

    if (!plan) {
      throw new NotFoundException(
        'Plan de membresía no encontrado',
      );
    }

    if (plan.status !== 'ACTIVE') {
      throw new BadRequestException(
        'El plan de membresía está inactivo',
      );
    }

    if (
      !Number.isInteger(plan.duration_days) ||
      plan.duration_days <= 0
    ) {
      throw new BadRequestException(
        'El plan tiene una duración inválida',
      );
    }

    const numericPrice = Number(plan.price);

    if (
      Number.isNaN(numericPrice) ||
      numericPrice < 0
    ) {
      throw new BadRequestException(
        'El plan tiene un precio inválido',
      );
    }

    // ---------------------------------------------------
    // FECHAS
    // ---------------------------------------------------

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

    // ---------------------------------------------------
    // SUPERPOSICIONES
    // ---------------------------------------------------

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

    // ---------------------------------------------------
    // GUARDAR
    // ---------------------------------------------------

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
          Una nueva membresía inicia como pendiente.
          Posteriormente podrá activarse respetando
          el flujo correspondiente.
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
    id        ,
    renewMembershipDto                    ,
  ) {
    /*
      Es importante actualizar vencimientos ANTES
      de consultar la membresía.

      Así una membresía cuya fecha ya terminó
      pasa a EXPIRED y se renueva utilizando
      correctamente la lógica de membresía vencida.
    */
    await this.updateExpiredMemberships();

    const currentMembership =
      await this.membershipRepository.findOne({
        where: {
          id_membership: id,
        },
      });

    if (!currentMembership) {
      throw new NotFoundException(
        'Membresía no encontrada',
      );
    }

    if (
      currentMembership.status !== 'ACTIVE' &&
      currentMembership.status !== 'EXPIRED'
    ) {
      throw new BadRequestException(
        'Solo se pueden renovar membresías activas o vencidas',
      );
    }

    // ---------------------------------------------------
    // CLIENTE
    // ---------------------------------------------------

    const customer =
      await this.customerRepository.findOne({
        where: {
          id_customer:
            currentMembership.id_customer,
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

    // ---------------------------------------------------
    // PLAN
    // ---------------------------------------------------

    /*
      Si desde el frontend se envía id_plan,
      se utiliza el nuevo plan.

      Si no se envía, se conserva el plan anterior.
    */
    const planId =
      renewMembershipDto.id_plan ??
      currentMembership.id_plan;

    const plan =
      await this.membershipPlanRepository.findOne({
        where: {
          id_plan: planId,
        },
      });

    if (!plan) {
      throw new NotFoundException(
        'Plan de membresía no encontrado',
      );
    }

    if (plan.status !== 'ACTIVE') {
      throw new BadRequestException(
        'El plan de membresía está inactivo',
      );
    }

    if (
      !Number.isInteger(plan.duration_days) ||
      plan.duration_days <= 0
    ) {
      throw new BadRequestException(
        'El plan tiene una duración inválida',
      );
    }

    const numericPrice = Number(plan.price);

    if (
      Number.isNaN(numericPrice) ||
      numericPrice < 0
    ) {
      throw new BadRequestException(
        'El plan tiene un precio inválido',
      );
    }

    // ---------------------------------------------------
    // CALCULAR NUEVA FECHA DE INICIO
    // ---------------------------------------------------

    let startDate      ;

    if (
      currentMembership.status === 'ACTIVE'
    ) {
      /*
        Si todavía está activa, la renovación
        comienza exactamente el día siguiente
        a su vencimiento actual.
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
        Si ya venció, comienza en la fecha indicada
        por el usuario o, si no se indicó ninguna,
        en la fecha actual.
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

    // ---------------------------------------------------
    // SUPERPOSICIONES
    // ---------------------------------------------------

    const overlappingMembership =
      await this.findOverlappingMembership(
        currentMembership.id_customer,
        startDateString,
        endDateString,
      );

    if (overlappingMembership) {
      throw new BadRequestException(
        `Ya existe una membresía pendiente o activa para ese período (membresía #${overlappingMembership.id_membership})`,
      );
    }

    // ---------------------------------------------------
    // CREAR NUEVA MEMBRESÍA
    // ---------------------------------------------------

    /*
      No modificamos la membresía anterior.
      Se crea un registro nuevo para conservar
      todo el historial.
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

  async activate(id        ) {
    await this.updateExpiredMemberships();

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

    if (membership.status !== 'PENDING') {
      throw new BadRequestException(
        'Solo se pueden activar membresías pendientes',
      );
    }

    // ---------------------------------------------------
    // CLIENTE
    // ---------------------------------------------------

    const customer =
      await this.customerRepository.findOne({
        where: {
          id_customer:
            membership.id_customer,
        },
      });

    if (!customer) {
      throw new NotFoundException(
        'Cliente no encontrado',
      );
    }

    if (customer.status !== 'ACTIVE') {
      throw new BadRequestException(
        'No se puede activar la membresía porque el cliente está inactivo',
      );
    }

    // ---------------------------------------------------
    // VALIDAR FECHAS
    // ---------------------------------------------------

    this.parseDate(
      membership.start_date,
      'La membresía tiene una fecha de inicio inválida',
    );

    this.parseDate(
      membership.end_date,
      'La membresía tiene una fecha de vencimiento inválida',
    );

    /*
      Una membresía solo puede pasar a ACTIVE cuando
      la fecha actual ya se encuentra dentro de su
      período de vigencia.

      Esto evita activar anticipadamente renovaciones
      que comienzan después de que termine la
      membresía actual.
    */

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

    // ---------------------------------------------------
    // SUPERPOSICIÓN CON OTRA ACTIVA
    // ---------------------------------------------------

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
}
module.exports = MembershipsService;
