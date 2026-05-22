const fetch = require("node-fetch");
const config = require('./src/env-variables');

async function testLocalityAPI() {
    console.log("🧪 Testing getLocality API call...\n");
    
    // Test parameters
    const consumerCodes = ["PT-PG-2024-01-01-123456"]; // Sample property ID
    const authToken = "dummy-auth-token"; // We'll test with a dummy token first
    const businessService = "PT"; // Property Tax
    
    let supportedServiceForLocality = "{\"TL\" : \"tl-services\",\"FIRENOC\" : \"fireNoc\",\"WS\" : \"ws-services\",\"SW\" : \"sw-services\",\"PT\" : \"PT\",\"BPA\" : \"bpa-services\"}";
    let supportedService = JSON.parse(supportedServiceForLocality);
    let mappedBusinessService = supportedService[businessService];
    
    console.log("📋 Test Parameters:");
    console.log(`   Consumer Codes: ${JSON.stringify(consumerCodes)}`);
    console.log(`   Business Service: ${businessService} -> ${mappedBusinessService}`);
    console.log(`   Auth Token: ${authToken}`);
    console.log(`   Root Tenant ID: ${config.rootTenantId}`);
    console.log(`   Searcher Host: ${config.egovServices.searcherHost}\n`);
    
    // Build request body (current working version)
    const requestBody = {
        RequestInfo: {
            authToken: authToken
        },
        searchCriteria: {
            referenceNumber: consumerCodes,
            limit: 5000,
            offset: 0
        }
    };
    
    // Build URL
    const locationUrl = config.egovServices.searcherHost + 'egov-searcher/locality/' + mappedBusinessService + '/_get?tenantId=' + config.rootTenantId;
    
    console.log("🔗 API Call Details:");
    console.log(`   URL: ${locationUrl}`);
    console.log(`   Method: POST`);
    console.log(`   Request Body: ${JSON.stringify(requestBody, null, 2)}\n`);
    
    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
    };
    
    try {
        console.log("📡 Making API call...\n");
        const response = await fetch(locationUrl, options);
        
        console.log("📊 Response Details:");
        console.log(`   Status: ${response.status} ${response.statusText}`);
        console.log(`   Headers: ${JSON.stringify(Object.fromEntries(response.headers), null, 2)}`);
        
        const responseBody = await response.text();
        console.log(`   Body: ${responseBody}\n`);
        
        if (response.status === 200) {
            console.log("✅ API call successful!");
            try {
                const parsedBody = JSON.parse(responseBody);
                if (parsedBody.Localities && parsedBody.Localities.length > 0) {
                    console.log(`   Found ${parsedBody.Localities.length} localities`);
                    console.log(`   Sample locality: ${JSON.stringify(parsedBody.Localities[0], null, 2)}`);
                } else {
                    console.log("   No localities found in response");
                }
            } catch (e) {
                console.log("   Response is not valid JSON");
            }
        } else {
            console.log("❌ API call failed!");
            console.log("   This is likely why getLocality is throwing 'Error in fetching the Locality data'");
            
            // Common error analysis
            if (response.status === 401) {
                console.log("   🔍 AUTH ERROR: Invalid or missing authentication token");
            } else if (response.status === 403) {
                console.log("   🔍 PERMISSION ERROR: Token doesn't have required permissions");
            } else if (response.status === 404) {
                console.log("   🔍 NOT FOUND: API endpoint or business service not found");
            } else if (response.status >= 500) {
                console.log("   🔍 SERVER ERROR: Internal server error on the API side");
            }
        }
        
    } catch (error) {
        console.log("💥 Network/Connection Error:");
        console.log(`   ${error.message}`);
        console.log("   Check if the searcher host is reachable");
    }
}

// Test with different business services
async function runAllTests() {
    const businessServices = ['PT', 'WS', 'TL'];
    
    for (const service of businessServices) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`Testing ${service} service locality lookup`);
        console.log(`${'='.repeat(60)}`);
        
        // Mock different consumer codes for different services
        let testConsumerCodes;
        switch (service) {
            case 'PT':
                testConsumerCodes = ['PG-PT-2024-01-01-123456'];
                break;
            case 'WS':
                testConsumerCodes = ['WS/1013/2025-26/002288'];
                break;
            case 'TL':
                testConsumerCodes = ['PG-TL-2024-01-01-123456'];
                break;
        }
        
        await testLocalityAPI_ForService(service, testConsumerCodes);
        
        // Wait a bit between requests
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

async function testLocalityAPI_ForService(businessService, consumerCodes) {
    const authToken = "dummy-auth-token";
    
    let supportedServiceForLocality = "{\"TL\" : \"tl-services\",\"FIRENOC\" : \"fireNoc\",\"WS\" : \"ws-services\",\"SW\" : \"sw-services\",\"PT\" : \"PT\",\"BPA\" : \"bpa-services\"}";
    let supportedService = JSON.parse(supportedServiceForLocality);
    let mappedBusinessService = supportedService[businessService];
    
    if (!mappedBusinessService) {
        mappedBusinessService = supportedService["BPA"];
    }
    
    console.log(`Testing ${businessService} -> ${mappedBusinessService} with codes: ${JSON.stringify(consumerCodes)}`);
    
    const requestBody = {
        RequestInfo: {
            authToken: authToken
        },
        searchCriteria: {
            referenceNumber: consumerCodes,
            limit: 5000,
            offset: 0
        }
    };
    
    const locationUrl = config.egovServices.searcherHost + 'egov-searcher/locality/' + mappedBusinessService + '/_get?tenantId=' + config.rootTenantId;
    
    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
    };
    
    try {
        const response = await fetch(locationUrl, options);
        console.log(`Status: ${response.status} for URL: ${locationUrl}`);
        
        if (response.status !== 200) {
            const errorBody = await response.text();
            console.log(`Error response: ${errorBody}`);
        }
        
    } catch (error) {
        console.log(`Network error: ${error.message}`);
    }
}

console.log("🚀 Starting getLocality API Test\n");
console.log("This will test the exact API call that's failing in your chatbot\n");

// Run the test
runAllTests().then(() => {
    console.log("\n🏁 Test completed!");
}).catch(error => {
    console.log(`\n💥 Test failed with error: ${error.message}`);
});