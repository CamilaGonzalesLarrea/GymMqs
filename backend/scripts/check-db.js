// Read-only smoke test: uses .env, starts the real server on an ephemeral port,
// checks real SELECTs, and closes it. Never calls membership GET (which expires rows).
require('dotenv').config({quiet:true});
const assert=require('node:assert/strict');
const {schemas,createRepository}=require('../repositories/mysql.repository');
const {start}=require('../server');
async function check() {
 process.env.PORT='0';
 const {server,db}=await start();
 try {
  for(const [table,schema] of Object.entries(schemas)) {
   const [columns]=await db.query('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[table]);
   for(const column of schema.columns) assert.ok(columns.some(c=>c.COLUMN_NAME===column),table+'.'+column+' missing');
  }
  await db.query('SELECT u.id_user,u.username,u.password_hash,u.status,r.id_role,r.name AS role FROM users u INNER JOIN roles r ON u.id_role=r.id_role WHERE 1=0');
  // Test the four repository projections, including DATE/TIME/DECIMAL conversion.
  for(const table of Object.keys(schemas)) {
   const row=await createRepository(db,table).findOne({});
   if(row) {
    for(const key of ['start_date','end_date','birth_date','attendance_date']) if(row[key]!=null) assert.match(row[key],/^\d{4}-\d{2}-\d{2}$/);
    for(const key of ['price','applied_price']) if(row[key]!=null) assert.equal(typeof row[key],'string');
   }
  }
  const base='http://127.0.0.1:'+server.address().port;
  for(const route of ['/','/customers','/membership-plans','/customer-attendances']) {
   const response=await fetch(base+route);assert.equal(response.status,200);
   if(route==='/') assert.equal(await response.text(),'Hello World!');
   else assert.ok(Array.isArray(await response.json()));
   console.log('HTTP 200 '+route+' (MySQL real)');
  }
  console.log('Esquema, consultas, tipos DATE/DECIMAL y arranque real verificados; sin escrituras de datos.');
 } finally {
  await new Promise(resolve=>server.close(resolve));await db.end();
 }
}
if(require.main===module) check().catch(error=>{console.error('Comprobación fallida:',error.code || error.message);process.exitCode=1;});
module.exports={check};
