// Test configuration
export const config = {
  baseUrl: process.env.BASE_URL || 'http://0.0.0.0',

  // Service ports (direct access, not through Kong)
  ports: {
    user: 18107,
    idgen: 18088,
    mdms: 18094,
    localization: 18096,
    workflow: 18109,
    pgr: 18083,
    accessControl: 18090,
    encryption: 11234,
    location: 18084,
    boundary: 18081,
    kong: 18000,
  },

  // Database
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '15432'),
    database: process.env.DB_NAME || 'egov',
    user: process.env.DB_USER || 'egov',
    password: process.env.DB_PASSWORD || 'egov123',
  },

  // Test tenant
  tenant: {
    state: 'pg',
    city: 'pg.citya',
  },
};
