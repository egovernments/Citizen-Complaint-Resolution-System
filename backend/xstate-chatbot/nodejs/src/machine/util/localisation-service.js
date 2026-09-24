const config = require('../../env-variables'),
    fetch = require('node-fetch');

class LocalisationService {

    async init() {
        this.messages = {};
        this.localeLabels = {};

        const declared = await this.fetchDeclaredLocales();
        const candidates = declared.length
            ? declared
            : config.supportedLocales.split(',').map((l) => ({ value: l.trim(), label: l.trim() }));

        // Localisation never merges tenants: a search returns rows from the first tenant
        // in the chain that matches, then stops. Fetch each tenant separately and merge,
        // city last so it overrides the state root.
        const stateTenantId = String(config.rootTenantId).split('.')[0];
        const tenants = stateTenantId === config.rootTenantId
            ? [config.rootTenantId]
            : [stateTenantId, config.rootTenantId];

        const covered = [];
        for (const { value, label } of candidates) {
            const codeToMessages = {};
            for (const tenantId of tenants) {
                const messages = await this.fetchMessagesForLocale(value, tenantId).catch((error) => {
                    console.warn(`No messages for ${value} at ${tenantId}: ${error.message}`);
                    return [];
                });
                (messages || []).forEach((record) => { codeToMessages[record.code] = record.message; });
            }
            if (Object.keys(codeToMessages).length === 0) continue;

            this.messages[value] = codeToMessages;
            this.localeLabels[value] = label;
            covered.push(value);
        }

        // Ensure that at least one locale has messages; otherwise, throw an error.
        if (covered.length === 0) {
            throw new Error(
                `Localisation returned no messages for any configured locale [${candidates.map((c) => c.value).join(', ')}]`
            );
        }

        this.supportedLocales = covered;

    }

    async fetchDeclaredLocales() {
        const url = config.egovServices.egovServicesHost + config.egovServices.mdmsSearchPath + '?tenantId=' + config.rootTenantId;
        const body = {
            RequestInfo: {},
            MdmsCriteria: {
                tenantId: config.rootTenantId,
                moduleDetails: [{ moduleName: 'common-masters', masterDetails: [{ name: 'StateInfo' }] }]
            }
        };

        try {
            const response = await fetch(url, {
                method: 'POST',
                timeout: config.timeouts.request,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (!response.ok) {
                throw new Error(`StateInfo fetch failed with status ${response.status}`);
            }
            const data = await response.json();
            const languages = data?.MdmsRes?.['common-masters']?.StateInfo?.[0]?.languages ?? [];
            return languages.filter((language) => language?.value);
        } catch (error) {
            console.error(`Could not load the offered languages: ${error.message}`);
            return [];
        }
    }

    getLocales() {
        return (this.supportedLocales || ['en_IN']).map((value) => ({
            value,
            label: (this.localeLabels || {})[value] || value
        }));
    }

    
    getMessageForCode(code, locale) {
        return (this.messages || {})[locale]?.[code];
    }

    getMessageBundleForCode(code) {
        var messageBundle = {};
        for(var locale in this.messages) {
            messageBundle[locale] = this.messages[locale][code];
        }
        return messageBundle;
    }

    async getMessagesForCodesAndTenantId(codes, tenantId) {
        let messageBundle = {};
        for(let code of codes) {
            messageBundle[code] = {}
        }
        
        for(let locale of this.supportedLocales) {
            let codeToMessages = {};
            let messages = await this.fetchMessagesForLocale(locale, tenantId);
            
            messages.forEach((record, index) => {
                const code =  record['code'];
                const message = record['message'];
                codeToMessages[code] = message;
            });
            
            for(let code of codes) {
                messageBundle[code][locale] = codeToMessages[code];
            }
        }
        
        return messageBundle;
    }

    // Without codes, localisation returns only the most specific tenant that has
    // messages for the locale; ancestor tenants are not merged. Passing codes makes
    // it resolve up the chain, which is the only way to reach keys held on the state root.
    async fetchMessagesForLocale(locale, tenantId, codes) {
        var url = config.egovServices.egovlocalizationhost + config.egovServices.localisationServiceSearchPath + '?tenantId=' + tenantId + '&locale=' + locale;
        if (codes && codes.length) {
            url = url + '&codes=' + encodeURIComponent(codes.join(','));
        }
        
        var options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        }
        
        try {
            const response = await fetch(url, { ...options, timeout: config.timeouts.request });
            if (!response.ok) {
                throw new Error(`Localisation search failed with status ${response.status}`);
            }
            const data = await response.json();
            return data['messages'];
        } catch (error) {
            throw error;
        }
    }

    async getMessagesForModule(module, locale, tenantId) {
        // Fetch messages for a specific module
        var url = config.egovServices.egovlocalizationhost + config.egovServices.localisationServiceSearchPath + 
                  '?tenantId=' + tenantId + '&locale=' + locale + '&module=' + module;
        
        var requestBody = {
            RequestInfo: {
                apiId: "Rainmaker",
                msgId: Date.now() + "|" + locale,
                plainAccessRequest: {}
            }
        };
        
        var options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        }
        
        try {
            const response = await fetch(url, { ...options, timeout: config.timeouts.request });
            if (!response.ok) {
                throw new Error(`Localisation search failed with status ${response.status}`);
            }
            const data = await response.json();
            
            // Convert to a code->message map
            const messageMap = {};
            if (data['messages']) {
                data['messages'].forEach(msg => {
                    messageMap[msg.code] = msg.message;
                });
            }
            return messageMap;
        } catch (error) {
            console.error('Error fetching module messages:', error);
            return {};
        }
    }

}

const localisationService = new LocalisationService();

/**
 * Boot-time load with backoff, called once from app.js.
 *
 * Not done at require time any more: init() is async, so a failure there was
 * unobservable and left the service running with empty message tables until
 * someone restarted it by hand. Exiting on exhaustion restores the base's
 * self-healing — the orchestrator restarts the container.
 */
async function loadLocalisationOrExit(maxAttempts = 5) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await localisationService.init();
      console.log(`Localisation loaded for [${localisationService.supportedLocales.join(', ')}]`);
      return;
    } catch (error) {
      console.error(`Localisation init attempt ${attempt}/${maxAttempts} failed: ${error.message}`);
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(attempt * 2000, 10000)));
      }
    }
  }
  console.error('Localisation could not be loaded; exiting so the orchestrator restarts the service');
  process.exit(1);
}

module.exports = localisationService;
module.exports.loadLocalisationOrExit = loadLocalisationOrExit;