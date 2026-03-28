export interface SeoMeta {
  title: string;
  description?: string;
}

export interface PageMeta {
  sectionKey: string;
  pageKey: string;
  title: string;
  eyebrow?: string;
  intro?: string;
  notice?: string;
}

export interface NavLink {
  label: string;
  href: string;
}

export interface BreadcrumbLink {
  label: string;
  href?: string;
}

export interface ContextLink extends NavLink {
  variant?: 'primary' | 'outline';
}

export interface SiblingNav {
  previous?: NavLink;
  next?: NavLink;
}

export interface NavigationMeta {
  breadcrumbs?: BreadcrumbLink[];
  siblings?: SiblingNav;
  contextLinks?: ContextLink[];
}

export interface PageViewModel<TContent = Record<string, unknown>> {
  seo: SeoMeta;
  page: PageMeta;
  navigation?: NavigationMeta;
  content: TContent;
}
