/**
 * Page shell (server component). DOM contract (lib/scroll.ts):
 *   [data-scroll-track] > [data-scroll-stage] > section[data-intro] + 9 × article[data-chapter][id],
 *   then section[data-frontier]#frontier.
 * The scene is a fixed, decorative, client-only layer behind everything; the fixed chrome (wordmark,
 * sound, year counter, chapter rail) sits above the text. All copy comes from data/*.
 */
import { CHAPTERS } from '@/data/chapters';
import SceneRoot from '@/components/scene/SceneRoot';
import ExperienceController from '@/components/system/ExperienceController';
import SkipLink from '@/components/ui/SkipLink';
import Chrome from '@/components/ui/Chrome';
import Intro from '@/components/ui/Intro';
import ChapterText from '@/components/ui/ChapterText';
import Frontier from '@/components/ui/Frontier';
import Footer from '@/components/ui/Footer';
import Loader from '@/components/ui/Loader';

export default function Page() {
  return (
    <>
      <Loader />
      <SkipLink />
      <div className="pointer-events-none fixed inset-0 z-0" aria-hidden="true"><SceneRoot /></div>
      <Chrome />
      <main className="relative z-10">
        <div data-scroll-track>
          <div data-scroll-stage data-hold-dim>
            <Intro />
            {CHAPTERS.map((c, i) => (
              <ChapterText key={c.id} index={i} />
            ))}
          </div>
        </div>
        <Frontier />
      </main>
      <Footer />
      <ExperienceController />
    </>
  );
}
