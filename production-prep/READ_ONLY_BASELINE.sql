-- BPP production preflight: READ ONLY, do not run against staging.
-- Cloudflare D1 Studio: verify selected database name and ID are production.
-- This query DOES NOT modify any records.
SELECT
  revision,
  checksum,
  updated_at,
  updated_by,
  json_valid(state_json) AS valid_json,
  json_array_length(state_json, '$.maintenance') AS total_work_orders,
  json_array_length(state_json, '$.projects') AS total_projects,
  json_array_length(state_json, '$.violations') AS total_violations,
  json_array_length(state_json, '$.inspections') AS total_inspections,
  json_array_length(state_json, '$.vendors') AS total_vendors
FROM current_state
WHERE singleton_id = 1;

-- Status distribution: use this instead of assuming specific label spelling.
SELECT json_extract(j.value, '$.status') AS status, COUNT(*) AS records
FROM current_state AS c, json_each(c.state_json, '$.maintenance') AS j
WHERE c.singleton_id = 1
GROUP BY json_extract(j.value, '$.status')
ORDER BY records DESC;

-- Check repeated work-order identifiers. Expect zero rows.
SELECT json_extract(j.value, '$.id') AS work_order_id, COUNT(*) AS occurrences
FROM current_state AS c, json_each(c.state_json, '$.maintenance') AS j
WHERE c.singleton_id = 1
GROUP BY json_extract(j.value, '$.id')
HAVING COUNT(*) > 1;
