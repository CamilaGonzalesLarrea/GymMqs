// Small parameterized MySQL data layer for the four existing entities.
// Operators are internal values, never accepted from HTTP input.
const LessThanOrEqual = value => ({op:'<=', value});
const MoreThanOrEqual = value => ({op:'>=', value});
const Not = value => ({op:'!=', value});
const schemas = {
  customers: {key:'id_customer', columns:['id_customer','first_name','last_name','phone','email','birth_date','registration_date','status','notes','creationDate','createdBy']},
  membership_plans: {key:'id_plan', columns:['id_plan','plan_name','duration_days','price','description','status','creationDate','createdBy']},
  memberships: {key:'id_membership', columns:['id_membership','id_customer','id_plan','start_date','end_date','applied_price','status','creationDate','createdBy']},
  customer_attendances: {key:'id_attendance', columns:['id_attendance','id_customer','id_membership','attendance_date','entry_time','uploadedBy']},
};
function createRepository(db, table) {
  const schema = schemas[table];
  if (!schema) throw new Error('Unknown table');
  const column = name => {
    if (!schema.columns.includes(name)) throw new Error('Unknown column');
    return '`' + name + '`';
  };
  const projection = schema.columns.map(column).join(', ');
  async function select(options = {}, one = false) {
    const values = [];
    const groups = options.where ? (Array.isArray(options.where) ? options.where : [options.where]) : [];
    const clauses = groups.map(group => '(' + Object.entries(group).map(([key, value]) => {
      let op = '=';
      if (value && typeof value === 'object' && 'op' in value) { op = value.op; value = value.value; }
      if (!['=', '<=', '>=', '!='].includes(op) || value === undefined) throw new Error('Invalid query');
      if (value === null) return column(key) + ' IS NULL';
      values.push(value); return column(key) + ' ' + op + ' ?';
    }).join(' AND ') + ')');
    const order = Object.entries(options.order || {}).map(([key, value]) => {
      if (!['ASC','DESC'].includes(value)) throw new Error('Invalid order');
      return column(key) + ' ' + value;
    }).join(', ');
    const [rows] = await db.query(`SELECT ${projection} FROM \`${table}\`${clauses.length ? ' WHERE '+clauses.join(' OR ') : ''}${order ? ' ORDER BY '+order : ''}${one ? ' LIMIT 1' : ''}`, values);
    return one ? (rows[0] || null) : rows;
  }
  return {
    find: options => select(options), findOne: options => select(options, true),
    create: data => Object.fromEntries(Object.entries(data).filter(([k,v]) => schema.columns.includes(k) && v !== undefined)),
    async save(data) {
      const id = data[schema.key];
      const entries = Object.entries(data).filter(([k,v]) => schema.columns.includes(k) && k !== schema.key && v !== undefined);
      if (id !== undefined) {
        if (entries.length) await db.query(`UPDATE \`${table}\` SET ${entries.map(([k])=>column(k)+' = ?').join(', ')} WHERE ${column(schema.key)} = ?`, [...entries.map(([,v])=>v), id]);
      } else {
        const [result] = await db.query(`INSERT INTO \`${table}\` (${entries.map(([k])=>column(k)).join(', ')}) VALUES (${entries.map(()=>'?').join(', ')})`,entries.map(([,v])=>v));
        data[schema.key] = result.insertId;
      }
      return select({where:{[schema.key]:data[schema.key]}}, true);
    },
    async findDuplicatePhone(phone, excluded) {
      const [rows] = await db.query(`SELECT ${projection} FROM customers WHERE TRIM(phone) = ?${excluded === undefined ? '' : ' AND id_customer != ?'} LIMIT 1`, excluded === undefined ? [phone] : [phone,excluded]);
      return rows[0] || null;
    },
    async findDuplicateName(firstName, lastName, excluded) {
      const [rows] = await db.query(`SELECT ${projection} FROM customers WHERE LOWER(TRIM(first_name)) = LOWER(?) AND LOWER(TRIM(last_name)) = LOWER(?)${excluded === undefined ? '' : ' AND id_customer != ?'} LIMIT 1`, excluded === undefined ? [firstName,lastName] : [firstName,lastName,excluded]);
      return rows[0] || null;
    },
    async expireBefore(today) {
      await db.query("UPDATE memberships SET status = 'EXPIRED' WHERE status = 'ACTIVE' AND end_date < ?", [today]);
    },
  };
}
module.exports = {createRepository, schemas, LessThanOrEqual, MoreThanOrEqual, Not};
