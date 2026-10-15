import assert from "node:assert/strict";
import { apiRequestError, localizedUiError } from "../app/i18n";

const fallbackTa = "இந்த விவரங்களைச் சரிபார்த்து மீண்டும் முயற்சிக்கவும்.";

const duplicate = apiRequestError({
  error: { code: "DUPLICATE_VALUE", message: "This value is already in use." },
}, "Request failed.");
assert.equal(duplicate.message, "This value is already in use.");
assert.equal(duplicate.code, "DUPLICATE_VALUE");
assert.equal(localizedUiError(duplicate, "ta", fallbackTa), "இந்த மதிப்பு ஏற்கனவே பயன்பாட்டில் உள்ளது. பதிவைச் சரிபார்த்து மீண்டும் முயற்சிக்கவும்.");
assert.equal(localizedUiError(duplicate, "en", fallbackTa), "This value is already in use.");

const internal = apiRequestError({
  error: { code: "INTERNAL_ERROR", message: "Internal server error", requestId: "req-test-123" },
}, "Request failed.");
assert.equal(localizedUiError(internal, "ta", fallbackTa), "சேவையகம் இந்த கோரிக்கையை முடிக்கவில்லை. கீழேயுள்ள குறிப்பெண்ணை API பதிவுகளில் பார்க்கவும். குறிப்பு எண்: req-test-123");

const forbidden = apiRequestError({ error: { code: "FORBIDDEN", message: "Permission denied." } }, "Request failed.");
assert.equal(localizedUiError(forbidden, "ta", fallbackTa), "இந்தச் செயலைச் செய்ய உங்களுக்கு அனுமதி இல்லை. ERP நிர்வாகியைத் தொடர்புகொள்ளவும்.");

const unknown = apiRequestError({ error: { code: "UNRECOGNIZED_CODE", message: "English API detail" } }, "Request failed.");
assert.equal(localizedUiError(unknown, "ta", fallbackTa), fallbackTa);
assert.equal(localizedUiError(unknown, "en", fallbackTa), "English API detail");
assert.equal(localizedUiError(new Error("ஏற்கனவே தமிழில்"), "ta", fallbackTa), "ஏற்கனவே தமிழில்");

const statusOnly = apiRequestError({
  error: { message: "Internal server error", requestId: "req-status-500" },
}, "Request failed.", 500);
assert.equal(localizedUiError(statusOnly, "ta", fallbackTa), "சேவையகம் இந்த கோரிக்கையை முடிக்கவில்லை. கீழேயுள்ள குறிப்பெண்ணை API பதிவுகளில் பார்க்கவும். குறிப்பு எண்: req-status-500");

console.log("Localized API error checks passed (code preservation, Tamil translation/fallback, request reference, and English detail).");
