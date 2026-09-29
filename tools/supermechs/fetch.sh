#!/bin/sh
# Downloads the SuperMechs Reloaded item data (every item at every level) into tools/supermechs/data
# (gitignored, ~7 MB). Source: https://supermechs.netlify.app/supermechs-post-reloaded-items-list.html
cd "$(dirname "$0")" && mkdir -p data
for f in drone torso leg sideWeapon topWeapon special module; do
  curl -sL -o "data/sm_item_$f.js" "https://supermechs.netlify.app/js/sm_item_$f.js"
done
ls -la data
