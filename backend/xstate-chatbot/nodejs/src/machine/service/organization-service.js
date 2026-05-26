const config = require('../../env-variables');
const fetch = require('node-fetch');
const userService = require('../../session/user-service');

/**
 * Organization Service
 * Handles organization/tenant validation and user authentication for multi-tenant support
 */
class OrganizationService {
    constructor() {
        // Use tenant management host from config (configurable per environment)
        this.tenantManagementHost = config.tenantManagementHost;
    }

    /**
     * Validate if an organization code exists in tenant management system
     * @param {string} organizationCode - The organization code to validate
     * @returns {Promise<Object>} - Returns tenant details if valid, null if not
     */
    async validateOrganizationCode(organizationCode) {
        try {
            const searchRequest = {
                RequestInfo: {
                    apiId: "Rainmaker",
                    ver: ".01",
                    ts: Date.now().toString(),
                    msgId: "20170310130900",
                    userInfo: {
                        uuid: "system"
                    }
                }
            };

            // Use tenant/config/_search which returns active status correctly
            const response = await fetch(`${this.tenantManagementHost}/tenant/config/_search?code=${organizationCode}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(searchRequest)
            });

            if (!response.ok) {
                console.error(`Failed to validate organization code: ${response.status}`);
                return null;
            }

            const data = await response.json();
            console.log(`Tenant config search response for code '${organizationCode}':`, JSON.stringify(data, null, 2));
            
            // Check if we got a valid tenant config response
            const tenantConfigs = data?.tenantConfigs || [];
            
            if (tenantConfigs && tenantConfigs.length > 0) {
                const tenantConfig = tenantConfigs[0];
                console.log(`Found tenant config: ${tenantConfig.code}, name: ${tenantConfig.name}`);
                
                // For tenant config API, presence of config means tenant is valid
                // The config API is used by UI and only returns configured tenants
                return {
                    code: tenantConfig.code,
                    name: tenantConfig.name,
                    id: tenantConfig.id,
                    isActive: true  // If config exists, tenant is usable
                };
            } else {
                console.log(`No tenant config found for code '${organizationCode}'`);
            }

            return null;
        } catch (error) {
            console.error('Error validating organization code:', error);
            return null;
        }
    }

    /**
     * Check if user is registered and get user details with auth token
     * @param {string} mobileNumber - User's mobile number
     * @param {string} organizationCode - The organization code/tenantId
     * @returns {Promise<Object>} - Returns user object with auth token if registered, null if not
     */
    async checkAndAuthenticateUser(mobileNumber, organizationCode) {
        try {
            // Use the existing userService to check and authenticate
            // This will attempt to login the user with the given mobile number and tenant
            const user = await userService.loginUser(mobileNumber, organizationCode);
            
            if (user && user.authToken) {
                // User exists and we have auth token
                // Enrich user details if needed
                const enrichedUser = await userService.enrichuserDetails(user);
                return {
                    exists: true,
                    authToken: enrichedUser.authToken,
                    refreshToken: enrichedUser.refreshToken,
                    userInfo: enrichedUser.userInfo,
                    name: enrichedUser.userInfo?.name || 'Citizen',
                    locale: enrichedUser.userInfo?.locale || null
                };
            }
            
            // User doesn't exist in this tenant
            return {
                exists: false,
                authToken: null
            };
        } catch (error) {
            console.error('Error checking and authenticating user:', error);
            return {
                exists: false,
                authToken: null
            };
        }
    }

    /**
     * Get registration URL for sandbox
     * @param {string} organizationCode - The organization code
     * @returns {string} - Returns the registration URL
     */
    getSandboxRegistrationUrl(organizationCode) {
        // Use sandbox host from config
        const sandboxHost = config.sandboxHost;
        return `${sandboxHost}/digit-ui/citizen/login?orgCode=${organizationCode}`;
    }
}

module.exports = new OrganizationService();