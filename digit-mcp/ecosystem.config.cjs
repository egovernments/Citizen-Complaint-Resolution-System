module.exports = {
  apps: [
    {
      name: 'digit-mcp',
      script: 'dist/index.js',
      cwd: '/root/DIGIT-MCP',
      env: {
        MCP_TRANSPORT: 'http',
        MCP_PORT: '3100',
        CRS_ENVIRONMENT: 'chakshu-digit',
        CRS_USERNAME: 'ADMIN',
        CRS_PASSWORD: 'eGov@123',
        CRS_TENANT_ID: 'pg',
      },
    },
    {
      name: 'engram-agent',
      script: './node_modules/.bin/tsx',
      args: 'engram-agent.ts',
      cwd: '/root/DIGIT-MCP',
      cron_restart: '0 2 * * *',
      autorestart: false,
      watch: false,
    },
  ],
};
