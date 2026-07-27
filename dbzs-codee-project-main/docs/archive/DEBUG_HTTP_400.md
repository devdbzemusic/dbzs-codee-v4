# HTTP 400 Error Diagnosis — CODEE Communication Spine

**Date**: 2026-06-26 23:35
**Error**: Runtime rejected request with HTTP 400

---

## Issue

User received: "Runtime hat die Anfrage abgelehnt (HTTP 400). Bitte kuerzere Eingabe oder Runtime-Profil pruefen."

This indicates:
1. Request reached backend/llama-server
2. HTTP 400 Bad Request returned
3. Error classification didn't handle it properly

---

## Root Cause Analysis

### Fixed Issues ✅

**1. HTTP 400 Error Detection** (FIXED in commit bca0961)
- Problem: `_raise_chat_request_error()` was wrapping HTTP errors in generic message
- Original: `RuntimeError(f"{provider} request failed: {exc}")`
- Fixed: `RuntimeError("HTTP Error 400" if "400" in error_msg else ...)`
- Impact: Fallback handler now correctly detects HTTP 400 errors

### Potential Remaining Issues ⚠️

**2. Payload Validation**
- llama-server might reject payload for:
  - Missing required fields
  - Invalid field types
  - Content too long
  - max_tokens invalid value
  - tools format invalid

**3. Request Size**
- File context too large?
- Message list too long?
- Single message content exceeds limit?

---

## Diagnostic Steps

### Step 1: Check What Caused HTTP 400

From Phase 3 error classification, HTTP 400 with tools should:
```
✅ Be caught by: `except RuntimeError as exc:`
✅ Check: `if chat_request.tools and "HTTP Error 400" in str(exc):`
✅ Action: Retry WITHOUT tools
```

Now with the fix, the string will be "HTTP Error 400", so fallback should work.

### Step 2: Check Actual Request Payload

To debug what caused the 400, we need to:
1. Log the actual JSON payload being sent
2. Check llama-server logs for specific error
3. Verify tools format is valid

### Step 3: Common HTTP 400 Causes in llama-server

1. **Invalid max_tokens**: Too large or too small
   - Solution: Add validation to cap max_tokens

2. **Invalid tools format**: Not OpenAI-compatible
   - Solution: Validate tools structure before sending

3. **Missing model field**: Some versions require it
   - Solution: Add model name to payload if not present

4. **Content encoding**: UTF-8 issues or invalid characters
   - Solution: Sanitize message content

5. **Message role values**: Only "system", "user", "assistant" allowed
   - Solution: Validate roles before sending

---

## Recommended Fixes

### Short Term (Immediate)

1. ✅ HTTP 400 error message fix (DONE - commit bca0961)
2. Add logging to see actual request payload
3. Add timeout handling if request takes too long

### Medium Term (Next)

1. Validate payload before sending:
   - Max tokens limits (1-4096)
   - Message roles validation
   - Tools format validation

2. Add specific HTTP error handling:
   - 400: Bad Request → Log payload, retry without tools
   - 401: Unauthorized → Check auth
   - 429: Rate limit → Backoff and retry
   - 500+: Server error → Log and raise

### Long Term

1. Create payload debugger endpoint for testing
2. Add request/response logging for diagnostics
3. Create comprehensive HTTP error classification

---

## Next Steps

1. **Test the fix**: Send a message with tools and verify HTTP 400 is now handled
2. **Monitor logs**: Check if fallback succeeds after HTTP 400
3. **Add debugging**: Log actual request payload when HTTP 400 occurs
4. **Validate payload**: Add pre-flight validation of request structure

---

**Status**: Fix applied (bca0961), awaiting test
