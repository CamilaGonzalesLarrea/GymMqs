const {BadRequestException} = require('../middlewares/errors');
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
function integer(value, label) {
  if (!['number','string'].includes(typeof value) || !/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0 || Number(value) > 2147483647) throw new BadRequestException(label);
  return Number(value);
}
function date(value, message) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException(message);
  const parsed = new Date(value+'T00:00:00.000Z');
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0,10) !== value) throw new BadRequestException(message);
}
function validate(kind, update = false) {
  return (req,res,next) => {
    try {
      const input = req.body === undefined && kind === 'renew' ? {} : req.body;
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('El body debe ser un objeto JSON');
      const fields = {customers:['first_name','last_name','phone','email','birth_date','notes'],plans:['plan_name','duration_days','price','description'],memberships:['id_customer','id_plan','start_date'],renew:['id_plan','renewal_date'],attendance:['id_customer'],status:['status']}[kind];
      const b = Object.fromEntries(fields.filter(k=>own(input,k)).map(k=>[k,input[k]]));
      const string = (key, required, max, nullable=false) => {
        if (!own(b,key)) { if(required) throw new BadRequestException('El campo '+key+' es obligatorio'); return; }
        if (nullable && b[key] === null) return;
        if (typeof b[key] !== 'string') throw new BadRequestException('El campo '+key+' debe ser texto');
        if (max && b[key].trim().length > max) throw new BadRequestException('El campo '+key+' supera '+max+' caracteres');
      };
      if (kind === 'customers') {
        for (const k of ['first_name','last_name']) string(k,!update,50,update);
        string('phone',!update,0,update);
        string('email',false,100,true); string('notes',false,0,true); string('birth_date',false,0,true);
        if (b.birth_date) date(b.birth_date,'Fecha de nacimiento inválida');
      }
      if (kind === 'plans') {
        string('plan_name',!update,50); string('description',false,255,true);
        if ((typeof b.plan_name === 'string' && b.plan_name.length > 50) || (typeof b.description === 'string' && b.description.length > 255)) throw new BadRequestException('El nombre admite hasta 50 caracteres y la descripción hasta 255');
        if (own(b,'plan_name') && !b.plan_name.trim()) throw new BadRequestException('El nombre del plan es obligatorio');
        if (!update || own(b,'duration_days')) b.duration_days=integer(b.duration_days,'La duración del plan debe ser mayor a cero');
        if (!update || own(b,'price')) {
          if (!['number','string'].includes(typeof b.price) || !/^\d{1,8}(\.\d{1,2})?$/.test(String(b.price)) || !Number.isFinite(Number(b.price))) throw new BadRequestException('El precio debe ser un decimal no negativo con hasta 2 decimales');
          b.price = String(b.price);
        }
      }
      if (['memberships','attendance'].includes(kind)) b.id_customer=integer(b.id_customer,'El identificador del cliente es inválido');
      if (kind === 'memberships' || (kind === 'renew' && b.id_plan != null)) b.id_plan=integer(b.id_plan,'El identificador del plan es inválido');
      if (kind === 'memberships') date(b.start_date,'Fecha de inicio inválida');
      // The service intentionally ignores renewal_date while renewing an ACTIVE membership.
      if (kind === 'renew' && b.renewal_date != null && typeof b.renewal_date !== 'string') throw new BadRequestException('Fecha de renovación inválida');
      if (kind === 'status' && !['ACTIVE','INACTIVE'].includes(b.status)) throw new BadRequestException(req.baseUrl === '/customers' ? 'Estado de cliente inválido' : 'Estado de plan inválido');
      req.body=b; next();
    } catch (error) { next(error); }
  };
}
function parseId(req,res,next) {
  if (!/^-?\d+$/.test(req.params.id) || !Number.isSafeInteger(Number(req.params.id))) return next(new BadRequestException('Validation failed (numeric string is expected)'));
  req.recordId=Number(req.params.id); next();
}
module.exports={validate,parseId};
