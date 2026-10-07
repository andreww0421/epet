const textEncoder = new TextEncoder();

export const bytesToBase64Url = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
};

export const base64UrlToBytes = (value: string) => {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(`${normalized}${padding}`);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

export const constantTimeBytesEqual = (
  left: Uint8Array,
  right: Uint8Array,
) => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
};

export const getWebCrypto = (provided?: Crypto) => {
  const implementation = provided ?? globalThis.crypto;
  if (!implementation?.subtle || !implementation.getRandomValues) {
    throw new Error('Web Crypto is required for authentication');
  }
  return implementation;
};

export const hashOpaqueToken = async (
  token: string,
  cryptoImplementation = getWebCrypto(),
) => {
  const digest = await cryptoImplementation.subtle.digest(
    'SHA-256',
    textEncoder.encode(token),
  );
  return bytesToBase64Url(new Uint8Array(digest));
};
