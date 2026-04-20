---
paths:
  - "src/services/**"
  - "src/db/db.ts"
---

Services own business rules, validation, authorization, and data shaping. db.ts is the only SQL surface: flat rows, prepared statements, no business rules. Controllers are HTTP glue only. See extend-service-contract skill for contract changes.
