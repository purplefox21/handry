// The app's name in one place. What the user sees (Handry), what the fox on
// the screen is called and answers to ("Hey Foxie", "Hey Fox"), and the
// Turkish endings the name takes ("Handry'ye söyle", "Handry'den çık").
// Pages get it from the server, Swift from Info.plist (app/macos/build.js
// writes it there), the voice code from WAKE_VARIANTS. Inside, the project
// keeps its own name (JEVIS: ~/.jevis, the Keychain service "jevis").
export const APP_NAME = 'Handry';
/** How the name is said, for its Turkish endings: "Hendri" → Handry'ye, Handry'nin. */
export const APP_SOUND = 'hendri';
export const FOX_NAME = 'Foxie';
export const WAKE_LABEL = 'Hey Foxie';
/** The MCP server's name: Claude sessions see the tools as mcp__handry__… (handry_do, handry_teach). */
export const MCP_NAME = 'handry';

/** How the speech recognizer may write the fox's name after "hey" (lower case). */
export const WAKE_VARIANTS = ['foxie', 'foxy', 'foxi', 'foksi', 'foksy', 'foksie', 'fogsi', 'fuksi', 'focsi', 'fox', 'foks'];
/**
 * The app's own name wakes it too, with or without "hey" (with "Inaro" the
 * Turkish recognizer heard the name alone far better than after "hey").
 * Not tried with a voice yet for Handry (the user: "sesi sonra ayarlarız").
 */
export const NAME_VARIANTS = ['handry', 'handri', 'hendri', 'hendry', 'henri', 'henry'];

/** "hey foxie, …" / "handry, …" at the start of what was heard (the same pattern runs in Listener.swift). */
const HEY = '(?:hey|hei|hay|hi|ey|ay|he)[\\s,.!]*';
export const WAKE_SOURCE = `^\\s*(?:${HEY}(?:${WAKE_VARIANTS.join('|')})|(?:${HEY})?(?:${NAME_VARIANTS.join('|')}))(?![\\p{L}\\p{N}])[\\s,.!?:;-]*`;

const VOWELS = 'aeıioöuü';

/** Turkish case endings for a name, by vowel harmony on how it sounds: Handry ("hendri") → Handry'ye, Handry'yi, Handry'nin, Handry'den, Handry'de. */
export function forms(name, sound = name) {
  const lower = sound.toLocaleLowerCase('tr');
  const vowel = [...lower].reverse().find(c => VOWELS.includes(c)) || 'e';
  const back = 'aıou'.includes(vowel);
  const four = { a: 'ı', ı: 'ı', o: 'u', u: 'u', e: 'i', i: 'i', ö: 'ü', ü: 'ü' }[vowel];
  const two = back ? 'a' : 'e';
  const last = lower.at(-1);
  const afterVowel = VOWELS.includes(last);
  const hard = 'fstkçşhp'.includes(last);
  return {
    name,
    dative: `${name}'${afterVowel ? 'y' : ''}${two}`,
    accusative: `${name}'${afterVowel ? 'y' : ''}${four}`,
    genitive: `${name}'${afterVowel ? 'n' : ''}${four}n`,
    ablative: `${name}'${hard ? 't' : 'd'}${two}n`,
    locative: `${name}'${hard ? 't' : 'd'}${two}`
  };
}

export const APP = forms(APP_NAME, APP_SOUND);
export const FOX = forms(FOX_NAME);
