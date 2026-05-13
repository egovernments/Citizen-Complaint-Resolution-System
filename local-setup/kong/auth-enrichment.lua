-- Kong pre-function: Resolve authToken → userInfo via egov-user service
-- Mirrors Spring Cloud Gateway's AuthCheckFilterHelper behavior
--
-- For every POST request with RequestInfo.authToken (and no existing userInfo),
-- calls egov-user/_details to resolve the token and injects the user object
-- as RequestInfo.userInfo before forwarding to the upstream service.

local cjson = require("cjson")
local http = require("resty.http")

-- Only enrich POST requests
if kong.request.get_method() ~= "POST" then
  return
end

local raw_body = kong.request.get_raw_body()
if not raw_body or raw_body == "" then
  return
end

local ok, body = pcall(cjson.decode, raw_body)
if not ok or type(body) ~= "table" then
  return
end

local request_info = body["RequestInfo"]
if not request_info or type(request_info) ~= "table" then
  return
end

local auth_token = request_info["authToken"]
if not auth_token or auth_token == "" then
  return
end

-- Skip if userInfo is already populated
if request_info["userInfo"] and type(request_info["userInfo"]) == "table" then
  local ui = request_info["userInfo"]
  if ui["uuid"] or ui["id"] or ui["userName"] then
    return
  end
end

-- Resolve token via egov-user service
local httpc = http.new()
httpc:set_timeout(5000)

local res, err = httpc:request_uri(
  "http://egov-user-proxy:8107/user/_details?access_token=" .. auth_token,
  {
    method = "POST",
    headers = { ["Content-Type"] = "application/json" },
  }
)

if not res then
  kong.log.err("auth-enrichment: user service call failed: ", err)
  return
end

if res.status ~= 200 then
  kong.log.err("auth-enrichment: user service returned ", res.status)
  return
end

local ok2, user = pcall(cjson.decode, res.body)
if not ok2 or type(user) ~= "table" then
  kong.log.err("auth-enrichment: failed to parse user response")
  return
end

-- Verify we got a real user object (not an error response)
if not user["uuid"] and not user["userName"] then
  kong.log.err("auth-enrichment: user response missing uuid/userName")
  return
end

-- Inject userInfo into RequestInfo
request_info["userInfo"] = user
body["RequestInfo"] = request_info

local new_body = cjson.encode(body)
kong.service.request.set_raw_body(new_body)
