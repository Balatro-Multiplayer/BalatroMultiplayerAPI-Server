-- Trusted loader-only fixtures. No game code, art, or LÖVE runtime is loaded.
local source = assert(arg[1], 'loader path required')
local function run(objects, centers, shared)
  local steps = {}
  local updates = 0
  G = {P_CENTERS = centers, ASSET_ATLAS = {reskin_portrait = {}, reskin_gem = {}}, shared_soul = shared}
  Game = {update = function() updates = updates + 1 end}
  SMODS = {
    current_mod = {prefix = 'reskin'},
    load_file = function() return function() return {objects = objects} end end,
    Atlas = function() end,
    Sound = function() end,
    DrawStep = function(step) steps[#steps + 1] = step end,
  }
  sendWarnMessage = function(message) error(message) end
  assert(loadfile(source))()
  return steps, function() return updates end
end
local function object(key, extra)
  extra.registry = 'P_CENTERS'
  extra.key = key
  return extra
end

local center = {set = 'Joker', soul_pos = {x = 3, y = 9}, pos = {x = 3, y = 8}}
run({object('j_caino', {atlas = 'background'})}, {j_caino = center})
assert(center.atlas == 'reskin_background')
assert(center.soul_atlas == 'Joker' and center.hc_soul_atlas == 'Joker' and center.lc_soul_atlas == 'Joker')
assert(center.soul_pos.x == 3 and center.soul_pos.y == 9)

center = {set = 'Joker', atlas = 'base', hc_atlas = 'hc', lc_atlas = 'lc', soul_pos = {x = 2, y = 9}}
run({object('j_hologram', {atlas = 'background'})}, {j_hologram = center})
assert(center.hc_soul_atlas == 'hc' and center.lc_soul_atlas == 'lc')
assert(center.hc_atlas == nil and center.lc_atlas == nil)

center = {set = 'Joker', atlas = 'base', soul_atlas = 'existing_portrait', hc_atlas = 'hc', soul_pos = {x = 1, y = 1}}
run({object('j_caino', {atlas = 'background'})}, {j_caino = center})
assert(center.hc_soul_atlas == 'existing_portrait' and center.lc_soul_atlas == 'existing_portrait')

center = {atlas = 'vanilla', pos = {x = 3, y = 8}, hc_soul_atlas = 'hc', lc_soul_atlas = 'lc'}
run({object('j_caino', {soul_atlas = 'portrait', soul_x = 1, soul_y = 2})}, {j_caino = center})
assert(center.atlas == 'vanilla' and center.pos.x == 3 and center.pos.y == 8)
assert(center.soul_atlas == 'reskin_portrait' and center.soul_pos.x == 1 and center.soul_pos.y == 2)
assert(center.hc_soul_atlas == nil and center.lc_soul_atlas == nil)

center = {atlas = 'vanilla', soul_pos = {x = 3, y = 9}}
run({object('j_caino', {atlas = 'background', soul_atlas = 'portrait'})}, {j_caino = center})
assert(center.atlas == 'reskin_background' and center.soul_atlas == 'reskin_portrait')
assert(center.soul_pos.x == 0 and center.soul_pos.y == 0)

-- Late shared-sprite initialization retries; an already-applied base must not
-- cause a legendary's original atlas to become its replacement on that retry.
local legendary = {set = 'Joker', soul_pos = {x = 3, y = 9}}
local soul = {atlas = 'Tarot', pos = {x = 2, y = 2}}
local steps, updates = run({object('j_caino', {atlas = 'background'}), object('c_soul', {soul_atlas = 'gem', soul_shared = true})}, {j_caino = legendary, c_soul = soul})
assert(not SMODS.current_mod._reskin_applied)
local binds = 0
local function shared()
  return {atlas = {}, sprite_pos = {x = 0, y = 1}, set_sprite_pos = function(self, pos) self.sprite_pos = pos; binds = binds + 1 end}
end
G.shared_soul = shared()
Game:update(0)
assert(updates() == 1 and SMODS.current_mod._reskin_applied)
assert(legendary.hc_soul_atlas == 'Joker' and legendary.soul_atlas == 'Joker')
assert(soul.atlas == 'Tarot' and soul.soul_pos == nil and soul.soul_atlas == nil)
assert(G.shared_soul.atlas == G.ASSET_ATLAS.reskin_gem and G.shared_soul.sprite_pos.y == 0)
assert(#steps == 1 and steps[1].order == 49)
steps[1].func({config = {center = soul}})
assert(binds == 1, 'unchanged shared texture should not rebuild its quad each draw')
G.shared_soul = shared()
steps[1].func({config = {center = legendary}})
assert(binds == 1, 'unrelated cards must not rebind the shared sprite')
steps[1].func({config = {center = soul}})
assert(binds == 2 and G.shared_soul.atlas == G.ASSET_ATLAS.reskin_gem)

run({}, {})
assert(SMODS.current_mod._reskin_applied == nil, 'empty packs must stay a no-op')
print('reskin layer loader assertions passed')
