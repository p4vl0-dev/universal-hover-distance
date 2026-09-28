# Universal Hover Distance

Hover over a token and see how far it is from your selected token(s). That's it.

Works with any game system. No dependencies.

<!-- screenshot: label over a token -->

## Why

Measuring with the ruler every time you want to know "can I hit that guy?" gets old fast. This shows the number the moment you point at something, and it uses the scene's own grid rules, so diagonals, hexes and gridless scenes all give the same result the ruler would.

## What it does

- Shows the distance from your selected tokens to the token under the cursor.
- If nothing is selected, it measures from the token of your assigned character.
- With several tokens selected, it lists one line per token with names.
- Takes elevation into account.
- Updates live while tokens are dragged or animated.

## Features

**Background badge.** The number sits on a rounded semi-transparent plate instead of floating on the map, so it stays readable on any background. Colour, opacity and width are configurable, and you can turn it off.

**Placement.** Above the token, below the token, or right on its center. The offset (0-100 px) is measured from the token edge.

**Size mode.** Static scales with map zoom like everything else on the canvas. Adaptive keeps the label the same size on screen no matter how far you zoom.

**Text style.** Font, size, bold, text colour, outline colour, and outline thickness (0-20, 0 removes it).

**Distance format.** 0, 1 or 2 decimals and a custom unit suffix (`in`, `ft`, `m`, `sq`, whatever your table uses).

**Only in combat.** Optional. The label only appears while a combat is running.

**Hold Alt for everything.** While the "Highlight Objects" key is held (Alt by default, follows your keybinding), labels show up on every visible token at once. This needs at least one selected token, otherwise there's nothing to measure from and it does nothing.

**GM style sync.** The GM can flip "Apply GM style to all players". Everyone then uses the GM's look (position, fonts, colours, badge, number format) and the players' own copies of those settings get locked. Handy when you want the whole table to see the same thing, e.g. on a shared screen or a stream.

All settings are per-user (client) except the sync toggle. The settings menu is split into sections so you don't have to hunt.

## Compatibility

Foundry VTT v12, v13, v14.

| Version | Elevation |
|---|---|
| v13, v14 | Full 3D measurement through the grid |
| v12 | Grid measures in 2D only, so vertical difference is added with Pythagoras: `sqrt(flat² + dz²)`. Close, but it ignores diagonal rules on the vertical axis |

Foundry v14 may run a different PIXI version than v12/v13. The module picks the drawing code by feature detection, so it should work on both. If the badge or outline looks wrong for you, open an issue with the console output.

## Install

Paste this manifest URL into Foundry's module installer:

```
<manifest url here>
```

Or drop the `universal-hover-distance` folder into `Data/modules/` and enable it in your world.

## Languages

English, Русский, Deutsch, Français, Español, Português (Brasil).

Want another language? Copy `lang/en.json`, translate the values, keep the keys, and send a PR.

## Notes

- The label is a child of the token, so it moves and scales with it and doesn't need any position bookkeeping.
- Distance comes from `scene.grid.measurePath()`, not from a hand-rolled formula.
- The GM style sync works through a hidden world setting that holds a snapshot of the GM's values. Players read from that snapshot instead of their own settings. It's a UI lock, not a security feature.
