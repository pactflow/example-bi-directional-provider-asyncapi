-- Lifecycle hooks for the User Service Drift tests.
--
-- Each operation starts from a known state: the store is cleared, and any users
-- the test depends on are seeded through the provider's test-support API.

local provider_url = os.getenv("PROVIDER_BASE_URL") or "http://localhost:8081"

local function seed_user(user)
  http({
    url = provider_url .. "/users",
    method = "POST",
    headers = { ["content-type"] = "application/json" },
    body = user,
  })
end

-- Users each operation needs to exist before it runs
local fixtures = {
  ReceiveUserEvents_UserDeleted = { userId = "u-delete-001", email = "delete.me@example.com", name = "Delete Me" },
  GetUser_RequestReply = { userId = "u-get-001", email = "jane.doe@example.com", name = "Jane Doe" },
}

return {
  event_handlers = {
    -- data is { [0] = index, [1] = description, [2] = operation name, [3] = test case title }
    ["operation:started"] = function(event, data)
      http({ url = provider_url .. "/users", method = "DELETE" })

      local user = fixtures[data.operation or data[2]]
      if user then
        seed_user(user)
      end
    end,
  },
}
