const {test} = require('node:test');
const assert = require('node:assert/strict');
const {once} = require('node:events');
const argon2 = require('argon2');
const {createApp} = require('../app');
const Customers = require('../services/customers.service');
const Plans = require('../services/membership-plans.service');
const Memberships = require('../services/memberships.service');
const Attendances = require('../services/customer-attendances.service');
const {createRepository} = require('../repositories/mysql.repository');
function repo(extra={}) { return {find:async()=>[],findOne:async()=>null,create:x=>({...x}),save:async x=>({...x}),expireBefore:async()=>{},findDuplicatePhone:async()=>null,findDuplicateName:async()=>null,...extra}; }
const customer={id_customer:1,first_name:'Ana',last_name:'Perez',phone:'7654321',status:'ACTIVE'};
const plan={id_plan:2,duration_days:30,price:'120.50',status:'ACTIVE'};
function memberships(current=null, overlap=null, c=customer, p=plan) {
 const rows=repo({findOne:async options=>Object.keys(options.where).length===1 && options.where.id_membership ? current : overlap});
 const service=new Memberships(rows,repo({findOne:async()=>c}),repo({findOne:async()=>p}));
 service.getToday=()=> '2026-09-20'; return service;
}
async function rejectsStatus(fn,status,message) { await assert.rejects(fn,e=>e.status===status && (!message || e.message.includes(message))); }
async function http(db, fn, options={}) {
 const server=createApp(db,options).listen(0,'127.0.0.1');await once(server,'listening');
 const request=async(method,path,body)=>{
  const response=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}
  return {status:response.status,data,headers:response.headers};
 };
 try{await fn(request,server);}finally{await new Promise(resolve=>server.close(resolve));}
}
function sqlQueue(steps) {
 const calls=[];
 return {calls,async query(sql,params){calls.push([sql,params]);const step=steps.shift();assert.ok(step,'Unexpected SQL: '+sql);assert.match(sql,step.match);if(step.error)throw step.error;return [step.rows??[]];},done(){assert.equal(steps.length,0);}};
}
test('root, CORS, 404 and all four list routes',async()=>{
 const db={async query(sql){return [sql.startsWith('UPDATE')?{affectedRows:0}:[]];}};
 await http(db,async request=>{
  const root=await request('GET','/');assert.equal(root.data,'Gimnasio MQS API');assert.equal(root.headers.get('access-control-allow-origin'),'*');
  for(const path of ['/customers','/membership-plans','/memberships','/customer-attendances']) {const r=await request('GET',path);assert.equal(r.status,200);assert.deepEqual(r.data,[]);}
  assert.equal((await request('GET','/missing')).status,404);
 });
});
test('Camila login uses real Argon2, retains exact user contract and inactive-user behavior',async()=>{
 const hash=await argon2.hash('secret');
 const db={async query(sql,params){assert.match(sql,/INNER JOIN roles/);return [params[0]==='ana'?[{id_user:3,username:'ana',password_hash:hash,status:'INACTIVE',id_role:2,role:'Recepcionista'}]:[]];}};
 await http(db,async request=>{
  assert.deepEqual(await request('POST','/api/auth/login',{username:'ana',password:'secret'}).then(r=>({status:r.status,data:r.data})),{status:200,data:{message:'Login correcto',user:{id:3,username:'ana',role:'Recepcionista',id_role:2}}});
  assert.equal((await request('POST','/api/auth/login',{username:'ana',password:'wrong'})).status,401);
  assert.equal((await request('POST','/api/auth/login',{username:'missing',password:'secret'})).data.message,'Usuario no encontrado');
  assert.equal((await request('POST','/api/auth/login',{})).status,400);
 });
});
test('login database failures and invalid hash are caught',async()=>{
 await http({query:async()=>{throw {code:'ECONNREFUSED'};}},async request=>assert.deepEqual((await request('POST','/api/auth/login',{username:'a',password:'b'})).data,{message:'Error en base de datos'}));
 await http({query:async()=>[[{password_hash:'invalid'}]]},async request=>assert.equal((await request('POST','/api/auth/login',{username:'a',password:'b'})).status,500));
});
test('every operation mutation route is registered and validates bodies/IDs',async()=>{
 const db={query:async()=>{throw new Error('Validation must precede SQL');}};
 await http(db,async request=>{
  for(const path of ['/customers','/membership-plans','/memberships','/customer-attendances']) assert.equal((await request('POST',path,{})).status,400,path);
  for(const path of ['/customers/x','/customers/x/status','/membership-plans/x','/membership-plans/x/status','/memberships/x/activate']) assert.equal((await request('PATCH',path,{})).status,400,path);
  assert.equal((await request('POST','/memberships/x/renew',{})).status,400);
  assert.equal((await request('POST','/memberships',{id_customer:true,id_plan:2,start_date:'2026-09-20'})).status,400);
  assert.equal((await request('POST','/customers',{first_name:5,last_name:'Perez',phone:'7654321'})).status,400);
  assert.equal((await request('POST','/membership-plans',{plan_name:'Plan',duration_days:0,price:'5'})).status,400);
 });
});
test('malformed JSON is 400 and DB errors do not expose details',async()=>{
 await http({query:async()=>{throw new Error('SECRET_SQL');}},async(request,server)=>{
  const r=await request('GET','/customers');assert.equal(r.status,500);assert.equal(JSON.stringify(r.data).includes('SECRET_SQL'),false);
  const malformed=await fetch(`http://127.0.0.1:${server.address().port}/customers`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{'});assert.equal(malformed.status,400);
 });
});
test('customer create through HTTP normalizes, parameterizes and blocks injected fields',async()=>{
 const db=sqlQueue([{match:/TRIM\(phone\)/},{match:/LOWER\(TRIM\(first_name\)\)/},{match:/INSERT INTO `customers`/,rows:{insertId:7}},{match:/SELECT.*FROM `customers`/,rows:[{...customer,id_customer:7}]}]);
 await http(db,async request=>{const r=await request('POST','/customers',{first_name:' Ana ',last_name:' Perez ',phone:'76 54321',email:' ',notes:' note ',status:'INACTIVE',id_customer:99});assert.equal(r.status,201);assert.equal(r.data.id_customer,7);});
 assert.equal(db.calls[0][1][0],'7654321');assert.equal(db.calls[2][0].includes('status'),false);assert.equal(db.calls[2][0].includes('Ana'),false);db.done();
});
test('customers normalize whitespace and optional data',async()=>{
 const s=new Customers(repo());const result=await s.create({first_name:' Ana  Maria ',last_name:' Perez ',phone:' 76 54321 ',email:' ',birth_date:'',notes:' hi '});
 assert.equal(result.first_name,'Ana Maria');assert.equal(result.phone,'7654321');assert.equal(result.email,null);assert.equal(result.birth_date,null);assert.equal(result.notes,'hi');
});
test('customers preserve required field, phone and name duplicate rules',async()=>{
 const s=new Customers(repo());
 for(const data of [{...customer,first_name:'A'},{...customer,last_name:'P'},{...customer,phone:'12'},{...customer,phone:'abcdefg'}]) await rejectsStatus(()=>s.create(data),400);
 await rejectsStatus(()=>new Customers(repo({findDuplicatePhone:async()=>customer})).create(customer),400,'7654321');
 await rejectsStatus(()=>new Customers(repo({findDuplicateName:async()=>customer})).create(customer),400,'Posible cliente duplicado');
});
test('customer updates exclude own ID and clear nullable fields',async()=>{
 let excluded;
 const s=new Customers(repo({findOne:async()=>({...customer}),findDuplicatePhone:async(p,id)=>{excluded=id;return null;}}));
 const r=await s.update(1,{email:null,notes:'',birth_date:null});assert.equal(excluded,1);assert.equal(r.email,null);assert.equal(r.notes,null);assert.equal(r.phone,customer.phone);
 await rejectsStatus(()=>new Customers(repo()).update(1,{}),404);
});
test('customer DB duplicate races preserve original 400',async()=>{
 const s=new Customers(repo({findOne:async()=>({...customer}),save:async()=>{throw {code:'ER_DUP_ENTRY'};}}));
 await rejectsStatus(()=>s.create(customer),400,'Ya existe un cliente');
 await rejectsStatus(()=>s.update(1,{}),400,'Ya existe otro cliente');
});
test('customer status rules and missing customer',async()=>{
 const s=new Customers(repo({findOne:async()=>({...customer})}));
 await rejectsStatus(()=>s.changeStatus(1,'ACTIVE'),400,'ya se encuentra activo');
 await rejectsStatus(()=>s.changeStatus(1,'INVALID'),400);
 assert.equal((await s.changeStatus(1,'INACTIVE')).status,'INACTIVE');
 await rejectsStatus(()=>new Customers(repo()).changeStatus(99,'ACTIVE'),404);
});
test('plans retain create/update/status and missing record errors',async()=>{
 const s=new Plans(repo({findOne:async()=>({...plan})}));
 assert.equal((await s.create(plan)).price,'120.50');assert.equal((await s.update(2,{price:'200.00'})).price,'200.00');assert.equal((await s.changeStatus(2,'INACTIVE')).status,'INACTIVE');
 await rejectsStatus(()=>new Plans(repo()).update(99,{}),404);await rejectsStatus(()=>new Plans(repo()).changeStatus(99,'ACTIVE'),404);
});
test('memberships freeze price, default PENDING, calculate inclusive dates and leap years',async()=>{
 const s=memberships();const r=await s.create({id_customer:1,id_plan:2,start_date:'2026-09-20'});
 assert.deepEqual(r,{id_customer:1,id_plan:2,start_date:'2026-09-20',end_date:'2026-10-19',applied_price:'120.50',status:'PENDING'});
 assert.equal(s.calculateEndDate(new Date('2024-02-28T00:00:00Z'),2),'2024-02-29');
 assert.equal(s.calculateEndDate(new Date('2026-12-31T00:00:00Z'),2),'2027-01-01');
 await rejectsStatus(()=>s.create({id_customer:1,id_plan:2,start_date:'2026-02-30'}),400);
});
test('memberships expire before listing or creation',async()=>{
 const calls=[];const r=repo({expireBefore:async d=>calls.push('expire:'+d),find:async()=>{calls.push('find');return [];}});
 const s=new Memberships(r,repo(),repo());s.getToday=()=> '2026-09-20';await s.findAll();assert.deepEqual(calls,['expire:2026-09-20','find']);
});
test('membership customer and plan preconditions',async()=>{
 const dto={id_customer:1,id_plan:2,start_date:'2026-09-20'};
 for(const [c,p,status] of [[null,plan,404],[{...customer,status:'INACTIVE'},plan,400],[customer,null,404],[customer,{...plan,status:'INACTIVE'},400],[customer,{...plan,duration_days:0},400],[customer,{...plan,price:'x'},400],[customer,{...plan,price:'-1'},400]]) await rejectsStatus(()=>memberships(null,null,c,p).create(dto),status);
 await rejectsStatus(()=>memberships(null,{id_membership:9}).create(dto),400,'#9');
});
test('active renewals start next day, ignore supplied renewal_date and preserve previous record',async()=>{
 const current={id_membership:10,id_customer:1,id_plan:2,status:'ACTIVE',end_date:'2026-09-30'};const before={...current};
 const r=await memberships(current).renew(10,{renewal_date:'ignored'});assert.equal(r.start_date,'2026-10-01');assert.equal(r.status,'PENDING');assert.equal(r.end_date,'2026-10-30');assert.deepEqual(current,before);assert.equal(r.id_membership,undefined);
});
test('expired renewal date, default date, alternate plan and overlap',async()=>{
 const current={id_membership:10,id_customer:1,id_plan:2,status:'EXPIRED',end_date:'2026-09-01'};
 assert.equal((await memberships(current).renew(10,{})).start_date,'2026-09-20');
 assert.equal((await memberships(current,null,customer,{...plan,id_plan:3}).renew(10,{id_plan:3,renewal_date:'2026-10-10'})).id_plan,3);
 await rejectsStatus(()=>memberships(current).renew(10,{renewal_date:'2026-02-30'}),400);
 await rejectsStatus(()=>memberships(current,{id_membership:11}).renew(10,{}),400,'#11');
 for(const status of ['PENDING','CANCELLED']) await rejectsStatus(()=>memberships({...current,status}).renew(10,{}),400);
 await rejectsStatus(()=>memberships().renew(99,{}),404);
});
test('activation only within inclusive period, active customer and no competing active membership',async()=>{
 const pending={id_membership:10,id_customer:1,id_plan:2,status:'PENDING',start_date:'2026-09-20',end_date:'2026-09-20'};
 assert.equal((await memberships({...pending}).activate(10)).status,'ACTIVE');
 for(const changes of [{status:'ACTIVE'},{start_date:'2026-09-21'},{end_date:'2026-09-19'},{start_date:'invalid'}]) await rejectsStatus(()=>memberships({...pending,...changes}).activate(10),400);
 await rejectsStatus(()=>memberships({...pending},null,{...customer,status:'INACTIVE'}).activate(10),400);
 await rejectsStatus(()=>memberships({...pending},{id_membership:11}).activate(10),400,'#11');
 await rejectsStatus(()=>memberships().activate(99),404);
});
test('overlap query uses both pending and active statuses and inclusive boundaries',async()=>{
 let options;const s=new Memberships(repo({findOne:async o=>{options=o;return null;}}),repo(),repo());
 await s.findOverlappingMembership(1,'2026-09-01','2026-09-30');assert.deepEqual(options.where.map(x=>x.status),['PENDING','ACTIVE']);
 assert.deepEqual(options.where[0].start_date,{op:'<=',value:'2026-09-30'});assert.deepEqual(options.where[0].end_date,{op:'>=',value:'2026-09-01'});
});
test('attendance requires valid active customer and active current membership',async()=>{
 const s=new Attendances(repo(),repo({findOne:async()=>customer}),repo({findOne:async()=>({id_membership:10})}));
 s.formatCurrentDate=()=> '2026-09-20';s.formatCurrentTime=()=> '10:00:00';
 assert.deepEqual(await s.create({id_customer:'1'}),{id_customer:1,id_membership:10,attendance_date:'2026-09-20',entry_time:'10:00:00',uploadedBy:null});
 await rejectsStatus(()=>s.create({id_customer:0}),400);
 await rejectsStatus(()=>new Attendances(repo(),repo(),repo()).create({id_customer:1}),404);
 await rejectsStatus(()=>new Attendances(repo(),repo({findOne:async()=>({...customer,status:'INACTIVE'})}),repo()).create({id_customer:1}),400);
 await rejectsStatus(()=>new Attendances(repo(),repo({findOne:async()=>customer}),repo()).create({id_customer:1}),400);
});
test('attendance duplicate boundary 4:59 rejected, 5:00 allowed, future rejected, invalid stored time tolerated',async()=>{
 for(const [last,current,ok] of [['10:00:00','10:04:59',false],['10:00:00','10:05:00',true],['10:00:00','10:00:00',false],['10:01:00','10:00:00',false],['invalid','10:00:00',true]]) {
  const s=new Attendances(repo({findOne:async()=>({entry_time:last})}),repo(),repo());
  const action=()=>s.validateRecentDuplicate(1,'2026-09-20',current);if(ok)await action();else await rejectsStatus(action,400);
 }
});
test('repository creates exact SQL for overlap, ordering and strict expiry',async()=>{
 const db=sqlQueue([{match:/WHERE \(`id_customer` = \? AND `status` = \? AND `start_date` <= \? AND `end_date` >= \?\) OR .*ORDER BY `id_membership` ASC LIMIT 1/},{match:/UPDATE memberships SET status = 'EXPIRED' WHERE status = 'ACTIVE' AND end_date < \?/}]);
 const r=createRepository(db,'memberships');const s=new Memberships(r,repo(),repo());await s.findOverlappingMembership(1,'2026-09-01','2026-09-30');await r.expireBefore('2026-09-20');
 assert.deepEqual(db.calls[0][1],[1,'PENDING','2026-09-30','2026-09-01',1,'ACTIVE','2026-09-30','2026-09-01']);db.done();
});
test('repository updates and re-reads existing row, never interpolates values',async()=>{
 const db=sqlQueue([{match:/UPDATE `membership_plans` SET `plan_name` = \? WHERE `id_plan` = \?/,rows:{affectedRows:1}},{match:/SELECT.*WHERE \(`id_plan` = \?\) LIMIT 1/,rows:[{id_plan:2,plan_name:"x'; DROP TABLE users; --"}]}]);
 const r=await createRepository(db,'membership_plans').save({id_plan:2,plan_name:"x'; DROP TABLE users; --"});assert.equal(r.id_plan,2);assert.equal(db.calls[0][0].includes('DROP'),false);db.done();
});


test('plan validations match existing MySQL varchar limits',async()=>{
 await http({query:async()=>{throw new Error('Must not query');}},async request=>{
  for(const body of [{plan_name:'x'.repeat(51),duration_days:30,price:'20.00'},{plan_name:'Plan',duration_days:30,price:'20.00',description:'x'.repeat(256)}]) assert.equal((await request('POST','/membership-plans',body)).status,400);
 });
});

test('HR endpoints exist and return the expected payloads',async()=>{
 const db={query:async(sql,params)=>{
  if (sql.includes('FROM employees')) return [[{id_employee:1,first_name:'Ana',last_name:'Pérez',id_position:2,phone:'999999',email:'ana@test.com',hire_date:'2024-01-10',status:'ACTIVE',position_name:'Recepcionista'}]];
  if (sql.includes('FROM positions')) return [[{id_position:2,name:'Recepcionista',description:'Atención al cliente',status:'ACTIVE'}]];
  if (sql.includes('FROM work_shifts')) return [[{id_shift:1,id_employee:1,day:'LUNES',start_time:'08:00:00',end_time:'16:00:00',status:'ACTIVE'}]];
  if (sql.includes('FROM employee_attendance')) return [[{id_employee_attendance:1,id_employee:1,id_shift:1,date:'2026-09-23',entry_time:'08:00:00',exit_time:'16:00:00',notes:''}]];
  if (sql.includes('INSERT INTO employees')) return [{insertId:9}];
  if (sql.includes('INSERT INTO positions')) return [{insertId:3}];
  if (sql.includes('INSERT INTO work_shifts')) return [{insertId:4}];
  if (sql.includes('INSERT INTO employee_attendance')) return [{insertId:5}];
  if (sql.includes('UPDATE employees')) return [{affectedRows:1}];
  if (sql.includes('UPDATE positions')) return [{affectedRows:1}];
  if (sql.includes('UPDATE work_shifts')) return [{affectedRows:1}];
  if (sql.includes('UPDATE employee_attendance')) return [{affectedRows:1}];
  return [[]];
 }};
 await http(db,async request=>{
  const employees=await request('GET','/api/employees');assert.equal(employees.status,200);assert.equal(Array.isArray(employees.data),true);
  const positions=await request('GET','/api/positions');assert.equal(positions.status,200);assert.equal(Array.isArray(positions.data),true);
  const shifts=await request('GET','/api/shifts');assert.equal(shifts.status,200);assert.equal(Array.isArray(shifts.data),true);
  const attendance=await request('GET','/api/employee-attendance');assert.equal(attendance.status,200);assert.equal(Array.isArray(attendance.data),true);
  assert.equal((await request('POST','/api/employees',{first_name:'Ana',last_name:'Pérez',phone:'999999',email:'ana@test.com',id_position:2,hire_date:'2024-01-10',status:'ACTIVE'})).status,201);
  assert.equal((await request('POST','/api/positions',{name:'Recepcionista',description:'Atención al cliente',status:'ACTIVE'})).status,201);
  assert.equal((await request('POST','/api/shifts',{id_employee:1,day:'LUNES',start_time:'08:00:00',end_time:'16:00:00',status:'ACTIVE'})).status,201);
  assert.equal((await request('POST','/api/employee-attendance',{id_employee:1,id_shift:1,date:'2026-09-23',entry_time:'08:00:00',exit_time:'16:00:00',notes:'OK'})).status,201);
  assert.equal((await request('PATCH','/api/employees/1/status',{status:'INACTIVE'})).status,200);
  assert.equal((await request('PUT','/api/positions/2',{name:'Recepcionista',description:'Atención al cliente',status:'ACTIVE'})).status,200);
  assert.equal((await request('PUT','/api/shifts/1',{id_employee:1,day:'MARTES',start_time:'08:00:00',end_time:'16:00:00',status:'ACTIVE'})).status,200);
  assert.equal((await request('PUT','/api/employee-attendance/1',{id_employee:1,id_shift:1,date:'2026-09-23',entry_time:'08:00:00',exit_time:'16:30:00',notes:'OK'})).status,200);
 });
});

test('HR attendance routes target the actual MySQL table name and columns',async()=>{
 const calls=[];
 const db={query:async(sql,params)=>{
  calls.push(sql);
  if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) {
   return [[{COLUMN_NAME:'id_employee_attendance'},{COLUMN_NAME:'id_employee'},{COLUMN_NAME:'id_shift'},{COLUMN_NAME:'attendance_date'},{COLUMN_NAME:'check_in'},{COLUMN_NAME:'check_out'},{COLUMN_NAME:'notes'}]];
  }
  if (sql.includes('FROM employee_attendances')) return [[{id_employee_attendance:1,id_employee:1,id_shift:1,attendance_date:'2026-09-23',check_in:'08:00:00',check_out:'16:00:00',notes:'OK'}]];
  if (sql.includes('INSERT INTO employee_attendances')) return [{insertId:5}];
  if (sql.includes('UPDATE employee_attendances')) return [{affectedRows:1}];
  return [[]];
 }};

 await http(db,async request=>{
  const list=await request('GET','/api/employee-attendance');
  assert.equal(list.status,200);
  const created=await request('POST','/api/employee-attendance',{id_employee:1,id_shift:1,date:'2026-09-23',entry_time:'08:00:00',exit_time:'16:00:00',notes:'OK'});
  assert.equal(created.status,201);
  const updated=await request('PUT','/api/employee-attendance/1',{id_employee:1,id_shift:1,date:'2026-09-23',entry_time:'08:00:00',exit_time:'16:30:00',notes:'OK'});
  assert.equal(updated.status,200);
 });

 assert.ok(calls.some((sql)=>sql.includes('FROM employee_attendances')));
 assert.ok(calls.some((sql)=>sql.includes('INSERT INTO employee_attendances')));
 assert.ok(calls.some((sql)=>sql.includes('UPDATE employee_attendances')));
});
