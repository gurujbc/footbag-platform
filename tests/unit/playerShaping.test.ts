import { describe, it, expect } from 'vitest';
import { groupPlayerResults, PlayerResultRow } from '../../src/services/playerShaping';

function makeRow(overrides: Partial<PlayerResultRow> = {}): PlayerResultRow {
  return {
    event_id:                 'evt-1',
    event_title:              'Test Event',
    start_date:               '2025-06-01',
    city:                     'Portland',
    event_region:             'Oregon',
    event_country:            'US',
    event_tag_normalized:     '#event_2025_test',
    discipline_name:          'Freestyle',
    discipline_category:      'freestyle',
    team_type:                'singles',
    placement:                1,
    score_text:               null,
    participant_display_name: 'Alice',
    participant_person_id:    'person-alice',
    participant_member_slug:  null,
    ...overrides,
  };
}

describe('groupPlayerResults', () => {
  it('returns empty array for empty input', () => {
    expect(groupPlayerResults([], {})).toEqual([]);
  });

  it('groups a single row into one event with one result', () => {
    const rows = [makeRow()];
    const result = groupPlayerResults(rows, {});

    expect(result).toHaveLength(1);
    expect(result[0].eventKey).toBe('event_2025_test');
    expect(result[0].eventHref).toBe('/events/event_2025_test');
    expect(result[0].eventTitle).toBe('Test Event');
    expect(result[0].results).toHaveLength(1);
    expect(result[0].results[0].placement).toBe(1);
    expect(result[0].results[0].teammates).toHaveLength(1);
    expect(result[0].results[0].teammates[0].name).toBe('Alice');
  });

  it('strips leading # from event_tag_normalized', () => {
    const rows = [makeRow({ event_tag_normalized: '#event_2025_worlds' })];
    const result = groupPlayerResults(rows, {});
    expect(result[0].eventKey).toBe('event_2025_worlds');
  });

  it('handles event_tag_normalized without leading #', () => {
    const rows = [makeRow({ event_tag_normalized: 'event_2025_worlds' })];
    const result = groupPlayerResults(rows, {});
    expect(result[0].eventKey).toBe('event_2025_worlds');
  });

  it('excludes self by selfPersonId', () => {
    const rows = [makeRow({ participant_person_id: 'person-self' })];
    const result = groupPlayerResults(rows, { selfPersonId: 'person-self' });

    expect(result[0].results[0].teammates).toHaveLength(0);
  });

  it('excludes self by selfMemberId', () => {
    const rows = [makeRow({ participant_member_id: 'member-self' })];
    const result = groupPlayerResults(rows, { selfMemberId: 'member-self' });

    expect(result[0].results[0].teammates).toHaveLength(0);
  });

  it('does not exclude when selfPersonId does not match', () => {
    const rows = [makeRow({ participant_person_id: 'person-other' })];
    const result = groupPlayerResults(rows, { selfPersonId: 'person-self' });

    expect(result[0].results[0].teammates).toHaveLength(1);
  });

  it('groups multiple events separately', () => {
    const rows = [
      makeRow({ event_tag_normalized: '#event_2025_a', event_title: 'Event A' }),
      makeRow({ event_tag_normalized: '#event_2025_b', event_title: 'Event B' }),
    ];
    const result = groupPlayerResults(rows, {});

    expect(result).toHaveLength(2);
    expect(result[0].eventTitle).toBe('Event A');
    expect(result[1].eventTitle).toBe('Event B');
  });

  it('groups same discipline + placement into one result entry', () => {
    const rows = [
      makeRow({ participant_display_name: 'Alice', participant_person_id: 'p-a' }),
      makeRow({ participant_display_name: 'Bob', participant_person_id: 'p-b' }),
    ];
    const result = groupPlayerResults(rows, {});

    expect(result[0].results).toHaveLength(1);
    expect(result[0].results[0].teammates).toHaveLength(2);
    expect(result[0].results[0].teammates.map(t => t.name)).toEqual(['Alice', 'Bob']);
  });

  it('creates separate entries for different disciplines', () => {
    const rows = [
      makeRow({ discipline_name: 'Freestyle', placement: 1 }),
      makeRow({ discipline_name: 'Net', placement: 1 }),
    ];
    const result = groupPlayerResults(rows, {});

    expect(result[0].results).toHaveLength(2);
    expect(result[0].results[0].disciplineName).toBe('Freestyle');
    expect(result[0].results[1].disciplineName).toBe('Net');
  });

  it('creates separate entries for different placements in same discipline', () => {
    const rows = [
      makeRow({ placement: 1, participant_display_name: 'Alice', participant_person_id: 'p-a' }),
      makeRow({ placement: 2, participant_display_name: 'Bob', participant_person_id: 'p-b' }),
    ];
    const result = groupPlayerResults(rows, {});

    expect(result[0].results).toHaveLength(2);
  });

  it('deduplicates teammates with same display name', () => {
    const rows = [
      makeRow({ participant_display_name: 'Alice', participant_person_id: 'p-a' }),
      makeRow({ participant_display_name: 'Alice', participant_person_id: 'p-a' }),
    ];
    const result = groupPlayerResults(rows, {});

    expect(result[0].results[0].teammates).toHaveLength(1);
  });

  it('resolves teammate playerHref from member slug', () => {
    const rows = [makeRow({ participant_member_slug: 'alice_smith', participant_person_id: 'p-a' })];
    const result = groupPlayerResults(rows, {});

    expect(result[0].results[0].teammates[0].playerHref).toBe('/members/alice_smith');
  });

  it('resolves teammate playerHref from person ID when no slug', () => {
    const rows = [makeRow({ participant_member_slug: null, participant_person_id: 'person-123' })];
    const result = groupPlayerResults(rows, {});

    expect(result[0].results[0].teammates[0].playerHref).toBe('/history/person-123');
  });

  it('sets teammate playerHref to undefined when neither slug nor person ID', () => {
    const rows = [makeRow({ participant_member_slug: null, participant_person_id: null })];
    const result = groupPlayerResults(rows, {});

    expect(result[0].results[0].teammates[0].playerHref).toBeUndefined();
  });
});
