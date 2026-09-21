const mysql = require('mysql2');
// One pool and one schema for authentication and operations; never modifies schema.
function createDatabase(env = process.env) {
  return mysql.createPool({
    host: env.DB_HOST, port: Number(env.DB_PORT || 3306),
    user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME,
    ssl: env.DB_SSL === 'false' ? undefined : {rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED === 'true'},
    waitForConnections: true, connectionLimit: 10, connectTimeout: 10000,
    dateStrings: ['DATE'], decimalNumbers: false,
  });
}
module.exports = {createDatabase};
