import { createHmac } from "crypto";

// Mini implementation HOTP-SHA1 + decodage base32 (RFC 4226/6238) pour
// generer de vrais codes 2FA cote test. La fenetre serveur de +-1 periode
// rend l'horloge reelle suffisante.

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(input: string): Buffer {
  const normalized = input.toUpperCase().replace(/=+$/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of normalized) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

export function generateTotpCode(secretBase32: string, date = new Date(), digits = 6, period = 30): string {
  const counter = Math.floor(date.getTime() / 1000 / period);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuffer.writeUInt32BE(counter >>> 0, 4);

  const digest = createHmac("sha1", decodeBase32(secretBase32)).update(counterBuffer).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binCode =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    (((digest[offset + 1] ?? 0) & 0xff) << 16) |
    (((digest[offset + 2] ?? 0) & 0xff) << 8) |
    ((digest[offset + 3] ?? 0) & 0xff);

  return (binCode % 10 ** digits).toString().padStart(digits, "0");
}

// Un code garanti different du code courant.
export function wrongTotpCode(validCode: string): string {
  return validCode === "000000" ? "000001" : "000000";
}
