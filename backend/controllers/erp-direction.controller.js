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
    async getFinancialSummary(req, res, next) {
      try {
        return res.status(200).json(await service.getFinancialSummary(req.query));
      } catch (error) {
        return next(error);
      }
    },
    async listDirectionPayments(req, res, next) {
      try {
        return res.status(200).json(await service.listDirectionPayments(req.query));
      } catch (error) {
        return next(error);
      }
    },
    async getDirectionPayment(req, res, next) {
      try {
        return res.status(200).json(await service.getDirectionPayment(req.params.id));
      } catch (error) {
        return next(error);
      }
    },
    async listPaymentCancellations(req, res, next) {
      try {
        return res.status(200).json(await service.listPaymentCancellations(req.query));
      } catch (error) {
        return next(error);
      }
    },
    async listFinancialEntries(req, res, next) {
      try {
        return res.status(200).json(await service.listFinancialEntries(req.query));
      } catch (error) {
        return next(error);
      }
    },
    async listFinancialMovements(req, res, next) {
      try {
        return res.status(200).json(await service.listFinancialMovements(req.query));
      } catch (error) {
        return next(error);
      }
    },
    async getFinancialMovement(req, res, next) {
      try {
        return res.status(200).json(await service.getFinancialMovement(req.params.id));
      } catch (error) {
        return next(error);
      }
    },
    async getPaymentMethodSummary(req, res, next) {
      try {
        return res.status(200).json(await service.getPaymentMethodSummary(req.query));
      } catch (error) {
        return next(error);
      }
    },
    async listCashClosures(req, res, next) {
      try {
        return res.status(200).json(await service.listCashClosures(req.query));
      } catch (error) {
        return next(error);
      }
    },
    async getCashClosure(req, res, next) {
      try {
        return res.status(200).json(await service.getCashClosure(req.params.id));
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
    async getAttendanceSummary(req, res, next) {
      try {
        return res.status(200).json(await service.getAttendanceSummary(req.query));
      } catch (error) {
        return next(error);
      }
    },
    async getAttendanceHourly(req, res, next) {
      try {
        return res.status(200).json(await service.getAttendanceHourly(req.query));
      } catch (error) {
        return next(error);
      }
    },
    async getAttendanceRecords(req, res, next) {
      try {
        return res.status(200).json(await service.getAttendanceRecords(req.query));
      } catch (error) {
        return next(error);
      }
    },
    async getAttendanceCustomers(req, res, next) {
      try {
        return res.status(200).json(await service.getAttendanceCustomers(req.query));
      } catch (error) {
        return next(error);
      }
    },
    async getCustomerAttendance(req, res, next) {
      try {
        return res.status(200).json(
          await service.getCustomerAttendance(req.params.id, req.query),
        );
      } catch (error) {
        return next(error);
      }
    },
    async getInactiveCustomers(req, res, next) {
      try {
        return res.status(200).json(await service.getInactiveCustomers(req.query));
      } catch (error) {
        return next(error);
      }
    },
    async getCommercialSummary(req, res, next) {
      try {
        return res.status(200).json(await service.getCommercialSummary(req.query));
      } catch (error) {
        return next(error);
      }
    },
    async getCommercialPromotions(req, res, next) {
      try {
        return res.status(200).json(await service.getCommercialPromotions(req.query));
      } catch (error) {
        return next(error);
      }
    },
    async getCommercialRenewals(req, res, next) {
      try {
        return res.status(200).json(await service.getCommercialRenewals(req.query));
      } catch (error) {
        return next(error);
      }
    },
    async getCommercialAlerts(req, res, next) {
      try {
        return res.status(200).json(await service.getCommercialAlerts(req.query));
      } catch (error) {
        return next(error);
      }
    },
    async getCommercialFollowups(req, res, next) {
      try {
        return res.status(200).json(await service.getCommercialFollowups(req.query));
      } catch (error) {
        return next(error);
      }
    },
  };
};
