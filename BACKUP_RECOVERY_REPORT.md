# Backup and Recovery Report

Arthur's backup task last reported success with Robocopy exit 3, a 10,890,686-byte Git bundle, and a fresh local OneDrive destination.

The isolated restoration test completed 2026-10-17 21:48 UTC:

- 12,789 files and 1,716,199,370 bytes restored.
- 12,307 raw files and 1,652,016,333 raw bytes checked.
- 206 normalized JSON files parsed.
- 0 file-integrity mismatches and 0 invalid normalized files.
- Git clone, Git fsck, checkout of `e2708537`, and 38 regression tests all passed.

Cloud synchronization to another device is **not verified**. A local OneDrive directory and running sync client do not prove remote availability.
