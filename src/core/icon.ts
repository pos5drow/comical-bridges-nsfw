/**
 * Bridge icons live in this repo (`icons/{build id}.png`, 256 px), served from GitHub: a site's own
 * favicon is often tiny, missing, or behind the same anti-bot check as the site, and the app loads
 * icons directly, without the bridge's session.
 */
const ICONS = "https://raw.githubusercontent.com/pos5drow/comical-bridges-nsfw/main/icons";

/** The icon for the bridge whose build id (or `pos5drow.`-prefixed id) is `name`. */
export function bridgeIcon(name: string): string {
  return `${ICONS}/${name.replace(/^pos5drow\./, "")}.png`;
}
