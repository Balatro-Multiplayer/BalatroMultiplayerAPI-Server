-- Convert a pure-data Balatro localization Lua file to JSON on stdout.
-- Usage: luajit lua2json.lua <path-to-localization.lua>
-- The localization files are `return { ... }` tables of strings / arrays / maps.

local path = assert(arg[1], 'missing lua file path')

local function load_table(p)
  local chunk = assert(loadfile(p))
  -- Sandbox: localization files are pure data and need no globals.
  if setfenv then setfenv(chunk, {}) end
  return chunk()
end

local function escape(s)
  return (s:gsub('[%z\1-\31\\"]', function(c)
    local map = { ['"'] = '\\"', ['\\'] = '\\\\', ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t', ['\b'] = '\\b', ['\f'] = '\\f' }
    return map[c] or string.format('\\u%04x', string.byte(c))
  end))
end

local function is_array(t)
  local n = 0
  for k in pairs(t) do
    if type(k) ~= 'number' then return false end
    n = n + 1
  end
  for i = 1, n do
    if t[i] == nil then return false end
  end
  return true, n
end

local encode
encode = function(v)
  local tv = type(v)
  if tv == 'string' then
    return '"' .. escape(v) .. '"'
  elseif tv == 'number' then
    return tostring(v)
  elseif tv == 'boolean' then
    return tostring(v)
  elseif tv == 'table' then
    local arr, n = is_array(v)
    if arr then
      local parts = {}
      for i = 1, n do parts[i] = encode(v[i]) end
      return '[' .. table.concat(parts, ',') .. ']'
    else
      -- Stable key order for deterministic output.
      local keys = {}
      for k in pairs(v) do keys[#keys + 1] = k end
      table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
      local parts = {}
      for _, k in ipairs(keys) do
        parts[#parts + 1] = '"' .. escape(tostring(k)) .. '":' .. encode(v[k])
      end
      return '{' .. table.concat(parts, ',') .. '}'
    end
  else
    return 'null'
  end
end

io.write(encode(load_table(path)))
