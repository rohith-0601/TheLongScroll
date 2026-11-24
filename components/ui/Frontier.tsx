/**
 * "The frontier": after chapter 9 the stage releases and this normal section scrolls in over the
 * living scene. 22 link cards from data/frontier.ts (name, studio when known, domain), each opening
 * in a new tab. Server component; the pointer spotlight is a tiny client enhancement.
 */
import { SITE } from '@/data/chapters';
import { FRONTIER_SITES, displayDomain } from '@/data/frontier';
import FrontierSpotlight from './FrontierSpotlight';
import { splitLastWord } from './split';

const pad2 = (n: number): string => String(n).padStart(2, '0');

function Arrow() {
  return (
    <svg className="card-arrow" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="M4.5 11.5 11.5 4.5M6 4.5h5.5V10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Frontier() {
  const [head, last] = splitLastWord(SITE.frontierTitle);
  return (
    <section data-frontier id="frontier" className="frontier" aria-labelledby="frontier-title" tabIndex={-1}>
      <div className="frontier-inner">
        <header className="frontier-head">
          <h2 id="frontier-title" className="frontier-title">
            {head}
            <em>{last}</em>
          </h2>
          <p className="frontier-intro">{SITE.frontierIntro}</p>
        </header>
        <ol className="frontier-grid" data-spotlight>
          {FRONTIER_SITES.map((site, i) => (
            <li key={site.url} className="frontier-item">
              <a className="card" href={site.url} target="_blank" rel="noopener noreferrer">
                <span className="card-top" aria-hidden="true">
                  <span className="card-index">{pad2(i + 1)}</span>
                  <Arrow />
                </span>
                <span className="card-name">{site.name}</span>{' '}
                {site.studio ? <span className="card-studio">{site.studio}</span> : null}{' '}
                <span className="card-domain">{displayDomain(site.url)}</span>
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </li>
          ))}
        </ol>
      </div>
      <FrontierSpotlight />
    </section>
  );
}
