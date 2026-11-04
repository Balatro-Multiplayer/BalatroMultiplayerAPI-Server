-- Trusted loader-only fixtures. No game code, art, or LÖVE runtime is loaded.
local source = assert(arg[1], 'loader path required')
local function run(objects, centers, shared, manifest)
  local steps, skins, atlases = {}, {}, {}
  manifest = manifest or {}
  manifest.objects = objects
  local updates = 0
  G = {P_CENTERS = centers, ASSET_ATLAS = {reskin_portrait = {}, reskin_gem = {}, cards_1 = 'vanilla_lc', cards_2 = 'vanilla_hc'}, shared_soul = shared,
    SETTINGS = {CUSTOM_DECK = {Collabs = {Spades = 'existing_spade_skin'}}, colourblind_option = true}}
  Game = {update = function() updates = updates + 1 end}
  SMODS = {
    current_mod = {prefix = 'reskin'},
    load_file = function() return function() return manifest end end,
    Atlas = function(atlas)
      atlases[#atlases + 1] = atlas
      local key = atlas.raw_key and atlas.key or ('reskin_' .. atlas.key)
      G.ASSET_ATLAS[key] = atlas
    end,
    DeckSkin = function(skin) skins[#skins + 1] = skin end,
    Sound = function() end,
    DrawStep = function(step) steps[#steps + 1] = step end,
  }
  sendWarnMessage = function(message) error(message) end
  assert(loadfile(source))()
  return steps, function() return updates end, skins, atlases
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

-- A whole-deck upload is opt-in for every suit, not a default atlas override.
local _, _, skins, atlases = run({}, {}, nil, {
  atlases = {{key = 'cards_1', path = 'cards_1.png', px = 71, py = 95}},
  deck_skin = {atlas = 'cards_1', name = 'Bug "Cards" Ω'},
})
assert(#atlases == 1 and not atlases[1].raw_key)
assert(G.ASSET_ATLAS.cards_1 == 'vanilla_lc' and G.ASSET_ATLAS.cards_2 == 'vanilla_hc')
assert(#skins == 4)
local suits = {'Hearts', 'Clubs', 'Diamonds', 'Spades'}
local ranks = {'2', '3', '4', '5', '6', '7', '8', '9', '10', 'Jack', 'Queen', 'King', 'Ace'}
for row, suit in ipairs(suits) do
  local skin = skins[row]
  assert(skin.key == 'playing_cards_' .. string.lower(suit))
  assert(skin.suit == suit and skin.loc_txt == 'Bug "Cards" Ω')
  assert(#skin.palettes == 2)
  local palette = skin.palettes[1]
  assert(palette.key == 'lc' and palette.pos_style == 'deck')
  assert(palette.hc_default == false)
  assert(skin.palettes[2].key == 'hc' and skin.palettes[2].hc_default == true)
  assert(skin.palettes[2].atlas == palette.atlas)
  assert(palette.atlas == 'reskin_cards_1' and G.ASSET_ATLAS[palette.atlas])
  assert(#palette.ranks == 13)
  for i, rank in ipairs(ranks) do assert(palette.ranks[i] == rank) end
  assert(table.concat(palette.display_ranks, ',') == 'King,Queen,Jack')
end
assert(G.SETTINGS.CUSTOM_DECK.Collabs.Spades == 'existing_spade_skin')
assert(G.SETTINGS.colourblind_option == true)
assert(SMODS.current_mod._reskin_applied == nil)

-- Several named skins share no atlas/selection keys. Both contrast palettes
-- cover all 13 ranks and point to the correct prefixed upload, even with one
-- optional sheet missing. No game source or Steamodded code executes here.
local _, _, multiple = run({}, {}, nil, {
  atlases = {
    {key = 'bugs_lc'}, {key = 'bugs_hc'}, {key = 'night_hc'},
  },
  deck_skins = {
    {key = 'deck_bugs', name = 'Bugs', low = 'bugs_lc', high = 'bugs_hc'},
    {key = 'deck_night', name = 'Night', high = 'night_hc'},
  },
})
assert(#multiple == 8)
for i, suit in ipairs(suits) do
  for index = 0, 1 do
    local skin = multiple[index * 4 + i]
    local key = index == 0 and 'deck_bugs' or 'deck_night'
    assert(skin.key == key .. '_' .. string.lower(suit) and skin.suit == suit)
    assert(skin.loc_txt == (index == 0 and 'Bugs' or 'Night'))
    assert(#skin.palettes == 2)
    for p, palette in ipairs(skin.palettes) do
      assert(palette.key == (p == 1 and 'lc' or 'hc'))
      assert(palette.hc_default == (p == 2))
      assert(palette.pos_style == 'deck' and #palette.ranks == 13)
      for r, rank in ipairs(ranks) do assert(palette.ranks[r] == rank) end
      local expected = index == 1 and 'night_hc' or (p == 1 and 'bugs_lc' or 'bugs_hc')
      assert(palette.atlas == 'reskin_' .. expected and G.ASSET_ATLAS[palette.atlas])
    end
  end
end
assert(G.ASSET_ATLAS.cards_1 == 'vanilla_lc' and G.ASSET_ATLAS.cards_2 == 'vanilla_hc')
assert(G.SETTINGS.CUSTOM_DECK.Collabs.Spades == 'existing_spade_skin' and G.SETTINGS.colourblind_option)

local _, _, empty_skins, empty_atlases = run({}, {})
assert(#empty_skins == 0 and #empty_atlases == 0)
assert(SMODS.current_mod._reskin_applied == nil, 'empty packs must stay a no-op')
print('reskin layer loader assertions passed')
