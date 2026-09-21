module.exports = service => ({
  findAll: async (req,res) => res.json(await service.findAll()),
  create: async (req,res) => res.status(201).json(await service.create(req.body)),
  renew: async (req,res) => res.status(201).json(await service.renew(req.recordId,req.body)),
  activate: async (req,res) => res.json(await service.activate(req.recordId)),
});
