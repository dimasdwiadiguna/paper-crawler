-- Seed topic group (safe to run more than once).
insert into topic_groups (name, blocks, exclude_terms, active)
select
  'Soft sensor for fermentation monitoring',
  '[
    ["soft sensor", "software sensor", "virtual sensor", "state estimation", "state observer", "Kalman filter", "hybrid model", "grey-box model"],
    ["fermentation", "bioprocess", "bioreactor", "cultivation", "fed-batch", "cell culture"]
  ]'::jsonb,
  '{}',
  true
where not exists (select 1 from topic_groups where name = 'Soft sensor for fermentation monitoring');
