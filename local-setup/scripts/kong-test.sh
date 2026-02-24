#!/bin/bash
# Kong API Gateway - Test and Management Script

KONG_PROXY="http://localhost:18000"
KONG_ADMIN="http://localhost:18001"
API_KEY="${DIGIT_API_KEY:-digit-dev-api-key-change-me}"

print_header() {
    echo ""
    echo "=============================================="
    echo "$1"
    echo "=============================================="
}

# Check if Kong is running
check_kong() {
    print_header "Kong Status"
    response=$(curl -s "$KONG_ADMIN/status" 2>&1)
    if echo "$response" | grep -q "server\|memory\|configuration_hash"; then
        echo -e "\033[32mKong is running\033[0m"
        echo ""
        echo "Workers: $(echo "$response" | jq '.memory.workers_lua_vms | length' 2>/dev/null)"
        echo "Config hash: $(echo "$response" | jq -r '.configuration_hash' 2>/dev/null)"
        echo "Total requests: $(echo "$response" | jq '.server.total_requests' 2>/dev/null)"
        return 0
    else
        echo -e "\033[31mKong is not responding\033[0m"
        echo "$response"
        return 1
    fi
}

# List all services
list_services() {
    print_header "Configured Services"
    curl -s "$KONG_ADMIN/services" | jq -r '.data[] | "\(.name): \(.host):\(.port)"' 2>/dev/null
}

# List all routes
list_routes() {
    print_header "Configured Routes"
    curl -s "$KONG_ADMIN/routes" | jq -r '.data[] | "\(.name): \(.paths | join(", "))"' 2>/dev/null
}

# List consumers
list_consumers() {
    print_header "API Consumers"
    curl -s "$KONG_ADMIN/consumers" | jq -r '.data[] | .username' 2>/dev/null
}

# Test API endpoints
test_endpoints() {
    print_header "Testing API Endpoints (with API key)"

    passed=0
    failed=0

    echo ""
    echo "Using API Key: ${API_KEY:0:20}..."
    echo ""

    # Test MDMS
    echo -n "1. MDMS health... "
    response=$(curl -s -o /dev/null -w "%{http_code}" "$KONG_PROXY/health/mdms")
    if [[ "$response" == "200" ]]; then
        echo -e "\033[32mPASS\033[0m"
        passed=$((passed + 1))
    else
        echo -e "\033[31mFAIL ($response)\033[0m"
        failed=$((failed + 1))
    fi

    # Test MDMS with auth
    echo -n "2. MDMS search (authenticated)... "
    response=$(curl -s -X POST "$KONG_PROXY/mdms-v2/v1/_search" \
        -H "X-API-Key: $API_KEY" \
        -H "Content-Type: application/json" \
        -d '{"RequestInfo":{"apiId":"digit","ver":"1.0","ts":0},"MdmsCriteria":{"tenantId":"pg","moduleDetails":[{"moduleName":"tenant","masterDetails":[{"name":"tenants"}]}]}}' 2>&1)
    if echo "$response" | grep -q "MdmsRes"; then
        echo -e "\033[32mPASS\033[0m"
        passed=$((passed + 1))
    else
        echo -e "\033[31mFAIL\033[0m"
        failed=$((failed + 1))
    fi

    # Test User service
    echo -n "3. User health... "
    response=$(curl -s -o /dev/null -w "%{http_code}" "$KONG_PROXY/health/user")
    if [[ "$response" == "200" ]]; then
        echo -e "\033[32mPASS\033[0m"
        passed=$((passed + 1))
    else
        echo -e "\033[31mFAIL ($response)\033[0m"
        failed=$((failed + 1))
    fi

    # Test Workflow health
    echo -n "4. Workflow health... "
    response=$(curl -s -o /dev/null -w "%{http_code}" "$KONG_PROXY/health/workflow")
    if [[ "$response" == "200" ]]; then
        echo -e "\033[32mPASS\033[0m"
        passed=$((passed + 1))
    else
        echo -e "\033[31mFAIL ($response)\033[0m"
        failed=$((failed + 1))
    fi

    # Test Boundary health
    echo -n "5. Boundary health... "
    response=$(curl -s -o /dev/null -w "%{http_code}" "$KONG_PROXY/health/boundary")
    if [[ "$response" == "200" ]]; then
        echo -e "\033[32mPASS\033[0m"
        passed=$((passed + 1))
    else
        echo -e "\033[31mFAIL ($response)\033[0m"
        failed=$((failed + 1))
    fi

    # Test without API key (should fail)
    echo -n "6. MDMS without API key (should fail)... "
    response=$(curl -s -o /dev/null -w "%{http_code}" "$KONG_PROXY/mdms-v2/v1/_search" \
        -H "Content-Type: application/json" \
        -d '{}')
    if [[ "$response" == "401" ]]; then
        echo -e "\033[32mPASS (correctly rejected)\033[0m"
        passed=$((passed + 1))
    else
        echo -e "\033[31mFAIL (expected 401, got $response)\033[0m"
        failed=$((failed + 1))
    fi

    echo ""
    echo "=== Summary: $passed passed, $failed failed ==="
}

# Generate new API key for a consumer
generate_key() {
    local consumer="${1:-digit-dev}"
    print_header "Generating new API key for $consumer"

    # Delete existing keys
    existing=$(curl -s "$KONG_ADMIN/consumers/$consumer/key-auth" | jq -r '.data[].id' 2>/dev/null)
    for key_id in $existing; do
        curl -s -X DELETE "$KONG_ADMIN/consumers/$consumer/key-auth/$key_id" >/dev/null
    done

    # Create new key
    new_key=$(openssl rand -hex 32)
    curl -s -X POST "$KONG_ADMIN/consumers/$consumer/key-auth" \
        -d "key=$new_key" | jq .

    echo ""
    echo "New API key: $new_key"
    echo ""
    echo "Set it with: export DIGIT_API_KEY=$new_key"
}

# Reload Kong config
reload_config() {
    print_header "Reloading Kong Configuration"
    docker exec kong-gateway kong reload
}

# Show usage
usage() {
    echo "Kong API Gateway Management Script"
    echo ""
    echo "Usage: $0 <command>"
    echo ""
    echo "Commands:"
    echo "  status      - Check if Kong is running"
    echo "  services    - List configured services"
    echo "  routes      - List configured routes"
    echo "  consumers   - List API consumers"
    echo "  test        - Test API endpoints"
    echo "  genkey      - Generate new API key"
    echo "  reload      - Reload Kong configuration"
    echo ""
    echo "Environment variables:"
    echo "  DIGIT_API_KEY - API key for authenticated requests (default: digit-dev-api-key-change-me)"
    echo ""
    echo "Examples:"
    echo "  $0 status"
    echo "  $0 test"
    echo "  DIGIT_API_KEY=my-key $0 test"
}

# Main
case "${1:-status}" in
    status)
        check_kong
        ;;
    services)
        list_services
        ;;
    routes)
        list_routes
        ;;
    consumers)
        list_consumers
        ;;
    test)
        test_endpoints
        ;;
    genkey)
        generate_key "${2:-digit-dev}"
        ;;
    reload)
        reload_config
        ;;
    help|--help|-h)
        usage
        ;;
    *)
        echo "Unknown command: $1"
        usage
        exit 1
        ;;
esac
