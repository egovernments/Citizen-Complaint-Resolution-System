'use strict';

// Replaces a provider's axios instance with a recorder that answers `response`.
function stubHttp(provider, response) {
  const calls = [];
  provider.httpClient = {
    post: async (url, body, config) => {
      calls.push({ url, body, config });
      return response;
    },
  };
  return calls;
}

module.exports = { stubHttp };
