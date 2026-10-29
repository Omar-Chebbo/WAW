Multi-Feature Novelty alignment - Contamination Lab
===================================================

What changed
------------
1. A SHARED novelty formula is used in BOTH the Multi-Feature Study and Contamination Lab:
   N_rho = |E_PA+LP - (E_PA union E_LP)| / |E_PA+LP|.
2. The PA-only and LP-only reference baselines remain RAW, as in the Multi-Feature Study,
   even if the joint PA+LP features are transformed in the Contamination Lab.
3. Both tabs use exactly the same Multi-Feature Novelty card and CSV export columns:
   dataset,retention,novel_edges,multi_edges,novelty_fraction,novelty_percent
4. Contamination Lab has one novelty table row per tested contamination, with Excel (.xlsx)
   and CSV exports of ALL values. The single selected value has an identical Study card
   and its own one-row CSV export. The dropdown selects which contamination to display.
5. The full Wizard evaluation properties table and its Excel export remain available.

Important details
-----------------
- 'retention' is the actual edge_fraction, matching the Study's CSV; because the number
  of edges is integral, e.g. requested 0.25 can yield 20/78 = 0.256410.
- 'novelty_fraction' is a number in [0,1]; 'novelty_percent' is 100 times that value.
  No double multiplication by 100 is performed in Excel.
- The Excel export uses the SAME SIX fields as the Study's novelty CSV, with one row
  for each requested percentage.
- Existing stored experiment history should be rerun for the new shared definition.

Verified
--------
- Backend tests pass, including equality with Multi-Feature Study at retention 0.25
  for raw and log joint PA+LP features.
- The three modified TSX source files pass TypeScript syntax transpilation.
- The full production frontend build is NOT certified in this environment because
  npm packages were unavailable for installation. Run npm run build on your computer.
