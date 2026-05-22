# Minimal Consumer

This fixture represents a downstream project before it has opted into Harness.

E2E tests copy this project to a temporary directory, run `harness init`, and assert that generated harness artifacts stay inside that temporary project.
