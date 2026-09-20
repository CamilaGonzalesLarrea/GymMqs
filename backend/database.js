const mysql = require("mysql2");

const connection = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    ssl:{
        rejectUnauthorized:false
    }
});


connection.connect((error)=>{
    if(error){
        console.log("Error conexión BD:",error);
    }else{
        console.log("MySQL conectado correctamente");
    }
});


module.exports = connection;