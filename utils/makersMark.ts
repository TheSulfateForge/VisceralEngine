import { SECRET_TRIGGER, MAKER_SIGNATURE } from '../constants';

export const getMakersMark = (inputName: string): string | null => {
  if (!inputName) return null;
  
  // Case-insensitive check for the secret trigger
  if (inputName.trim().toLowerCase() === SECRET_TRIGGER.toLowerCase()) {
    try {
      // "Decryption" via Base64 decode
      return atob(MAKER_SIGNATURE);
    } catch (e) {
      console.error("Signature verification failed.");
      return null;
    }
  }
  return null;
};

// Returns the signature unconditionally for system views
export const getSystemSignature = (): string => {
  try {
    return atob(MAKER_SIGNATURE);
  } catch (e) {
    return "";
  }
};