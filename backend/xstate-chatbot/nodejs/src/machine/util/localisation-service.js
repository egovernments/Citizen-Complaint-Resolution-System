const config = require('../../env-variables'),
    fetch = require('node-fetch');

class LocalisationService {

    async init() {
        console.log('🔄 LocalisationService: Starting initialization');
        console.log('📍 LocalisationService: Root tenant ID:', config.rootTenantId);
        console.log('🌐 LocalisationService: Supported locales:', config.supportedLocales);
        
        this.messages = {}
        this.supportedLocales = config.supportedLocales.split(',');
        for(let i = 0; i < this.supportedLocales.length; i++) {
            this.supportedLocales[i] = this.supportedLocales[i].trim();
        }
        
        console.log('📋 LocalisationService: Processed locales:', this.supportedLocales);
        
        this.supportedLocales.forEach(async (locale, index) => {
            console.log(`🌍 LocalisationService: Fetching messages for locale: ${locale}`);
            let codeToMessages = {};
            let messages = await this.fetchMessagesForLocale(locale, config.rootTenantId);
            console.log(`✅ LocalisationService: Received ${messages?.length || 0} messages for locale: ${locale}`);
            
            messages.forEach((record, index) => {
                const code =  record['code'];
                const message = record['message'];
                codeToMessages[code] = message;
            });
            this.messages[locale] = codeToMessages;
            console.log(`💾 LocalisationService: Stored ${Object.keys(codeToMessages).length} messages for locale: ${locale}`);
        });
    }

    getMessageForCode(code, locale) {
        return this.messages[locale][code];
    }

    getMessageBundleForCode(code) {
        var messageBundle = {};
        for(var locale in this.messages) {
            messageBundle[locale] = this.messages[locale][code];
        }
        return messageBundle;
    }

    async getMessagesForCodesAndTenantId(codes, tenantId) {
        console.log('\n🔍 LocalisationService: Getting messages for specific codes');
        console.log('  📍 Tenant ID:', tenantId);
        console.log('  📋 Codes requested:', codes);
        console.log('  🌐 Supported locales:', this.supportedLocales);
        
        let messageBundle = {};
        for(let code of codes) {
            messageBundle[code] = {}
        }
        
        for(let locale of this.supportedLocales) {
            console.log(`\n  🌍 Processing locale: ${locale}`);
            let codeToMessages = {};
            let messages = await this.fetchMessagesForLocale(locale, tenantId);
            
            messages.forEach((record, index) => {
                const code =  record['code'];
                const message = record['message'];
                codeToMessages[code] = message;
            });
            
            console.log(`  📊 Total messages fetched for ${locale}: ${Object.keys(codeToMessages).length}`);
            
            let foundCount = 0;
            for(let code of codes) {
                messageBundle[code][locale] = codeToMessages[code];
                if (codeToMessages[code]) {
                    foundCount++;
                    console.log(`    ✅ Found: ${code} = "${codeToMessages[code]}"`);
                } else {
                    console.log(`    ⚠️ Not found: ${code}`);
                }
            }
            console.log(`  📈 Match rate for ${locale}: ${foundCount}/${codes.length}`);
        }
        
        console.log('\n📦 Final message bundle:', JSON.stringify(messageBundle, null, 2));
        return messageBundle;
    }

    async fetchMessagesForLocale(locale, tenantId) {
        var url = config.egovServices.egovlocalizationhost + config.egovServices.localisationServiceSearchPath + '?tenantId=' + tenantId + '&locale=' + locale;
        
        console.log('\n🔗 LocalisationService: Fetching localization messages');
        console.log('  📍 Tenant ID:', tenantId);
        console.log('  🌐 Locale:', locale);
        console.log('  🌍 Host:', config.egovServices.egovlocalizationhost);
        console.log('  🛤️ Path:', config.egovServices.localisationServiceSearchPath);
        console.log('  🔗 Full URL:', url);
        
        var options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        }
        
        console.log('  📨 Request method:', options.method);
        console.log('  📋 Request headers:', JSON.stringify(options.headers));
        
        try {
            const response = await fetch(url, options);
            console.log('  📡 Response status:', response.status);
            console.log('  📡 Response status text:', response.statusText);
            console.log('  📡 Response headers:', JSON.stringify(response.headers.raw()));
            
            const data = await response.json();
            console.log('  ✅ Response received, message count:', data['messages']?.length || 0);
            
            if (data['messages'] && data['messages'].length > 0) {
                console.log('  📌 Sample messages (first 3):');
                data['messages'].slice(0, 3).forEach(msg => {
                    console.log(`    - ${msg.code}: ${msg.message}`);
                });
            }
            
            return data['messages'];
        } catch (error) {
            console.error('  ❌ Error fetching localization messages:', error);
            console.error('  📝 Error details:', error.message);
            console.error('  📚 Stack trace:', error.stack);
            throw error;
        }
    }

}

const localisationService = new LocalisationService();
localisationService.init();

module.exports = localisationService;