import { PublicEventSummary } from './eventService';
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
        media: {
          kind: 'youtube',
          src: 'euLrL1zCvVQ',
          alt: '43rd IFPA World Footbag Championships, Montréal 2024, official video',
          caption: '43rd IFPA World Footbag Championships, Montréal 2024 (official video).',
        },
      },
      primaryLinks: [
        {
          label: 'Events',
          href: '/events',
          description: 'Find upcoming events, or browse competitive results from tournaments.',
        },
        {
          label: 'Clubs',
          href: '/clubs',
          description: 'Find clubs near you and around the world.',
        },
        {
          label: 'Members',
          href: '/members',
          description: 'Manage your profile and participate in the footbag community.',
        },
        {
          label: 'Freestyle',
          href: '/freestyle',
          description: 'Tricks, combos, and choreographed routines set to music.',
        },
      ],
      comingSoonSections: [
        { heading: 'Net', body: 'Fast-paced volleyball-style play over a 5-foot net.' },
        { heading: 'Records', body: 'Consecutive kicks world records, highest scores, and milestones.' },
        { heading: 'Media Gallery', body: 'Browse photos and videos by hashtag, member, event, and club galleries.' },
        { heading: 'Sideline Events', body: 'Golf, 2-Square, 4-Square, Consecutive Kicks, and Circle Kicking (old-school Hack).' },
        { heading: 'Tutorials', body: 'Rules, how-to guides, and reference material for all levels.' },
      ],
    };
  },
};