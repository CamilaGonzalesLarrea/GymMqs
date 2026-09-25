module.exports = (service) => ({
  findAll: async (req, res) => {
    const memberships =
      await service.findAll();

    return res.json(memberships);
  },

  create: async (req, res) => {
    const membership =
      await service.create(req.body);

    return res
      .status(201)
      .json(membership);
  },

  renew: async (req, res) => {
    const membership =
      await service.renew(
        req.recordId,
        req.body,
      );

    return res
      .status(201)
      .json(membership);
  },

  activate: async (req, res) => {
    const membership =
      await service.activate(
        req.recordId,
      );

    return res.json(membership);
  },

  cancel: async (req, res) => {
    const membership =
      await service.cancel(
        req.recordId,
      );

    return res.json(membership);
  },
});