// The app's name in one place. What the user sees (Inaro), what the fox on
// the screen is called and answers to ("Hey Foxie", "Hey Fox"), and the
// Turkish endings the name takes ("Inaro'ya söyle", "Inaro'dan çık").
// Pages get it from the server, Swift from Info.plist (app/macos/build.js
// writes it there), the voice code from WAKE_VARIANTS. Inside, the project
// keeps its own name (JEVIS: ~/.jevis, the Keychain service "jevis").
export const APP_NAME = 'Inaro';
export const FOX_NAME = 'Foxie';
export const WAKE_LABEL = 'Hey Foxie';
/** The MCP server's name: Claude sessions see the tools as mcp__inaro__…. */
export const MCP_NAME = 'inaro';

/** How the speech recognizer may write the fox's name after "hey" (lower case). */
export const WAKE_VARIANTS = ['foxie', 'foxy', 'foxi', 'foksi', 'foksy', 'foksie', 'fogsi', 'fuksi', 'focsi', 'fox', 'foks'];
/**
 * The app's own name wakes it too, with or without "hey": the Turkish
 * recognizer turns "Hey Inaro" into "Hayır", "Hey Mero" or "Hüseyin", but
 * hears "Inaro, sesi kıs" well (tried with the Yelda voice, 2026-10-01).
 */
export const NAME_VARIANTS = ['inaro', 'ınaro', 'i̇naro', 'İnaro'];

/** "hey foxie, …" / "inaro, …" at the start of what was heard (the same pattern runs in Listener.swift). */
const HEY = '(?:hey|hei|hay|hi|ey|ay|he)[\\s,.!]*';
export const WAKE_SOURCE = `^\\s*(?:${HEY}(?:${WAKE_VARIANTS.join('|')})|(?:${HEY})?(?:${NAME_VARIANTS.join('|')}))(?![\\p{L}\\p{N}])[\\s,.!?:;-]*`;

const VOWELS = 'aeıioöuü';

/** Turkish case endings for a name, by vowel harmony: Inaro → Inaro'ya, Inaro'yu, Inaro'nun, Inaro'dan, Inaro'da. */
export function forms(name) {
  const lower = name.toLocaleLowerCase('tr');
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

export const APP = forms(APP_NAME);
export const FOX = forms(FOX_NAME);
