import { OfflineStorageSecurityError } from "./offline-outbox";

type ApiErrorDetails = { code?: unknown; message?: unknown; requestId?: unknown; status?: number };

export function offlineApiErrorMessage(error: unknown, locale: "en" | "ta", fallback: string) {
  const value = error && typeof error === "object" ? error as ApiErrorDetails : {};
  const code = typeof value.code === "string" ? value.code : "";
  const message = typeof value.message === "string" ? value.message : error instanceof Error ? error.message : "";
  if (locale === "en") return message || fallback;

  const tamil: Record<string, string> = {
    VALIDATION_ERROR: "வகை, தேதி, தொகை, செலுத்திய முறை மற்றும் விவரத்தைச் சரிபார்க்கவும்.",
    BRANCH_ACCESS_DENIED: "உங்களுக்கு ஒதுக்கப்பட்ட கிளையில் மட்டும் செலவைப் பதிவு செய்யலாம்.",
    INVALID_REFERENCE: "செயலில் உள்ள செலவு வகை மற்றும் கிளையைத் தேர்ந்தெடுத்து மீண்டும் முயற்சிக்கவும்.",
    FORBIDDEN: "இந்தச் செலவைப் பதிவு செய்ய உங்களுக்கு அனுமதி இல்லை. ERP நிர்வாகியைத் தொடர்புகொள்ளவும்.",
    IDEMPOTENCY_KEY_REQUIRED: "பாதுகாப்பான மறுமுயற்சி அடையாளம் கிடைக்கவில்லை. வரைவைக் திருத்தி மீண்டும் சமர்ப்பிக்கவும்.",
    IDEMPOTENCY_KEY_REUSED: "இந்த வரைவின் மறுமுயற்சி அடையாளம் வேறு விவரங்களுடன் பயன்படுத்தப்பட்டுள்ளது. வரைவைக் திருத்தி மீண்டும் சமர்ப்பிக்கவும்.",
    IDEMPOTENCY_RETRY_CONFLICT: "முந்தைய முயற்சி இன்னும் செயல்பாட்டில் உள்ளது அல்லது முடிவடையவில்லை. சிறிது நேரம் கழித்து ஒத்திசைக்கவும்.",
    IDEMPOTENCY_REQUEST_IN_PROGRESS: "முந்தைய முயற்சி இன்னும் செயல்பாட்டில் உள்ளது. சிறிது நேரம் கழித்து ஒத்திசைக்கவும்.",
    DUPLICATE_VALUE: "இந்த விவரம் ஏற்கனவே பயன்பாட்டில் உள்ளது. பதிவைச் சரிபார்த்து மீண்டும் முயற்சிக்கவும்.",
    DATA_CONFLICT: "ஏற்கனவே உள்ள பதிவுகளுடன் முரண்பாடு உள்ளது. தரவைப் புதுப்பித்து மீண்டும் முயற்சிக்கவும்.",
    MIGRATIONS_REQUIRED: "தரவுத்தள புதுப்பிப்பு தேவை. ERP நிர்வாகியைத் தொடர்புகொள்ளவும்.",
    DATABASE_CONFIGURATION: "தரவுத்தள அமைப்பில் சிக்கல் உள்ளது. ERP நிர்வாகியைத் தொடர்புகொள்ளவும்.",
    SERVICE_UNAVAILABLE: "சேவை தற்காலிகமாக கிடைக்கவில்லை. இணைப்பைச் சரிபார்த்து மீண்டும் ஒத்திசைக்கவும்.",
    INTERNAL_ERROR: "சேவையகத்தால் பதிவைச் சேமிக்க முடியவில்லை. ஆதரவுக்காகக் கீழே உள்ள குறிப்பு எண்ணைப் பயன்படுத்தவும்.",
  };
  const translated = tamil[code] ?? (value.status === 403
    ? "இந்தச் செயலைச் செய்ய உங்களுக்கு அனுமதி இல்லை. ERP நிர்வாகியைத் தொடர்புகொள்ளவும்."
    : value.status === 400
      ? "உள்ளிட்ட விவரங்களைச் சரிபார்த்து வரைவைக் திருத்தவும்."
      : value.status === 409
        ? "இந்தப் பதிவு தற்போதைய தரவுடன் முரண்படுகிறது. வரைவைக் திருத்தி மீண்டும் முயற்சிக்கவும்."
        : "ஒத்திசைவு தோல்வியடைந்தது. விவரங்களைச் சரிபார்த்து, வரைவைக் திருத்திய பின் மீண்டும் முயற்சிக்கவும்.");
  const requestId = typeof value.requestId === "string" ? value.requestId : "";
  return code === "INTERNAL_ERROR" && requestId ? `${translated} குறிப்பு எண்: ${requestId}` : translated;
}

export function offlineStorageErrorMessage(error: unknown, locale: "en" | "ta", fallback: string) {
  if (error instanceof OfflineStorageSecurityError) {
    return locale === "ta"
      ? "இந்தச் சாதனத்தில் பாதுகாப்பான ஆஃப்லைன் தரவைத் திறக்க முடியவில்லை. மீண்டும் இணைந்து பதிவுகளைப் புதுப்பிக்கவும்; தேவைப்பட்டால் புகைப்படத்தை மீண்டும் தேர்ந்தெடுக்கவும்."
      : "Secure offline data could not be opened on this device. Reconnect and refresh your records; choose the photo again if needed.";
  }
  const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
  if (name === "QuotaExceededError") {
    return locale === "ta"
      ? "இந்த உலாவியின் உள்ளூர் சேமிப்பு நிரம்பியுள்ளது. இடத்தை விடுவித்து மீண்டும் முயற்சிக்கவும்; ஒத்திசைக்கப்படும் வரை செயலியை அகற்ற வேண்டாம்."
      : "This browser's local storage is full. Free space and try again; keep the app data until queued items sync.";
  }
  if (locale === "ta") return fallback;
  return error instanceof Error && error.message ? error.message : fallback;
}
