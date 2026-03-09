# MVFP Bootstrap Seed Dataset

This directory contains a minimal bootstrap dataset for the MVFP
public events system.

The seed set includes the following required scenarios:

- one upcoming public event
- one completed public event with no result rows
- one completed public event with results
- one non-public event
- one multi-discipline event
- at least one result entry with multiple participants

These CSV files correspond directly to database tables:

seed_events.csv → events  
seed_event_disciplines.csv → event_disciplines  
seed_event_results.csv → event_result_entries  
seed_event_result_participants.csv → event_result_entry_participants  
seed_persons.csv → members

The seed data is derived from the cleaned canonical results dataset.
