BREWER PARK PLACE — LIVING PROPERTY MAP v1.0
================================================

FILES TO UPLOAD TO THE MANAGEMENT SUITE REPOSITORY
--------------------------------------------------
property-map.html
living-property-map.html
assets/dashboard.png
assets/irrigation.jpg
assets/storm.jpg
assets/sanitary.jpg

Recommended repository branch:
living-property-map-v1

WHAT IS INCLUDED
----------------
- Source-based irrigation, storm and sanitary map layers.
- Clickable/tracked zone valves and known infrastructure assets.
- Overlapping zone-label fan-out behavior.
- Field Mode:
    1. Enter Field Mode.
    2. Tap the real map location first.
    3. Choose what asset was found.
    4. Add label, location, condition and notes.
    5. Save. The new asset is immediately Field Verified.
- Existing assets can be field verified and repositioned.
- Automatic Field Mapping Progress replaces the old queue.
- Access & Security permission model for Administrator, Editor/Contractor and Viewer.
- Import permission is separate from ordinary editing privileges.
- Data export/import remains available for backup.

IMPORTANT SECURITY NOTE
-----------------------
The Access & Security screen in this package defines the final permission model,
but true user sign-in and server-side enforcement require the shared backend.
Until that backend is connected, map records are stored in the local browser.
Do not treat the current local permission screen as authentication.

NEXT DEPLOYMENT STEP
--------------------
Upload this package to the living-property-map-v1 branch. After it is tested,
add a Management Suite navigation link to:
    property-map.html

After shared backend/authentication is connected, the same front-end permission
model can be enforced centrally and multiple users will see the same asset data.
