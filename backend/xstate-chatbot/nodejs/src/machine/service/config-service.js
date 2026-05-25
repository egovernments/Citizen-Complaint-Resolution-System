const axios = require('axios');
const config = require('../../env-variables');

const fetchTenantsByProvider = async (providerNumber, authToken, userUuid) => {
  const url = `${config.configService.host}/config-service/config/v1/_search`;

  const requestBody = {
    RequestInfo: {
      apiId: 'Rainmaker',
      ver: '1.0',
      ts: Date.now(),
      action: '_search',
      msgId: `chatbot-provider-tenant-${Date.now()}`,
      authToken: authToken || '',
      userInfo: { uuid: userUuid || '' }
    },
    criteria: {
      tenantId: config.configService.tenantId,
      schemaCode: config.configService.providerTenantSchemaCode,
      criteria: {
        providerNumber: providerNumber
      }
    }
  };

  const response = await axios.post(url, requestBody, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 10000
  });

  const configData = response.data && response.data.configData;
  if (!Array.isArray(configData) || configData.length === 0) return [];

  return configData
    .map(entry => entry.data && entry.data.tenantid)
    .filter(Boolean);
};

module.exports = { fetchTenantsByProvider };
