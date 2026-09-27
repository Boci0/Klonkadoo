// ============================================================
// pixelIcons — tiny hand-drawn pixel icons, painted from string
// grids so they stay crisp at any integer scale.
//
//   partIcon(id)  – one icon per rig part (weapons each have their
//                   own shape; the rest share a shape per type)
//   uiIcon(name)  – currency / stat / reward icons for the DOM
//   iconCanvas()  – the same pixels as a canvas, for the battle view
//
// Grid letters: k ink outline, w white, y yellow, o orange, r red,
// R pink-red, p purple, q plum, c cyan, s sky, n navy, g lime,
// e green, l silver, d slate, t steel. Part grids also use
// a (part colour), h (its highlight) and b (its shadow).
// ============================================================

import { getPart, rarityColor } from '../meta/Mech.js';
import { torsoCanvas, legsCanvas } from './mechSprite.js';

const PAL = {
  k: '#1a1c2c', w: '#f4f4f4', y: '#ffcd75', o: '#ef7d57', r: '#b13e53', R: '#ff5d73',
  p: '#c46fd6', q: '#5d275d', c: '#73eff7', s: '#41a6f6', n: '#29366f', g: '#a7f070',
  e: '#38b764', l: '#94b0c2', d: '#566c86', t: '#333c57',
};

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (s) => {
    const v = (n >> s) & 255;
    return Math.max(0, Math.min(255, Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt))));
  };
  return `rgb(${f(16)}, ${f(8)}, ${f(0)})`;
}

// ---------- Part grids (12 wide) ----------

const WEAPON_GRIDS = {
  // Drones and modules: each its own look (modules share the chip shape)
  dr_gnat: [
    '............',
    '.kkk....kkk.',
    '..k......k..',
    '...kkkkkk...',
    '...kawwak...',
    '...kbbbbk...',
    '....kkkk....',
    '.....kk.....',
    '............',
  ],
  dr_hornet: [
    'kkk......kkk',
    'khhk....khhk',
    '.kkkkkkkkkk.',
    '.kaaaaaaaak.',
    'kkaRRaaRRakk',
    '.kbbbbbbbbk.',
    '..kkkkkkkk..',
    '....kyyk....',
    '.....kk.....',
  ],
  dr_medic: [
    'kkk......kkk',
    'khhk....khhk',
    '.kkkkkkkkkk.',
    '..kaaggaak..',
    '..kggggggk..',
    '..kaaggaak..',
    '..kbbbbbbk..',
    '...kkkkkk...',
    '............',
  ],
  dr_guardian: [
    'kkk......kkk',
    'khhk....khhk',
    '.kkkkkkkkkk.',
    '.khaaaaaahk.',
    '.kaacwwcaak.',
    '..kaacwaak..',
    '...kbbbbk...',
    '....kbbk....',
    '.....kk.....',
  ],
  dr_reaper: [
    '.kkkkkk.....',
    'kwwwwwwk....',
    '.kkkkkwwk...',
    '..kkkkkkwk..',
    '.kaaaaaak.k.',
    '.kaRaaRak...',
    '.kbbbbbbk...',
    '..kkkkkk....',
    '...k..k.....',
  ],
  dr_seraph: [
    '...kyyyyk...',
    '....kkkk....',
    'kw.kkkkkk.wk',
    'kww.kaak.wwk',
    '.kwwkaakwwk.',
    '..kkaRRakk..',
    '...kbbbbk...',
    '....kkkk....',
    '.....kk.....',
  ],
  md_physres: [
    '..k.k.k.k...',
    '.kkkkkkkkk..',
    'kkhhhhhhhbkk',
    '.khawwwwabk.',
    'kkhawllwabkk',
    '.khaawwaabk.',
    'kkhbbbbbbbkk',
    '.kkkkkkkkk..',
    '..k.k.k.k...',
  ],
  md_heatres: [
    '..k.k.k.k...',
    '.kkkkkkkkk..',
    'kkhhhhhhhbkk',
    '.khawwwwabk.',
    'kkhawooyabkk',
    '.khaawwaabk.',
    'kkhbbbbbbbkk',
    '.kkkkkkkkk..',
    '..k.k.k.k...',
  ],
  md_elecres: [
    '..k.k.k.k...',
    '.kkkkkkkkk..',
    'kkhhhhhhhbkk',
    '.khawwwwabk.',
    'kkhawccwabkk',
    '.khaawwaabk.',
    'kkhbbbbbbbkk',
    '.kkkkkkkkk..',
    '..k.k.k.k...',
  ],
  md_thermal: [
    '..k.k.k.k...',
    '.kkkkkkkkk..',
    'kkhhhhhhhbkk',
    '.khaoyacabk.',
    'kkhoyyccwbkk',
    '.khaoyacabk.',
    'kkhbbbbbbbkk',
    '.kkkkkkkkk..',
    '..k.k.k.k...',
  ],
  md_capacitor: [
    '..k.k.k.k...',
    '.kkkkkkkkk..',
    'kkhhhhhhhbkk',
    '.khkkkkkabk.',
    'kkhkccgkwbkk',
    '.khkkkkkabk.',
    'kkhbbbbbbbkk',
    '.kkkkkkkkk..',
    '..k.k.k.k...',
  ],
  wp_shredder: [
    '............',
    '..kkkkkkkk..',
    '.khhhhhhhhk.',
    '.kaaaaaaaalw',
    '.kalalalalk.',
    '.kbbbbkkkk..',
    '.kbbk.......',
    '.kkkk.......',
  ],
  wp_scorcher: [
    '............',
    '..kkkkkk....',
    '.khhhhhhkkk.',
    '.kaaaaaaaaoy',
    '.kbbbbbbkkk.',
    '..kbbk......',
    '..kbbk......',
    '..kkkk......',
  ],
  wp_ionizer: [
    '....kkk.....',
    '...kcwck....',
    '..kkkkkkkkk.',
    '.khhhhhhhhcw',
    '.kaaaaaaaakc',
    '.kbbbbkkkk..',
    '.kbbk.......',
    '.kkkk.......',
  ],
  md_target: [
    '..k.k.k.k...',
    '.kkkkkkkkk..',
    'kkhhhhhhhbkk',
    '.khawaawabk.',
    'kkhaaRRaabkk',
    '.khawaawabk.',
    'kkhbbbbbbbkk',
    '.kkkkkkkkk..',
    '..k.k.k.k...',
  ],
  md_servo: [
    '..k.k.k.k...',
    '.kkkkkkkkk..',
    'kkhhhhhhhbkk',
    '.khaakkaabk.',
    'kkhaakkaabkk',
    '.khakkkkabk.',
    'kkhbbbbbbbkk',
    '.kkkkkkkkk..',
    '..k.k.k.k...',
  ],
  md_bounty: [
    '..k.k.k.k...',
    '.kkkkkkkkk..',
    'kkhhhhhhhbkk',
    '.khaayyaabk.',
    'kkhayooyabkk',
    '.khaayyaabk.',
    'kkhbbbbbbbkk',
    '.kkkkkkkkk..',
    '..k.k.k.k...',
  ],
  md_battery: [
    '..k.k.k.k...',
    '.kkkkkkkkk..',
    'kkhhhhhhhbkk',
    '.khkkkkkabk.',
    'kkhkgggkwbkk',
    '.khkkkkkabk.',
    'kkhbbbbbbbkk',
    '.kkkkkkkkk..',
    '..k.k.k.k...',
  ],
  md_coolant: [
    '..k.k.k.k...',
    '.kkkkkkkkk..',
    'kkhhhhhhhbkk',
    '.khaaacaabk.',
    'kkhaacwcabkk',
    '.khaaacaabk.',
    'kkhbbbbbbbkk',
    '.kkkkkkkkk..',
    '..k.k.k.k...',
  ],
  md_amp: [
    '..k.k.k.k...',
    '.kkkkkkkkk..',
    'kkhhhhhhhbkk',
    '.khaaRRaabk.',
    'kkhaRRRRabkk',
    '.khaaRRaabk.',
    'kkhbbbbbbbkk',
    '.kkkkkkkkk..',
    '..k.k.k.k...',
  ],
  md_repair: [
    '..k.k.k.k...',
    '.kkkkkkkkk..',
    'kkhhhhhhhbkk',
    '.khaaggaabk.',
    'kkhggggggbkk',
    '.khaaggaabk.',
    'kkhbbbbbbbkk',
    '.kkkkkkkkk..',
    '..k.k.k.k...',
  ],
  md_heatsink: [
    '..k.k.k.k...',
    '.kkkkkkkkk..',
    'kkhhhhhhhbkk',
    '.khokokokbk.',
    'kkhokokokbkk',
    '.khkkkkkkbk.',
    'kkhbbbbbbbkk',
    '.kkkkkkkkk..',
    '..k.k.k.k...',
  ],
  md_generator: [
    '..k.k.k.k...',
    '.kkkkkkkkk..',
    'kkhhhhhhhbkk',
    '.khaaayaabk.',
    'kkhayyyaabkk',
    '.khaayaaabk.',
    'kkhbbbbbbbkk',
    '.kkkkkkkkk..',
    '..k.k.k.k...',
  ],
  md_range: [
    '..k.k.k.k...',
    '.kkkkkkkkk..',
    'kkhhhhhhhbkk',
    '.khaaaawabk.',
    'kkhwwwwwwbkk',
    '.khaaaawabk.',
    'kkhbbbbbbbkk',
    '.kkkkkkkkk..',
    '..k.k.k.k...',
  ],
  md_overclock: [
    '..k.k.k.k...',
    '.kkkkkkkkk..',
    'kkhhhhhhhbkk',
    '.khRaRaaabk.',
    'kkhaRaRaabkk',
    '.khRaRaaabk.',
    'kkhbbbbbbbkk',
    '.kkkkkkkkk..',
    '..k.k.k.k...',
  ],
  md_singularity: [
    '..k.k.k.k...',
    '.kkkkkkkkk..',
    'kkhhhhhhhbkk',
    '.khakqqkabk.',
    'kkhaqwwqabkk',
    '.khakqqkabk.',
    'kkhbbbbbbbkk',
    '.kkkkkkkkk..',
    '..k.k.k.k...',
  ],
  // Long-range pushers and specials
  wp_concussion: [
    '......kkkk..',
    '.....khhhhk.',
    '....khaaaak.',
    '...khaak.kw.',
    '..kbaak..lwl',
    '.kbbak....w.',
    'kbbbbk......',
    'kkkkkk......',
  ],
  wp_impact: [
    '............',
    'kkkkkkkkkk..',
    'khhhhhhhhhkk',
    'kaaaaaaaaawk',
    'kbbbbbbbbhkk',
    'kbbkkkkkkk..',
    'kbbk........',
    'kkkk........',
  ],
  sp_hook: [
    '.......kkk..',
    '......kwlk..',
    '.....kwk....',
    '....kwk.....',
    '...kak......',
    '..kaak..kk..',
    '.kbbbk.kwlk.',
    'kbbbbkkwk...',
    'kkkkkkkkk...',
  ],
  sp_charge: [
    '....kkkkk...',
    '...khhhhhk..',
    '..khaaaaak.y',
    'kkkaaaaaakoy',
    'khaaaaaaakoy',
    '.kbbbbbbk..y',
    '..kkkkkkk...',
  ],
  sp_ram: [
    '...kkkkkk...',
    '..khhhhhhk.y',
    '.khaaaaaaakoy',
    'kkkaaaaaaakoy',
    'khaaaaaaaakoy',
    '.kbbbbbbbk.oy',
    '..kkkkkkkk..y',
  ],
  sp_teleport: [
    '....kkkk....',
    '..kkwwwwkk..',
    '.kwaaaaaawk.',
    'kwaakkkkaawk',
    'kwaak..kaawk',
    '.kwaaaaaawk.',
    '..kkwwwwkk..',
    '....kkkk....',
  ],
  sp_shield: [
    '...kkkkkk...',
    '..khhhhhhk..',
    '.khaaaaaahk.',
    'khaaawwaaahk',
    'kaaaawwaaaak',
    '.kbaaaaaabk.',
    '..kbbbbbbk..',
    '...kkkkkk...',
  ],
  sp_aegis: [
    '..kkkkkkkk..',
    '.khhhhhhhhk.',
    'khaaawwaaahk',
    'kaaaawwaaaak',
    'kaawwwwwwaak',
    '.kbaawwaabk.',
    '..kbbbbbbk..',
    '...kkkkkk...',
  ],
  // Explosive / Electric specialists
  wp_blowtorch: [
    '..........y.',
    '.........yoy',
    '.kkkkkkkkoy.',
    'khhhhhhkkky.',
    'kaaaaaaaaak.',
    'kbbbkkkkkk..',
    'kbbk........',
    'kkkk........',
  ],
  wp_napalm: [
    '.......kkk..',
    '......khhhk.',
    '.....khaak.o',
    '....khaak.oy',
    '...kbaak..o.',
    '..kbbak.....',
    '.kbbbbk.....',
    'kkkkkkkk....',
  ],
  wp_rupturer: [
    '...kkkk.....',
    '..khhhhk....',
    'kkkaaaakkkkc',
    'khaaakaaaawc',
    'kbbbbkbbkkkc',
    '.kbbbbbbk...',
    '..kkkkkk....',
  ],
  wp_thermal: [
    '...........o',
    'kkkkkkkkkkoy',
    'khhhhhhhhhyw',
    'kaaaaaaaaaoy',
    'kbbbkkkkkkko',
    'kbbk........',
    'kkkk........',
  ],
  wp_meltdown: [
    '..kkkkkk....',
    '.khhhhhhkkkk',
    'khaayyaaaaaw',
    'kaayooyaaaak',
    'kbbayyabkkkk',
    '.kbbbbbbk...',
    '..kbbbbk....',
    '..kkkkkk....',
  ],
  wp_spark: [
    '..........w.',
    '.........wcw',
    '.kkkkkkk..w.',
    'khhhhhhhkc..',
    'kaaaaaaaak..',
    'kbbkkkkkk...',
    'kbbk........',
    'kkk.........',
  ],
  wp_leech: [
    '.........k.k',
    '..kkkkkkkckc',
    '.khhhhhhhk.k',
    'kawawawawak.',
    '.kbbbbbbbk..',
    '..kbbk......',
    '..kkkk......',
  ],
  wp_gridbreaker: [
    '..kkkkkkk...',
    '.khhhhhhhk..',
    'khaaywaaaakc',
    'kaaaywaaaak.',
    'kaayaaaaakc.',
    'kbbbbbbbbk..',
    '.kkkkkkkk...',
  ],
  wp_capdump: [
    '.kkkkkkkk...',
    'kwhhhhhhwk..',
    'kaaaaaaaakkc',
    'kaccaccaaawc',
    'kaaaaaaaakkc',
    'kbbbbbbbbk..',
    '.kkkkkkkk...',
  ],
  wp_blackout: [
    '.....kkkkk..',
    'kkkkkkhhhhkk',
    'khhhhhaaaaaw',
    'kaaaaaaaqqqk',
    'kbbbbbaaaaak',
    'kbbkkkkbbbkk',
    'kbbk........',
    'kkkk........',
  ],
  wp_blaster: [
    '............',
    '............',
    '...kkkkkkk..',
    '..khhhhhhhk.',
    '..kaaaaaaaaw',
    '..kbbbbbkkk.',
    '..kbbk......',
    '..kbbk......',
    '..kkkk......',
  ],
  wp_scatter: [
    '............',
    '.kkkkkkkkkk.',
    '.khhhhhhhhhk',
    '.kaaaaaaaaaw',
    '.khhhhhhhhhk',
    '.kbbbbkkkkk.',
    '.kbbk.......',
    '.kbk........',
    '.kk.........',
  ],
  wp_acid: [
    '..kkk.......',
    '.khaak......',
    '.kaaak......',
    '.kaaakkkkkk.',
    '.kbaakhhhhgk',
    '.kbaakkkkkk.',
    '.kbbak......',
    '..kkk.......',
  ],
  wp_rifle: [
    '............',
    '............',
    'kkkkkkkkkkkk',
    'khhhhhhhhhhw',
    'kbbbkkkkkkkk',
    'kbbk........',
    'kkk.........',
  ],
  wp_flamer: [
    '.........y..',
    '.......yoy..',
    'kkkkkkkoyoy.',
    'khhhhhkoyyoy',
    'kaaaaakoyoy.',
    'kbbbkkk.yo..',
    'kbbk.....y..',
    'kkk.........',
  ],
  wp_mortar: [
    '.........kk.',
    '........khhk',
    '.......khak.',
    '......khak..',
    '.....khak...',
    '....khak....',
    '...kbak.....',
    '..kbbbk.....',
    '.kbbbbbk....',
    'kkkkkkkkk...',
  ],
  wp_cryo: [
    '.........w..',
    '........wcw.',
    'kkkkkkk..w..',
    'khhhhhhkkkkk',
    'kaaaaaaaaaac',
    'kbbbbbbkkkkk',
    'kbbk........',
    'kkkk........',
  ],
  wp_tesla: [
    '....kkkk....',
    '...kwwwwk...',
    '....kkkk....',
    '...khhhhk...',
    '....kkkk....',
    '...kaaaak...',
    '....kkkk....',
    '...kaaaak...',
    '..kbbbbbbk..',
    '..kkkkkkkk..',
  ],
  wp_missiles: [
    '..kkkkkkk...',
    '.khhhhhhhk..',
    '.kakakakak..',
    '.khhhhhhhk..',
    '.kakakakak..',
    '.kbbbbbbbk..',
    '..kkkkkkk...',
  ],
  wp_rail: [
    '............',
    'kk..........',
    'khkkkkkkkkkk',
    'kaawawawaaaw',
    'kbkkkkkkkkkk',
    'kk..........',
  ],
  wp_howitzer: [
    '..kkkkkkkkkk',
    '.khhhhhhhhhw',
    '.kaaaaaaaaak',
    '.kbbbbbkkkkk',
    '.kkbbbk.....',
    '.kbkkkbk....',
    'kbwbkbwbk...',
    '.kbk.kbk....',
  ],
  wp_nova: [
    '....kk......',
    '...khhk.....',
    'kkkkhwhkkkkk',
    'kaaawwwaaaaw',
    'kbbkbwbkkkkk',
    '...kbbk.....',
    '....kk......',
  ],
  wp_smg: [
    '............',
    '.kkkkkkkkk..',
    '.khhhhhhhhkw',
    '.kaaaaaaaaaw',
    '.kbbkbbkkk..',
    '.kbbkkbk....',
    '..kk.kbk....',
    '......kk....',
  ],
  wp_repulsor: [
    '.......kkk..',
    '......khhhk.',
    'kkkkkkkaaawk',
    'khhhhhkaawwk',
    'kaaaaakaaawk',
    'kbbbkkkbbbk.',
    'kbbk...kkk..',
    'kkk.........',
  ],
  wp_beam: [
    '............',
    '..kkkkk.....',
    '.khhhhhkkkk.',
    'kaaaaaaaaawR',
    '.kbbbbbkkkk.',
    '..kbbk......',
    '..kkkk......',
  ],
  wp_emp: [
    '....kkkk....',
    '..kkhhhhkk..',
    '.khaawwaahk.',
    '.kaawkkwaak.',
    '.kaawkkwaak.',
    '.kbaawwaabk.',
    '..kkbbbbkk..',
    '....kbbk....',
    '...kkkkkk...',
  ],
  wp_grapple: [
    '.........kk.',
    '........kwlk',
    'kkkkkkkkkllk',
    'khhhhhhhk.k.',
    'kaaaaaaak...',
    'kbbbkkkk....',
    'kbbk........',
    'kkk.........',
  ],
  wp_minelauncher: [
    '............',
    '.kkkkkkk....',
    'khhhhhhhk.kk',
    'kaaaaaaaakook',
    'kbbbbbbbk.kk',
    'kbbkkkkk....',
    'kbbk........',
    'kkkk........',
  ],
  wp_rocket: [
    '............',
    'kkkkkkkkkk..',
    'khhhhhhhhhkk',
    'kaaaaaaaaooy',
    'kbbbbbbbbhkk',
    'kkkbbkkkkk..',
    '..kbbk......',
    '..kkkk......',
  ],
  wp_heatray: [
    '..........o.',
    '.kkkkkk..oyo',
    'khhhhhhkkkoy',
    'kaaaaaaaaaay',
    'kbbbbbbkkkoy',
    'kbbk.....oyo',
    'kkkk......o.',
  ],
  wp_sniper: [
    '...kkk......',
    '...khk......',
    'kkkkkkkkkkkk',
    'khhhhhhhhhhw',
    'kaaaaakkkkkk',
    'kbbbk.......',
    'kbbk........',
    'kkk.........',
  ],
  wp_scythe: [
    '...kkkkkk...',
    '..khhhhhhk..',
    '.kaakkkkaak.',
    '.kak....kk..',
    '..kk.kk.....',
    '....kbk.....',
    '.....kbk....',
    '......kbk...',
    '.......kbk..',
    '........kk..',
  ],
};

const TYPE_GRIDS = {
  frame: [
    '....kkkk....',
    '...khhhhk...',
    'kkkkaaaakkkk',
    'khhkawwakhhk',
    'kbbkaaaakbbk',
    'kkkkbbbbkkkk',
    '...kbkkbk...',
    '..kbbk.kbbk.',
    '..kkkk.kkkk.',
  ],
  legs: [
    '...kkkkkk...',
    '..khhhhhhk..',
    '..kaaaaaak..',
    '..kbkkkkbk..',
    '.khk....khk.',
    '.kak....kak.',
    'khak....kahk',
    'kbk......kbk',
    'kbbk....kbbk',
    'kkkkk..kkkkk',
  ],
  armor: [
    '.kkkkkkkkkk.',
    'khhhhhhhhhhk',
    'khaaaaaaaabk',
    'khaaawwaaabk',
    'khaaawwaaabk',
    '.kaaaaaaabk.',
    '.kbaaaaaabk.',
    '..kbaaaabk..',
    '...kbbbbk...',
    '....kkkk....',
  ],
  drone: [
    'kkk......kkk',
    'khhk....khhk',
    '.kkkkkkkkkk.',
    '..kaaaaaak..',
    '..kawwwwak..',
    '..kaaaaaak..',
    '..kbbbbbbk..',
    '...kkkkkk...',
    '....k..k....',
  ],
  module: [
    '..k.k.k.k...',
    '.kkkkkkkkk..',
    'kkhhhhhhhbkk',
    '.khaaaaaabk.',
    'kkhawwwwabkk',
    '.khaaaaaabk.',
    'kkhbbbbbbbkk',
    '.kkkkkkkkk..',
    '..k.k.k.k...',
  ],
};

// ---------- UI grids (8-10 wide) ----------

const UI_GRIDS = {
  gold: ['..kkkk..', '.kyyyyk.', 'kyywyyok', 'kywyyyok', 'kyyyyyok', 'kyyyyook', '.kooook.', '..kkkk..'],
  hp: ['.kk..kk.', 'kRRkkRRk', 'kRwRRRRk', 'kRRRRRRk', '.kRRRrk.', '..kRrk..', '...kk...'],
  key: ['.kkk......', 'kyyyk.....', 'kywykkkkkk', 'kyyyyyyyyk', 'kyyykkykyk', '.kkk..k.k.'],
  scrap: ['..k..k..', '.kkkkkk.', 'kklllldk', '.klkkdk.', '.klkkdk.', 'kkldddkk', '.kkkkkk.', '..k..k..'],
  skull: ['.kkkkkk.', 'kwwwwwwk', 'kwkwwkwk', 'kwkwwkwk', 'kwwwwwwk', '.kwkkwk.', '.kwwwwk.', '..kkkk..'],
  dmg: ['......kk', '.....kwk', '....kwk.', '.k.kwk..', '.kkwk...', '..kk....', '.kokk...', 'kok.....'],
  def: ['kkkkkkkk', 'kssssssk', 'ksswssnk', 'ksswssnk', '.ksssnk.', '..ksnk..', '...kk...'],
  range: ['...kk...', '..kRRk..', '.kk..kk.', 'kRk..kRk', 'kRk..kRk', '.kk..kk.', '..kRRk..', '...kk...'],
  cd: ['kkkkkkkk', 'kwwwwwwk', '.kyyyyk.', '..kyyk..', '..kyyk..', '.kwyywk.', 'kyyyyyyk', 'kkkkkkkk'],
  load: ['..kkkk..', '.k....k.', '.kkkkkk.', 'kllllllk', 'klwllldk', 'kllllldk', 'kddddddk', '.kkkkkk.'],
  gun: ['........', 'kkkkkkk.', 'klllllwk', 'kddddkk.', 'kddk....', 'kkk.....'],
  star: ['...kk...', '..kyyk..', 'kkkyykkk', 'kyyyyyyk', '.kyyyok.', '.kyokyk.', 'kyk..kok', 'kk....kk'],
  book: ['kkkkkkk.', 'kssswwwk', 'ksswkkwk', 'kssswwwk', 'ksswkkwk', 'kssswwwk', 'kssssssk', 'kkkkkkkk'],
  heal: ['..kkk...', '..kgk...', 'kkkgkkk.', 'kgggggk.', 'kkkgkkk.', '..kgk...', '..kkk...'],
  move: ['...kk...', '..kgek..', '.kggeek.', 'kkkgekkk', '..kgek..', '..kgek..', '..kkkk..'],
  energy: ['....kkk.', '...kcck.', '..kcck..', '.kccckk.', 'kkkccck.', '..kcck..', '.kcck...', '.kkk....'],
  heat: ['...k....', '..kok...', '..koyk..', '.koyyok.', 'koyywyok', 'koywwyok', '.koyyok.', '..kkkk..'],
  ammo: ['.k...k..', 'kyk.kyk.', 'kyk.kyk.', 'kok.kok.', 'kok.kok.', 'kdk.kdk.', 'kkk.kkk.'],
  lock: ['..kkkk..', '.kllllk.', '.kk..kk.', 'kyyyyyyk', 'kyykkyok', 'kyykkyok', 'kyyyyook', 'kkkkkkkk'],
  top: ['...kk...', '..kwwk..', '.kwwwwk.', 'kkkwwkkk', '..kwwk..', 'kkkkkkkk', 'klllllld', 'kkkkkkkk'],
  side: ['kkk.k...', 'kldkwk..', 'kldkwwk.', 'kldwwwwk', 'kldkwwk.', 'kldkwk..', 'kkk.k...'],
  stomp: ['.kkkk...', '.kllk...', '.kllk...', '.klldkk.', 'kllllllk', 'kddddddk', 'kkkkkkkk'],
  backfire: ['..k..k..', '.kRkkRk.', 'kRwRRwRk', '.kRwwRk.', '.kRwwRk.', 'kRwRRwRk', '.kRkkRk.', '..k..k..'],
  resdrain: ['kkkkkkkk', 'kssssssk', 'kswwwwsk', 'kssssssk', '.ksssnk.', '..ksnk..', '...kk...'],
  drain: ['...kkk..', '..kcck..', '.kcck...', 'kccccck.', '..kcck..', '.kkkkkkk', '..kRRRk.', '...kRk..'],
  push: ['k...k...', 'kk..kk..', 'kwk.kwk.', 'kwwkkwwk', 'kwk.kwk.', 'kk..kk..', 'k...k...'],
  pull: ['...k...k', '..kk..kk', '.kwk.kwk', 'kwwkkwwk', '.kwk.kwk', '..kk..kk', '...k...k'],
  pierce: ['.....k..', '.....kk.', 'kkkkkkwk', 'kwwwwwwk', 'kkkkkkwk', '.....kk.', '.....k..'],
  arc: ['..kkk...', '.k...k..', 'k.....k.', 'k.....k.', 'k......k', 'yk.....y', 'yy....yy'],
  regen: ['..kkkk..', '.kcccck.', 'kck..kk.', 'kck.kcck', 'kck..kk.', 'kck.....', '.kcccck.', '..kkkk..'],
  cool: ['...k....', '.k.k.k..', '..kck...', 'kkcwckk.', '..kck...', '.k.k.k..', '...k....'],
  auto: ['.kkkkkk.', 'kwwwwwwk', 'kwkwwkwk', 'kwwwwwwk', 'kwkkkkwk', 'kwwwwwwk', '.kkkkkk.', '..k..k..'],
  pod: [
    '....kkkkkk....',
    '...khhhhhhk...',
    '..khaaaaaabk..',
    '.khawwaaaaabk.',
    '.kaawaaaaaabk.',
    'kkkkkkkkkkkkkk',
    'kyykyykyykyykk',
    'kkkkkkkkkkkkkk',
    '.kaaaaaaaaabk.',
    '.kaaaaaaaaabk.',
    '.kbaaaaaaabbk.',
    '..kbbbbbbbbk..',
    '..kk......kk..',
    '.kkk......kkk.',
  ],
};

// ---------- Painting ----------

function paint(grid, colors) {
  const h = grid.length;
  const w = Math.max(...grid.map((r) => r.length));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      const col = colors[grid[y][x]] || PAL[grid[y][x]];
      if (!col) continue;
      g.fillStyle = col;
      g.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

/** Plating modules show as plating on a steel torso, like the mech wears it. */
const PLATING = new Set(['md_plating', 'md_heavyplate', 'md_composite', 'md_aegis', 'md_titanplate', 'md_voidcore']);

const canvasCache = new Map();
const urlCache = new Map();

/** Canvas with a part's icon (for drawing into other canvases). */
export function partCanvas(id, colorOverride) {
  const key = `p:${id}:${colorOverride || ''}`;
  if (!canvasCache.has(key)) {
    const p = getPart(id);
    const base = colorOverride || p?.color || rarityColor(p?.rarity);
    // Frames, legs and plating use the same sprites the mech wears in battle
    if (p?.type === 'frame') canvasCache.set(key, torsoCanvas(id, null, base, shade(base, -0.45)));
    else if (p?.type === 'legs') canvasCache.set(key, legsCanvas(id, base, shade(base, -0.45)));
    else if (PLATING.has(id)) canvasCache.set(key, torsoCanvas('fr_brawler', id, '#566c86', '#333c57')); // plating on a steel torso
    else {
      const grid = WEAPON_GRIDS[id] || WEAPON_GRIDS[p?.icon] || TYPE_GRIDS[p?.type] || TYPE_GRIDS.module;
      canvasCache.set(key, paint(grid, { a: base, h: shade(base, 0.45), b: shade(base, -0.45) }));
    }
  }
  return canvasCache.get(key);
}

/** Data URL of a part's icon, for <img>. */
export function partIcon(id, colorOverride) {
  const key = `p:${id}:${colorOverride || ''}`;
  if (!urlCache.has(key)) urlCache.set(key, partCanvas(id, colorOverride).toDataURL());
  return urlCache.get(key);
}

/** Canvas for a UI icon; `tint` recolours a pod (a/h/b letters). */
export function iconCanvas(name, tint = '#94b0c2') {
  const key = `u:${name}:${tint}`;
  if (!canvasCache.has(key)) {
    canvasCache.set(key, paint(UI_GRIDS[name] || UI_GRIDS.star, { a: tint, h: shade(tint, 0.45), b: shade(tint, -0.45) }));
  }
  return canvasCache.get(key);
}

export function uiIcon(name, tint) {
  const key = `u:${name}:${tint || ''}`;
  if (!urlCache.has(key)) urlCache.set(key, iconCanvas(name, tint).toDataURL());
  return urlCache.get(key);
}

/** Inline <img> for a UI icon, sized by CSS class `pxi`. */
export const ico = (name, tint) => `<img class="pxi" src="${uiIcon(name, tint)}" alt="">`;
