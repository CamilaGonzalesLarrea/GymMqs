const argon2 = require('argon2');
// Original SQL, Argon2 and frontend response contract from Camila.
exports.createAuthController = (db, verify = argon2.verify) => ({
  async login(req, res) {
    const {username, password} = req.body || {};
    if (typeof username !== 'string' || !username || typeof password !== 'string' || !password) {
      return res.status(400).json({message:'Usuario y contraseña son obligatorios'});
    }
    let result;
    try {
      [result] = await db.query(`
        SELECT u.id_user, u.username, u.password_hash, u.status,
               r.id_role, r.name AS role
        FROM users u INNER JOIN roles r ON u.id_role = r.id_role
        WHERE u.username = ?`, [username]);
    } catch (error) {
      console.error('Error login BD:', error.code || error.name);
      return res.status(500).json({message:'Error en base de datos'});
    }
    if (result.length === 0) return res.status(401).json({message:'Usuario no encontrado'});
    const user = result[0];
    let correct;
    try { correct = await verify(user.password_hash, password); }
    catch { return res.status(500).json({message:'Error al verificar la contraseña'}); }
    if (!correct) return res.status(401).json({message:'Contraseña incorrecta'});
    return res.json({message:'Login correcto',user:{id:user.id_user,username:user.username,role:user.role,id_role:user.id_role}});
  },
});
