/**
 * The 22 sites shown in "The frontier". Single source of truth; URLs are kept exactly as provided.
 * `studio` is only set where it is known. `domain` is derived from the URL for display.
 */

export interface FrontierSite {
  name: string;
  studio?: string;
  url: string;
}

export const FRONTIER_SITES: readonly FrontierSite[] = [
  { name: 'Igloo Inc', studio: 'abeto', url: 'https://www.igloo.inc/' },
  { name: 'Messenger', studio: 'abeto', url: 'https://messenger.abeto.co/' },
  { name: 'Oryzo AI', studio: 'Lusion', url: 'https://oryzo.ai/' },
  { name: 'Bruno Simon’s Portfolio', url: 'https://bruno-simon.com/' },
  { name: 'GQ & AP: The Extraordinary Lab', studio: 'Immersive Garden', url: 'https://www.awwwards.com/sites/gq-ap-the-extraordinary-lab' },
  { name: 'Santioni Spirits: The Notturno Experience', studio: 'Active Theory', url: 'https://www.awwwards.com/sites/santioni-spirits' },
  { name: 'Cartier Watches & Wonders 2026', studio: 'Immersive Garden', url: 'https://www.cartier.com/en-fr/watchesandwonders' },
  { name: 'Three.js Paris conference', url: 'https://threejs.paris' },
  { name: 'Lacoste Polo Factory', studio: 'Merci Michel', url: 'https://www.awwwards.com/sites/lacoste-polo-factory' },
  { name: 'Lacoste Ace Breaker', url: 'https://members-play.lacoste.com/ace-breaker-rg/gb/en/' },
  { name: 'Explore Primland', url: 'https://explore.ownprimland.com/' },
  { name: 'IVRESS', url: 'https://brand.ivress.co.jp/' },
  { name: 'Hubtown', studio: 'Unseen Studio', url: 'https://hubtown.co.in/' },
  { name: 'Shopify Editions Spring ’26', url: 'https://www.shopify.com/editions/spring2026' },
  { name: 'Iventions', url: 'https://iventions.com/' },
  { name: 'EnduroSat Space Service', url: 'https://www.endurosat.com/space-service' },
  { name: 'Vectr', studio: 'Utsubo', url: 'https://www.utsubo.com/blog/vectr-ai-startup-branding-case-study' },
  { name: 'Dragonfly', studio: 'Studio Freight', url: 'https://dragonfly.xyz' },
  { name: 'Moto Finance', studio: 'Properly Studio', url: 'https://www.awwwards.com/sites/moto-finance' },
  { name: 'Sleep Well Creative', url: 'https://sleep-well-creatives.com/' },
  { name: 'Hiroto Sato', url: 'https://www.awwwards.com/sites/hiroto-sato' },
  { name: 'Noomo: The Power of Storytelling', url: 'https://www.awwwards.com/noomoagency/' },
] as const;

/** Display domain: hostname without a leading "www." (e.g. "awwwards.com", "messenger.abeto.co"). */
export function displayDomain(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '');
}
