import { eventService, PublicEventSummary } from './eventService';
import { SeoMeta } from '../types/page';

interface HomeHeroMedia {
  kind: 'image' | 'video' | 'youtube';
  src: string;
  alt?: string;
  posterSrc?: string;
  caption?: string;
}

interface HomeHero {
  heading: string;
  subheading?: string;
  media?: HomeHeroMedia;
}

interface HomePrimaryLink {
  label: string;
  href: string;
  description: string;
  variant?: 'primary' | 'outline';
}

interface HomeFeaturePanel {
  heading: string;
  body: string;
  href?: string;
  ctaLabel?: string;
}

interface HomeComingSoonSection {
  heading: string;
  body: string;
}

export interface HomePageViewModel {
  seo: SeoMeta;
  page: {
    sectionKey: 'home';
    pageKey: 'home_index';
    title: string;
    intro: string;
    notice?: string;
  };
  hero: HomeHero;
  primaryLinks: HomePrimaryLink[];
  featuredUpcomingEvents?: PublicEventSummary[];
  featurePanels?: HomeFeaturePanel[];
  comingSoonSections?: HomeComingSoonSection[];
}

export const homeService = {
  getPublicHomePage(nowIso: string): HomePageViewModel {
    return {
      seo: { title: '' },
      page: {
        sectionKey: 'home',
        pageKey: 'home_index',
        title: 'Footbag Worldwide',
        intro: 'The home of footbag sports and recreational "Hacky Sack."',
      },
      hero: {
        heading: 'Footbag Worldwide',
        subheading: 'The home of footbag sports and recreational "Hacky Sack."',
      },
      primaryLinks: [
        {
          label: 'Events',
          href: '/events',
          description: 'Browse competitive results from tournaments around the world.',
        },
        {
          label: 'Members',
          href: '/members',
          description: 'Member profiles, competitive history, and community features.',
        },
        {
          label: 'Clubs',
          href: '/clubs',
          description: 'Find clubs near you and around the world.',
        },
      ],
      featuredUpcomingEvents: eventService.listPublicUpcomingEvents(nowIso).slice(0, 3),
    };
  },
};
