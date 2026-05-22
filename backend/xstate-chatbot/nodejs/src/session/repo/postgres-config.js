const { Pool } = require('pg');
const config = require('../../env-variables');

const poolConfig = {
    user: config.postgresConfig.dbUsername,
    password: config.postgresConfig.dbPassword,
    host: config.postgresConfig.dbHost,
    database: config.postgresConfig.dbName,
    port: config.postgresConfig.dbPort
};

// Enable SSL for RDS/cloud databases
if (config.postgresConfig.dbSSL) {
    poolConfig.ssl = {
        rejectUnauthorized: false
    };
}

const pool = new Pool(poolConfig);

pool.on('error', (err, client) => {
    console.error('Error:', err);
});

module.exports = pool;