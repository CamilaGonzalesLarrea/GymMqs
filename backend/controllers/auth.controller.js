const db = require("../database");
const argon2 = require("argon2");


exports.login = (req,res)=>{

    const {username,password}=req.body;


    const sql = `
        SELECT 
            u.id_user,
            u.username,
            u.password_hash,
            u.status,
            r.id_role,
            r.name AS role
        FROM users u
        INNER JOIN roles r
        ON u.id_role = r.id_role
        WHERE u.username = ?
    `;


    db.query(sql,[username], async(error,result)=>{


        if(error){
            console.log(error);

            return res.status(500).json({
                message:"Error en base de datos"
            });
        }


        if(result.length===0){

            return res.status(401).json({
                message:"Usuario no encontrado"
            });

        }


        const user=result[0];


        const passwordCorrect = await argon2.verify(
            user.password_hash,
            password
        );


        if(!passwordCorrect){

            return res.status(401).json({
                message:"Contraseña incorrecta"
            });

        }


        res.json({

            message:"Login correcto",

            user:{
                id:user.id_user,
                username:user.username,
                role:user.role,
                id_role:user.id_role
            }

        });


    });

};