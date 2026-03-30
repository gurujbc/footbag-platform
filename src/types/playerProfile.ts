/**
 * Shared types for player profile views (history detail, member profile, public profile).
 * All three views render the same entity -- a footbag player -- at different access levels.
 */

export interface PlayerResultEntry {
  disciplineName: string | null;
  disciplineCategory: string | null;
  teamType: string | null;
  placement: number;
  scoreText: string | null;
  teammates: { name: string; playerHref?: string }[];
}

export interface PlayerEventGroup {
  eventKey: string;
  eventHref: string;
  eventTitle: string;
  startDate: string;
  city: string;
  eventRegion: string | null;
  eventCountry: string;
  results: PlayerResultEntry[];
}

export interface PlayerHeroData {
  displayName: string;
  honorificNickname?: string;
  isHof: boolean;
  isBap: boolean;
  hofInductionYear?: number;
  bapInductionYear?: number;
  historicalPersonName?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  isHistoricalOnly: boolean;
}
