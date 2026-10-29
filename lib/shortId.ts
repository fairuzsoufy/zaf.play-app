// Short game links, same as the website's lib/shortId.ts: the game's UUID in base 62.
const ABC = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function shortId(uuid: string) {
  let n = BigInt('0x' + uuid.replace(/-/g, ''));
  let s = '';
  while (n > BigInt(0)) {
    s = ABC[Number(n % BigInt(62))] + s;
    n /= BigInt(62);
  }
  return s || '0';
}

export const gameShortUrl = (id: string) => `https://zafplay.com/g/${shortId(id)}`;
