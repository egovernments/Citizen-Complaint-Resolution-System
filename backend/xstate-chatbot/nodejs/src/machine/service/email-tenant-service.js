const config = require('../../env-variables');
const fetch = require('node-fetch');
const userService = require('../../session/user-service');

/**
 * Email-based Tenant Service
 * Handles tenant lookup using email addresses instead of organization codes
 */
class EmailTenantService {
    constructor() {
        this.tenantManagementHost = config.tenantManagementHost;
    }

    /**
     * Find tenant by email address using the updated tenant management API
     * @param {string} email - User's email address
     * @returns {Promise<Object>} - Returns tenant details if found, null otherwise
     */
    async findTenantByEmail(email) {
        try {
            // Basic email validation
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                return null;
            }

            const searchRequest = {
                RequestInfo: {
                    apiId: "Rainmaker",
                    ver: ".01",
                    ts: Date.now().toString(),
                    msgId: "search-by-email",
                    userInfo: {
                        uuid: "system"
                    }
                }
            };

            // Use the tenant/_search API with email as query parameter
            const response = await fetch(`${this.tenantManagementHost}/tenant-management/tenant/_search?email=${encodeURIComponent(email)}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(searchRequest)
            });

            if (!response.ok) {
                return null;
            }

            const data = await response.json();
            
            // Check if data is directly an array or has TenantData/Tenants property
            let tenants = [];
            if (Array.isArray(data)) {
                tenants = data;
            } else if (data?.TenantData) {
                tenants = data.TenantData;
            } else if (data?.Tenants) {
                tenants = data.Tenants;
            }
            
            if (tenants && tenants.length > 0) {
                
                // Return all tenants for the email
                const result = {
                    multiple: tenants.length > 1,
                    tenants: tenants.map(tenant => ({
                        code: tenant.code,  // This is the tenant ID
                        name: tenant.name || tenant.code,
                        email: tenant.email,
                        isActive: tenant.isActive
                    }))
                };
                return result;
            }

            return null;
        } catch (error) {
            return null;
        }
    }

    /**
     * Authenticate user with tenant
     * @param {string} mobileNumber - User's WhatsApp number
     * @param {string} tenantId - Tenant code
     * @returns {Promise<Object>} - Returns user details with auth token
     */
    async authenticateUser(mobileNumber, tenantId) {
        try {
            // Try to login user with mobile number and tenant
            const user = await userService.loginUser(mobileNumber, tenantId);
            
            if (user && user.authToken) {
                // User exists
                const enrichedUser = await userService.enrichuserDetails(user);
                return {
                    success: true,
                    exists: true,
                    userId: enrichedUser.userInfo?.uuid,
                    authToken: enrichedUser.authToken,
                    refreshToken: enrichedUser.refreshToken,
                    userInfo: enrichedUser.userInfo,
                    name: enrichedUser.userInfo?.name || 'Citizen'
                };
            }
            
            // User doesn't exist - they need to register through the UI
            return {
                success: false,
                exists: false,
                requiresRegistration: true
            };

        } catch (error) {
            return {
                success: false,
                error: 'Authentication failed'
            };
        }
    }

    /**
     * Get registration URL for sandbox
     * @param {string} tenantEmail - The email associated with tenant
     * @returns {string} - Returns the registration URL
     */
    getSandboxRegistrationUrl(tenantEmail) {
        // Use sandbox host from config
        const sandboxHost = config.sandboxHost;
        const emailQuery = tenantEmail ? `?email=${encodeURIComponent(tenantEmail)}` : '';
        return `${sandboxHost}/sandbox-ui/user/login${emailQuery}`;
    }
}

module.exports = new EmailTenantService();
