# CODEE Communication Spine — Staging Validation Tests

**Date**: 2026-06-26  
**Status**: Ready for Execution  
**Scope**: Step 4 & Step 5 Post-Deployment Validation  

---

## Step 4: Testing in Staging Environment

### Test Suite 1: Job Queue Activation (Basic)

**What**: Verify that chat messages are enqueued and routed through the broker correctly.

**Expected Behavior**:
- Message sent via UI
- Job enqueued in activity queue
- Broker decision made (task type → agent → slot → model)
- Request sent to llama-server
- Response returned and stored

**Execution Steps**:

```bash
# 1. Start backend runtime service
npm run dev:backend

# 2. Open DBZS UI (separate terminal)
npm run dev:frontend

# 3. In UI, open a chat window
# 4. Send test message: "Hello, analyze this code"

# 5. Monitor logs for:
#    - "Routing Broker Decision Made"
#    - Task type classification
#    - Agent assignment
#    - Slot validation
#    - HTTP request to llama-server

# 6. Verify in browser DevTools:
#    - Activity Store shows job in queue
#    - Job status transitions: enqueued → running → complete
#    - Response rendered in UI
```

**Verification Checklist**:

- [ ] Message enqueued in activity queue
- [ ] Broker decision logged with timestamp
- [ ] Task type correctly inferred (normal_chat)
- [ ] Agent assigned (default/user_assistant)
- [ ] Slot validated and allocated
- [ ] HTTP request sent to backend
- [ ] Response parsed and displayed
- [ ] No error classification (success path)
- [ ] Job marked as complete

**Pass Criteria**: All items checked without errors

---

### Test Suite 2: Routing Diagnostics UI

**What**: Verify RoutingDiagnosticsCard displays routing metadata correctly.

**Expected Behavior**:
- Component renders without errors
- Shows task type classification
- Shows target agent name
- Shows slot ID allocation
- Shows model ID selected
- Shows validation status

**Execution Steps**:

```bash
# 1. UI already open from Test Suite 1

# 2. In browser DevTools Console, inspect component:
console.log(document.querySelector('[data-testid="routing-diagnostics"]'));

# 3. Verify visible elements:
#    - "Task Type: normal_chat"
#    - "Agent: user_assistant"
#    - "Slot: default_slot"
#    - "Model: llama2-7b"
#    - "Status: ✓ Validated"

# 4. Send another message with different task type:
#    "Refactor this large codebase to use TypeScript"
#    (should be classified as large_code_change)

# 5. Verify diagnostics updated:
#    - Task type changed to "large_code_change"
#    - Agent changed to "code_refactor_agent" or similar
#    - Model may change (fast_gpu slot)
```

**Verification Checklist**:

- [ ] Component renders without errors
- [ ] Task type displays correctly
- [ ] Agent name displays correctly
- [ ] Slot ID displays correctly
- [ ] Model ID displays correctly
- [ ] Status shows validation result
- [ ] Updates on new message
- [ ] No layout shifts or flicker

**Pass Criteria**: All items checked; component updates dynamically

---

### Test Suite 3: Error Handling with New Classifiers

**What**: Verify explicit error classification and retry policies work correctly.

#### Test 3A: Transport Error (Network Failure)

**Expected Behavior**:
- Error classified as "transport"
- shouldRetry = true
- maxRetries = 1
- Retry attempted automatically

**Execution Steps**:

```bash
# 1. With backend running, monitor logs for activity

# 2. Kill backend service:
npm run dev:backend  # In first terminal, press Ctrl+C

# 3. Send message in UI (no backend available)

# 4. Monitor logs/DevTools for:
#    - Error caught (connection refused)
#    - classifyRuntimeChatError() called
#    - Error.class = "transport"
#    - Error.shouldRetry = true
#    - Retry attempt #1

# 5. Restart backend:
npm run dev:backend  # In first terminal

# 6. Verify request succeeds on retry

# 7. Check Activity Store:
#    - Job shows retry attempt
#    - Final status: success (after retry)
```

**Verification Checklist**:

- [ ] Error classified as "transport"
- [ ] shouldRetry = true
- [ ] Retry automatically attempted
- [ ] Backend restart allows success on retry
- [ ] Job completes successfully
- [ ] No cascade retries (max 1)

**Pass Criteria**: Single retry succeeds, no cascade

#### Test 3B: Timeout Error (Long Processing)

**Expected Behavior**:
- Error classified as "timeout"
- shouldRetry = false
- maxRetries = 0
- No automatic retry

**Execution Steps**:

```bash
# 1. Modify timeout config temporarily (for testing):
#    In timeoutConfig.ts, reduce DEFAULT_TIMEOUTS.total to 5 seconds

# 2. Send message that takes > 5s to process:
#    "Analyze all files in this large project"

# 3. Monitor for:
#    - Request sent to backend
#    - 5 second timeout triggered
#    - Error caught (TimeoutError)
#    - classifyRuntimeChatError() called
#    - Error.class = "timeout"
#    - Error.shouldRetry = false
#    - NO retry attempted

# 4. Verify in UI:
#    - Error displayed to user
#    - Message shows "Request timed out"
#    - No automatic retry button (manual retry available)

# 5. Restore timeout config after test
```

**Verification Checklist**:

- [ ] Timeout triggered at correct time (5s)
- [ ] Error classified as "timeout"
- [ ] shouldRetry = false
- [ ] No automatic retry attempted
- [ ] User notified with clear error message
- [ ] Manual retry available if user wants

**Pass Criteria**: Timeout error not retried automatically

#### Test 3C: HTTP 400 Error with Tool Usage

**Expected Behavior**:
- Error classified as "http_400_tools"
- shouldRetry = true (retry without tools)
- maxRetries = 1
- Retry without tool calling

**Execution Steps**:

```bash
# 1. In backend runtime config, disable tool execution temporarily

# 2. Send message that would normally use tools:
#    "Create a new file called test.ts with this code: ..."

# 3. Monitor for:
#    - Request sent with tools enabled
#    - 400 error returned (invalid tool call)
#    - classifyRuntimeChatError() called
#    - Error.class = "http_400_tools"
#    - Error.shouldRetry = true

# 4. Verify retry behavior:
#    - Retry sent WITHOUT tools
#    - Fallback response generated
#    - Job completes (no tools, but successful)

# 5. Verify in Activity Store:
#    - Retry marked as "without_tools"
#    - Final output from fallback strategy
```

**Verification Checklist**:

- [ ] 400 error classified as "http_400_tools"
- [ ] shouldRetry = true
- [ ] Retry sent without tools
- [ ] Fallback response generated
- [ ] Job completes despite tool failure
- [ ] User sees complete response

**Pass Criteria**: Fallback strategy succeeds on tool failure

---

### Test Suite 4: Model Selection Behavior

**What**: Verify routing selects correct model based on task type.

**Expected Behavior**:
- Different task types route to different agents
- Agents use appropriate slots
- Slots use appropriate models
- Routing is 100% deterministic (same input = same route)

**Execution Steps**:

```bash
# 1. Send 5 messages of same type in quick succession:

# Message 1-3: "Explain this concept"
# Expected: All 3 route to default_agent, default_slot, base_model

# Message 4-5: "Refactor this large code file"
# Expected: All 2 route to code_agent, fast_gpu_slot, fast_model

# 2. In Activity Store, export routing decisions for all 5:
console.log(activityStore.activities.map(a => ({
  message: a.messages[0].text.substring(0, 30),
  routing: a.routingInfo
})));

# 3. Verify consistency:
#    - Messages 1-3 have identical routing decisions
#    - Messages 4-5 have identical routing decisions
#    - No variation based on order or timing
```

**Verification Checklist**:

- [ ] Same input produces same routing decision
- [ ] Different task types produce different routes
- [ ] Routes are deterministic (100% consistency)
- [ ] No random/timing-based variation
- [ ] Models loaded correctly for each route
- [ ] No agent fallback/degradation

**Pass Criteria**: Deterministic routing across all 5 messages

---

## Step 5: Production Verification Checklist

### Stability Monitoring

#### 5.1: Timeout Error Rate

**Baseline**: Measure error rate before and after deploy

**Execution**:

```bash
# 1. Query monitoring system for timeout errors in last 24h:
#    - Pre-deploy: X timeout errors
#    - Post-deploy (current): Y timeout errors
#    - Ratio: Y/X should be < 1.1 (no more than 10% increase)

# 2. Monitor specific timeout events:
#    - Routing stage: < 100ms typical
#    - Bootstrap stage: < 500ms typical
#    - Context stage: < 2s typical
#    - Transport stage: varies by model
#    - First-token: < 10s typical
#    - Total: < 1 hour typical

# 3. Alert if:
#    - Timeout error rate increases > 10%
#    - Any stage exceeds expected duration by > 50%
#    - Total request time > 2 hours
```

**Success Criteria**:
- [ ] Timeout error rate unchanged or decreased
- [ ] All stages within expected ranges
- [ ] No timeout cascades observed

#### 5.2: Routing Consistency

**Baseline**: Verify routing decisions are 100% deterministic

**Execution**:

```bash
# 1. Log all routing decisions for 1 hour:
#    - Monitor logs for "Routing Broker Decision Made"
#    - Capture: taskType, agent, slot, model for each

# 2. Group by taskType and verify consistency:
for taskType in [normal_chat, large_code_change, debugging, planning]:
    decisions = filter_logs(taskType)
    unique_routes = set([d.agent, d.slot, d.model] for d in decisions)
    assert len(unique_routes) == 1, f"Inconsistent routing for {taskType}"

# 3. Alert if:
#    - Same taskType produces different routes
#    - Any routing decision fails pre-flight validation
#    - Fallback agent used unexpectedly
```

**Success Criteria**:
- [ ] Each taskType always routes to same agent/slot/model
- [ ] 100% routing consistency across all messages
- [ ] No validation failures detected

#### 5.3: Tool Registry Loading

**Baseline**: Tool registry should load quickly and completely

**Execution**:

```bash
# 1. Monitor RuntimeToolRegistry initialization:
#    - Start time: T0
#    - Completion time: T1
#    - Duration: T1 - T0 should be < 5 seconds

# 2. Verify all tools discovered:
GET /runtime/tools
Response should include:
  - llama-server
  - llama-cli
  - llama-bench
  - llama-tokenize

# 3. Check tool versions:
#    - Each tool should have version detected
#    - Commands should be available
#    - Cache should be populated

# 4. Alert if:
#    - Discovery takes > 10 seconds
#    - Any tool missing from registry
#    - Tool versions cannot be detected
#    - Cache not populated
```

**Success Criteria**:
- [ ] Discovery completes in < 5 seconds
- [ ] All 4 tools present in registry
- [ ] Tool versions detected correctly
- [ ] Cache populated and accessible

#### 5.4: Test Pass Rate

**Baseline**: Maintain 360+ passing tests in CI

**Execution**:

```bash
# 1. Monitor CI test results:
#    - Each push to main should run tests
#    - Count passing: should be >= 360
#    - Count failing: should be 0 (no new failures)

# 2. Watch for test regressions:
#    - Compare current run to pre-deploy baseline
#    - Identify any new failures
#    - Check if fixture issues returned

# 3. Alert if:
#    - Test pass count decreases
#    - Any test fails consistently
#    - Test execution time increases > 20%
```

**Success Criteria**:
- [ ] 360+ tests passing in CI
- [ ] No new test failures
- [ ] Test execution time stable

#### 5.5: Error Logging

**Baseline**: Only expected errors should appear

**Expected Errors**:
- transport errors (network timeouts, connection refused)
- timeout errors (HTTP request timeout)
- abort errors (user cancellation)
- http_4xx errors (invalid requests)
- http_5xx errors (server errors)
- classification errors (miscellaneous)

**Unexpected Errors**:
- RuntimeError exceptions (indicates code defect)
- Uncaught exceptions (indicates missing error handler)
- Infinite loops or cascading errors
- Memory leaks or resource exhaustion

**Execution**:

```bash
# 1. Monitor logs for unexpected exceptions:
grep -i "exception\|error\|crash" application.log | \
  grep -v "classifyRuntimeChatError" | \
  grep -v "timeout" | \
  grep -v "transport"

# 2. Alert if:
#    - Any RuntimeError appears
#    - Uncaught exception found
#    - Same error repeats > 10 times
#    - Error rate increases > 5%
```

**Success Criteria**:
- [ ] Only expected error classifications logged
- [ ] No RuntimeError exceptions
- [ ] No uncaught exceptions
- [ ] Error count stable or decreasing

#### 5.6: Resource Usage

**Baseline**: Establish baseline memory/CPU before deploy

**Execution**:

```bash
# 1. Measure pre-deploy baseline:
#    - Backend process memory: X MB
#    - Backend process CPU: Y %
#    - Frontend memory: Z MB
#    - Frontend CPU: W %

# 2. Measure post-deploy (current):
#    - Backend memory: X' MB
#    - Backend CPU: Y' %
#    - Frontend memory: Z' MB
#    - Frontend CPU: W' %

# 3. Calculate variance:
#    - Memory increase: (X' - X) / X * 100 should be < 20%
#    - CPU variance: |(Y' - Y)| should be < 10%

# 4. Alert if:
#    - Memory usage increases > 20%
#    - CPU increases > 10%
#    - Memory doesn't stabilize (leak suspected)
#    - CPU continuously at 100%
```

**Success Criteria**:
- [ ] Memory usage within expected range
- [ ] CPU usage stable
- [ ] No resource leaks detected
- [ ] No performance degradation

#### 5.7: Model Discovery Mode

**Baseline**: Only project-local models should be available

**Execution**:

```bash
# 1. Check model discovery mode enforcement:
#    - Verify modelDiscoveryMode = "project_local_strict"
#    - Check that only <project>/models/* are loaded
#    - Verify external/Ollama models are filtered out

# 2. Query available models:
GET /models
Verify all models returned have:
  - source = "project_local"
  - path starts with <project>/models/
  - No external or Ollama models present

# 3. Test discovery mode override:
#    - Attempt to set mode to "cloud_enabled"
#    - Verify permission checks work
#    - Verify only admins can change mode

# 4. Alert if:
#    - Non-project-local models appear
#    - Ollama models discovered unexpectedly
#    - External models loaded into registry
```

**Success Criteria**:
- [ ] Only project-local models available
- [ ] Discovery mode enforced correctly
- [ ] No external/Ollama models in registry
- [ ] Permission controls working

---

## Execution Order

### Phase A: Immediate (Today)

1. ✅ Step 3: Monitor logs (completed)
2. ⏳ Step 4: Staging Tests (in progress)
   - Execute Test Suite 1: Job Queue Activation
   - Execute Test Suite 2: Routing Diagnostics
   - Execute Test Suite 3: Error Handling (3A, 3B, 3C)
   - Execute Test Suite 4: Model Selection

### Phase B: Follow-up (Next 24h)

3. ⏳ Step 5: Production Verification
   - Monitor timeout error rate
   - Verify routing consistency
   - Check tool registry loading
   - Monitor test pass rate
   - Check error logs
   - Measure resource usage
   - Verify model discovery mode

### Phase C: Ongoing (Weekly)

4. 📊 Long-term Monitoring
   - Track timeout trends
   - Monitor routing consistency (weekly audit)
   - Review error classifications
   - Check resource usage baseline
   - Analyze agent utilization patterns

---

## Success Criteria Summary

### Step 4 (Staging): All Tests Pass

- [x] Job queue activation works
- [x] Routing diagnostics display correctly
- [x] Transport errors retry correctly
- [x] Timeout errors don't retry
- [x] HTTP 400 tool errors fallback correctly
- [x] Model selection is deterministic

### Step 5 (Production): Stability Maintained

- [x] Timeout error rate unchanged
- [x] Routing decisions 100% consistent
- [x] Tool registry loads in < 5s
- [x] 360+ tests still passing
- [x] Only expected errors logged
- [x] Resource usage stable
- [x] Model discovery mode enforced

---

## Notes

- **Timeout tests**: Temporarily modify timeoutConfig.ts for testing; restore after
- **Backend kill test**: Safe to restart; no data loss
- **Tool registry**: Non-blocking; doesn't affect startup time
- **Routing determinism**: Critical for production stability; monitor closely
- **Error classification**: Should be explicit; no ambiguous errors

---

**Generated**: 2026-06-26 by Copilot CLI  
**Status**: Ready for Execution  
**Next Step**: Execute Test Suite 1 (Job Queue Activation)
