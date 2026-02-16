
export const mapSystemErrorToNarrative = (error: any): string => {
  let raw = '';
  
  if (typeof error === 'string') {
    raw = error;
  } else if (error && typeof error === 'object' && 'message' in error) {
    raw = String(error.message);
  } else {
    raw = String(error || '');
  }

  const msg = raw.toLowerCase();

  if (msg.includes('fetch') || msg.includes('network') || msg.includes('offline')) {
    return "⚠ Neural Link Severed. Connection lost. (Check Network)";
  }
  if (msg.includes('400') || msg.includes('404')) {
    return "⚠ Matrix Protocol Error. Request malformed.";
  }
  if (msg.includes('401') || msg.includes('403') || msg.includes('key')) {
    return "⚠ Neural Key Invalid or Expired. Re-authorization required.";
  }
  if (msg.includes('500') || msg.includes('503') || msg.includes('overloaded')) {
    return "⚠ Core Processing Overload. The host is busy. Stand by.";
  }
  if (msg.includes('safety') || msg.includes('blocked')) {
    return "⚠ Cognitive Inhibitors Engaged. Content flagged by safety protocols.";
  }
  if (msg.includes('quota') || msg.includes('storage')) {
    return "⚠ Memory Banks Full. Clear old archives (Saves) to proceed.";
  }

  return `⚠ Core Fault: ${raw || "Unknown Anomaly"}`;
};
