import mysql from 'mysql2';
import dotenv from 'dotenv';

dotenv.config();

const requiredDatabaseVariables = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
const missingDatabaseVariables = requiredDatabaseVariables.filter((key) => !process.env[key]);

if (missingDatabaseVariables.length > 0) {
    throw new Error(`Missing database configuration: ${missingDatabaseVariables.join(', ')}`);
}

// 연결정보는 소스에 저장하지 않고 서버 환경변수에서만 읽는다.
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
    waitForConnections: true,
});

const promisePool = pool.promise();

// console.log({connection:connection.host ,__dirname:__dirname})

// CREATE 함수
async function getRenterCode(renter) {
    const [rows] = await promisePool.execute(
        'SELECT key_code FROM jbuildingmng WHERE name = ? LIMIT 1',
        [renter],
    );
    if (rows.length === 0) throw new Error('임차인을 찾을 수 없습니다.');
    return rows[0].key_code;
}
async function checkRentBill(renter,year,month) {
    const [rows] = await promisePool.execute(
        `SELECT a.name
           FROM jbuildingmng a
           JOIN jbuildingrentbill b ON a.key_code = b.comp_code
          WHERE a.name = ? AND b.year = ? AND b.month = ?`,
        [renter, year, month],
    );
    return rows;
}

function createData(table, data, callback) {
    const fields = Object.keys(data).join(',');
    const values = Object.values(data);
    const placeholders = new Array(values.length).fill('?').join(',');
    const sql = `INSERT INTO ${table} (${fields}) VALUES (${placeholders})`;
    pool.query(sql, values, (error, results) => {
        if (error) return callback(null, error);
        console.log('createDate', results)
        callback(results.affectedRows);
    });
}

// READ 함수
function readData(table, field, whereClause, sort, callback) {
    let sql = `SELECT ${field} FROM ${table}`;
    if (whereClause) sql += ` WHERE ${whereClause}`;
    if (sort) sql += `  ${sort}`;
    console.log('ReadData sql : ', sql)
    pool.query(sql, (error, results) => {
        if (error) return callback(null, error);
        let newJsonObj = {};
        let obj = []
        for (let i = 0; i < results.length; i++) {
            let keys = Object.keys(results[i]);
            newJsonObj = {}
            keys.map((key) => {
                newJsonObj[key] = '' + results[i][key]
            });
            obj.push(newJsonObj)
        }
        callback(obj);
    });
}

// UPDATE 함수
function updateData(table, data, whereClause, callback) {
    const values = Object.values(data);
    const placeholders = Object.keys(data)
        .map((key) => `${key} = ?`)
        .join(', ');
    let sql = `UPDATE ${table} SET ${placeholders}`;
    if (whereClause) sql += ` WHERE ${whereClause}`;
    console.log('upDate sql : ', sql)
    pool.query(sql, values, (error, results) => {
        if (error) return callback(null, error);
        callback(results.affectedRows);
    });
}

// DELETE 함수
function deleteData(table, whereClause, callback) {
    let sql = `DELETE FROM ${table}`;
    if (whereClause) sql += ` WHERE ${whereClause}`;
    pool.query(sql, (error, results) => {
        if (error) return callback(null, error);
        callback(results.affectedRows);
    });
}

export default {
    createData,
    readData,
    updateData,
    deleteData,
    getRenterCode,
    checkRentBill,
    query: (statement, values = []) => promisePool.execute(statement, values),
}
