Harness report
- harness: examples/harness.yaml
- name: harness-engineering
- scoreboard: examples/scoreboards/self-test.json
  status: passed
- doctor result: examples/doctor/results/pass.json
  status: passed
- cited paths:
  - examples/doctor/results/pass.json
  - examples/harness.yaml
  - examples/scoreboards/self-test.json
