'use strict';

module.exports = function createErpDirectionController(service) {
  return {
    async listCustomers(req, res, next) {
      try {
        return res.status(200).json(await service.getCustomers(req.query));
      } catch (error) {
        return next(error);
      }
    },
    async getCustomer(req, res, next) {
      try {
        return res.status(200).json(await service.getCustomer(req.params.id));
      } catch (error) {
        return next(error);
      }
    },
    async getCustomerMemberships(req, res, next) {
      try {
        return res.status(200).json(
          await service.getCustomerMemberships(req.params.id, req.query),
        );
      } catch (error) {
        return next(error);
      }
    },
    async listMembershipPlans(req, res, next) {
      try {
        return res.status(200).json(await service.getMembershipPlans(req.query));
      } catch (error) {
        return next(error);
      }
    },
    async listExpiringMemberships(req, res, next) {
      try {
        return res.status(200).json(await service.getExpiringMemberships(req.query));
      } catch (error) {
        return next(error);
      }
    },
    async listRenewals(req, res, next) {
      try {
        return res.status(200).json(await service.getRenewals(req.query));
      } catch (error) {
        return next(error);
      }
    },
    async getDashboard(req, res, next) {
      try {
        const dashboard = await service.getDashboard();
        return res.status(200).json(dashboard);
      } catch (error) {
        return next(error);
      }
    },
  };
};
