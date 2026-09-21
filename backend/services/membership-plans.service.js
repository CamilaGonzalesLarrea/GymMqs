const { BadRequestException, NotFoundException } = require('../middlewares/errors');
const { LessThanOrEqual, MoreThanOrEqual, Not } = require('../repositories/mysql.repository');

class MembershipPlansService {
  constructor(membershipPlanRepository) {
    this.membershipPlanRepository = membershipPlanRepository;
  }

  findAll() {
    return this.membershipPlanRepository.find();
  }

  async create(createMembershipPlanDto                         ) {
    const plan = this.membershipPlanRepository.create(
      createMembershipPlanDto,
    );

    return this.membershipPlanRepository.save(plan);
  }

  async update(id        , updateMembershipPlanDto                         ) {
    const plan = await this.membershipPlanRepository.findOne({
      where: { id_plan: id },
    });

    if (!plan) {
      throw new NotFoundException('Plan de membresía no encontrado');
    }

    Object.assign(plan, updateMembershipPlanDto);

    return this.membershipPlanRepository.save(plan);
  }

  async changeStatus(id        , status                       ) {
    const plan = await this.membershipPlanRepository.findOne({
      where: { id_plan: id },
    });

    if (!plan) {
      throw new NotFoundException('Plan de membresía no encontrado');
    }

    plan.status = status;

    return this.membershipPlanRepository.save(plan);
  }
}
module.exports = MembershipPlansService;
