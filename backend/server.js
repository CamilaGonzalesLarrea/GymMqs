require('dotenv').config({quiet:true});
const {createDatabase} = require('./database');
const {createApp} = require('./app');
async function start() {
  for (const key of ['DB_HOST','DB_USER','DB_NAME']) {
    if (!process.env[key]) throw new Error('Falta la variable '+key);
  }
  const pool = createDatabase();
  const db = pool.promise();
  try {
    await db.query('SELECT 1');
    const app = createApp(db);
    const server = await new Promise((resolve,reject)=>{
      const listener = app.listen(Number(process.env.PORT || 3000), ()=>resolve(listener));
      listener.once('error',reject);
    });
    console.log('MySQL conectado correctamente');
    console.log('Servidor corriendo en puerto '+server.address().port);
    const close = () => server.close(()=>{ void db.end(); });
    process.once('SIGINT',close); process.once('SIGTERM',close);
    return {server,db};
  } catch(error) { await db.end(); throw error; }
}
if (require.main === module) start().catch(error=>{
  console.error('No se pudo iniciar el backend:',error.code || error.message);
  process.exitCode=1;
});
module.exports={start};
