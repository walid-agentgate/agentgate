# Design Partner Checklist

## Before integration
- [ ] One real agent selected
- [ ] One sensitive tool selected
- [ ] Tool side effects documented
- [ ] Identity/tenant model documented
- [ ] Sandbox or replay data available
- [ ] Success criteria agreed

## Shadow phase
- [ ] AgentGate installed from a real package
- [ ] Policy Pack selected
- [ ] Decisions recorded
- [ ] Actual outcomes captured
- [ ] Would-block executions reviewed
- [ ] False positives reviewed
- [ ] False negatives reviewed

## Enforcement phase
- [ ] Low-risk tool passed shadow review
- [ ] Sensitive tool has explicit approval boundary
- [ ] BLOCK execution = 0 in test
- [ ] ASK pre-approval execution = 0 in test
- [ ] Approved execution = 1 in test
- [ ] Replay survives restart

## Exit criteria
- [ ] Partner accepts production use
- [ ] Second workflow requested or demonstrated
- [ ] Evidence can support a case study
- [ ] No unresolved critical audit mismatch
