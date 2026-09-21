const { BadRequestException, NotFoundException } = require('../middlewares/errors');
const { LessThanOrEqual, MoreThanOrEqual, Not } = require('../repositories/mysql.repository');

class CustomersService {
  constructor(customerRepository) {
    this.customerRepository = customerRepository;
  }

  // =====================================================
  // LISTAR CLIENTES
  // =====================================================

  findAll() {
    return this.customerRepository.find({
      order: {
        id_customer: 'ASC',
      },
    });
  }

  // =====================================================
  // NORMALIZACIÓN DE DATOS
  // =====================================================

          normalizeText(value        )         {
    return value.trim().replace(/\s+/g, ' ');
  }

          normalizePhone(value        )         {
    return value.trim().replace(/\s+/g, '');
  }

  // =====================================================
  // VALIDACIONES BÁSICAS
  // =====================================================

          validateRequiredData(
    firstName        ,
    lastName        ,
    phone        ,
  ) {
    if (!firstName || firstName.length < 2) {
      throw new BadRequestException(
        'El nombre debe tener al menos 2 caracteres',
      );
    }

    if (!lastName || lastName.length < 2) {
      throw new BadRequestException(
        'El apellido debe tener al menos 2 caracteres',
      );
    }

    if (!phone) {
      throw new BadRequestException(
        'El teléfono es obligatorio',
      );
    }

    if (!/^[0-9+\-()]+$/.test(phone)) {
      throw new BadRequestException(
        'El teléfono contiene caracteres no válidos',
      );
    }

    if (phone.length < 7 || phone.length > 20) {
      throw new BadRequestException(
        'El teléfono debe tener entre 7 y 20 caracteres',
      );
    }
  }

  // =====================================================
  // DETECTAR DUPLICADOS
  // =====================================================

          async validateDuplicates(
    firstName        ,
    lastName        ,
    phone        ,
    excludedCustomerId         ,
  ) {
    // ---------------------------------------------------
    // TELÉFONO DUPLICADO
    // ---------------------------------------------------

    const customerWithSamePhone = await this.customerRepository.findDuplicatePhone(phone, excludedCustomerId);

    if (customerWithSamePhone) {
      throw new BadRequestException(
        `Ya existe un cliente registrado con el teléfono ${phone}: ${customerWithSamePhone.first_name} ${customerWithSamePhone.last_name}`,
      );
    }

    // ---------------------------------------------------
    // POSIBLE DUPLICADO POR NOMBRE Y APELLIDO
    // ---------------------------------------------------

    const customerWithSameName = await this.customerRepository.findDuplicateName(firstName, lastName, excludedCustomerId);

    if (customerWithSameName) {
      throw new BadRequestException(
        `Posible cliente duplicado: ya existe "${customerWithSameName.first_name} ${customerWithSameName.last_name}" con el teléfono ${customerWithSameName.phone}`,
      );
    }
  }

  // =====================================================
  // CREAR CLIENTE
  // =====================================================

  async create(
    createCustomerDto                   ,
  ) {
    const firstName = this.normalizeText(
      createCustomerDto.first_name,
    );

    const lastName = this.normalizeText(
      createCustomerDto.last_name,
    );

    const phone = this.normalizePhone(
      createCustomerDto.phone,
    );

    this.validateRequiredData(
      firstName,
      lastName,
      phone,
    );

    await this.validateDuplicates(
      firstName,
      lastName,
      phone,
    );

    const customer =
      this.customerRepository.create({
        ...createCustomerDto,

        first_name: firstName,
        last_name: lastName,
        phone,

        email:
          createCustomerDto.email?.trim() ||
          null,

        birth_date:
          createCustomerDto.birth_date ||
          null,

        notes:
          createCustomerDto.notes?.trim() ||
          null,
      });

    try {
      return await this.customerRepository.save(
        customer,
      );
    } catch (error) {
      if (error && typeof error === 'object') {
        const databaseError = error;

        if (
          databaseError.code ===
          'ER_DUP_ENTRY'
        ) {
          throw new BadRequestException(
            'Ya existe un cliente con alguno de los datos únicos ingresados',
          );
        }
      }

      throw error;
    }
  }

  // =====================================================
  // ACTUALIZAR CLIENTE
  // =====================================================

  async update(
    id        ,
    updateCustomerDto                   ,
  ) {
    const customer =
      await this.customerRepository.findOne({
        where: {
          id_customer: id,
        },
      });

    if (!customer) {
      throw new NotFoundException(
        'Cliente no encontrado',
      );
    }

    const firstName = this.normalizeText(
      updateCustomerDto.first_name ??
        customer.first_name,
    );

    const lastName = this.normalizeText(
      updateCustomerDto.last_name ??
        customer.last_name,
    );

    const phone = this.normalizePhone(
      updateCustomerDto.phone ??
        customer.phone,
    );

    this.validateRequiredData(
      firstName,
      lastName,
      phone,
    );

    await this.validateDuplicates(
      firstName,
      lastName,
      phone,
      id,
    );

    customer.first_name = firstName;
    customer.last_name = lastName;
    customer.phone = phone;

    if (
      updateCustomerDto.email !== undefined
    ) {
      customer.email =
        updateCustomerDto.email?.trim() ||
        null;
    }

    if (
      updateCustomerDto.birth_date !==
      undefined
    ) {
      customer.birth_date =
        updateCustomerDto.birth_date ||
        null;
    }

    if (
      updateCustomerDto.notes !== undefined
    ) {
      customer.notes =
        updateCustomerDto.notes?.trim() ||
        null;
    }

    try {
      return await this.customerRepository.save(
        customer,
      );
    } catch (error) {
      if (error && typeof error === 'object') {
        const databaseError = error;

        if (
          databaseError.code ===
          'ER_DUP_ENTRY'
        ) {
          throw new BadRequestException(
            'Ya existe otro cliente con alguno de los datos únicos ingresados',
          );
        }
      }

      throw error;
    }
  }

  // =====================================================
  // CAMBIAR ESTADO
  // =====================================================

  async changeStatus(
    id        ,
    status                       ,
  ) {
    const customer =
      await this.customerRepository.findOne({
        where: {
          id_customer: id,
        },
      });

    if (!customer) {
      throw new NotFoundException(
        'Cliente no encontrado',
      );
    }

    if (
      status !== 'ACTIVE' &&
      status !== 'INACTIVE'
    ) {
      throw new BadRequestException(
        'Estado de cliente inválido',
      );
    }

    if (customer.status === status) {
      throw new BadRequestException(
        status === 'ACTIVE'
          ? 'El cliente ya se encuentra activo'
          : 'El cliente ya se encuentra inactivo',
      );
    }

    customer.status = status;

    return this.customerRepository.save(
      customer,
    );
  }
}
module.exports = CustomersService;
