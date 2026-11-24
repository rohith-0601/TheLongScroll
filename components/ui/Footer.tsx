/** The one-line footer (SITE.footer) and a way back to the beginning. Server component. */
import { SITE } from '@/data/chapters';
import BackToTop from './BackToTop';

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <p className="footer-line">{SITE.footer}</p>
        <BackToTop />
      </div>
    </footer>
  );
}
