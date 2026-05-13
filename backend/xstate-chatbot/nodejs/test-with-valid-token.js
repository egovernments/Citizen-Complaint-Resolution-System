const fetch = require("node-fetch");
const config = require('./src/env-variables');
const userService = require('./src/session/user-service');

async function testWithValidToken() {
    console.log("🔐 Getting valid auth token first...\n");
    
    try {
        // Get a valid auth token like the chatbot does
        const mobileNumber = "7061170992"; // Your test mobile number
        const tenantId = config.rootTenantId;
        
        console.log(`Logging in user: ${mobileNumber} for tenant: ${tenantId}`);
        const userAuth = await userService.loginUser(mobileNumber, tenantId);
        
        if (!userAuth || !userAuth.authToken) {
            console.log("❌ Failed to get valid auth token");
            return;
        }
        
        console.log("✅ Got valid auth token!");
        console.log(`   Token: ${userAuth.authToken.substring(0, 20)}...`);
        console.log(`   User ID: ${userAuth.userInfo?.id}`);
        console.log(`   Mobile: ${userAuth.userInfo?.mobileNumber}\n`);
        
        // Now test getLocality with this valid token
        await testLocalityWithToken(userAuth.authToken);
        
    } catch (error) {
        console.log(`❌ Error getting auth token: ${error.message}`);
    }
}

async function testLocalityWithToken(validAuthToken) {
    console.log("📍 Testing getLocality with valid token...\n");
    
    // Test parameters (using PT since it's most common)
    const consumerCodes = ["PG-PT-2024-01-01-123456"]; 
    const businessService = "PT";
    
    let supportedServiceForLocality = "{\"TL\" : \"tl-services\",\"FIRENOC\" : \"fireNoc\",\"WS\" : \"ws-services\",\"SW\" : \"sw-services\",\"PT\" : \"PT\",\"BPA\" : \"bpa-services\"}";
    let supportedService = JSON.parse(supportedServiceForLocality);
    let mappedBusinessService = supportedService[businessService];
    
    const requestBody = {
        RequestInfo: {
            authToken: validAuthToken
        },
        searchCriteria: {
            referenceNumber: consumerCodes,
            limit: 5000,
            offset: 0
        }
    };
    
    const locationUrl = config.egovServices.searcherHost + 'egov-searcher/locality/' + mappedBusinessService + '/_get?tenantId=' + config.rootTenantId;
    
    console.log(`🔗 Testing URL: ${locationUrl}`);
    console.log(`📋 Request Body: ${JSON.stringify(requestBody, null, 2)}\n`);
    
    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
    };
    
    try {
        const response = await fetch(locationUrl, options);
        console.log(`📊 Response Status: ${response.status} ${response.statusText}`);
        
        const responseBody = await response.text();
        
        if (response.status === 200) {
            console.log("✅ SUCCESS! getLocality API worked!");
            try {
                const parsedBody = JSON.parse(responseBody);
                console.log(`📍 Found localities: ${parsedBody.Localities ? parsedBody.Localities.length : 0}`);
                if (parsedBody.Localities && parsedBody.Localities.length > 0) {
                    console.log(`📍 Sample: ${JSON.stringify(parsedBody.Localities[0], null, 2)}`);
                } else {
                    console.log("📍 No localities in response, but API call succeeded");
                }
            } catch (e) {
                console.log(`📍 Response: ${responseBody}`);
            }
        } else {
            console.log(`❌ FAILED! Status: ${response.status}`);
            console.log(`📄 Error response: ${responseBody}`);
            
            if (response.status === 401) {
                console.log("🔍 Still getting auth error - token might not have required permissions");
            }
        }
        
    } catch (error) {
        console.log(`💥 Network error: ${error.message}`);
    }
}

// Alternative: Test with empty consumer codes to see if API endpoint works
async function testAPIEndpointBasic(validAuthToken) {
    console.log("\n🔧 Testing API endpoint with empty consumer codes...\n");
    
    const requestBody = {
        RequestInfo: {
            authToken: validAuthToken
        },
        searchCriteria: {
            referenceNumber: [],
            limit: 5000,
            offset: 0
        }
    };
    
    const locationUrl = config.egovServices.searcherHost + 'egov-searcher/locality/PT/_get?tenantId=' + config.rootTenantId;
    
    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
    };
    
    try {
        const response = await fetch(locationUrl, options);
        console.log(`📊 Empty test - Status: ${response.status}`);
        const responseBody = await response.text();
        if (response.status === 200) {
            console.log("✅ API endpoint is working - the issue is with consumer codes or search criteria");
        } else {
            console.log(`❌ API endpoint issue: ${responseBody}`);
        }
    } catch (error) {
        console.log(`💥 API endpoint error: ${error.message}`);
    }
}

console.log("🧪 Testing getLocality with REAL authentication...\n");

testWithValidToken().then(() => {
    console.log("\n🏁 Real token test completed!");
}).catch(error => {
    console.log(`\n💥 Test failed: ${error.message}`);
});