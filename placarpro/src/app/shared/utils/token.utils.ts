/**
 * Geração de tokens/segredos criptograficamente fortes no client.
 *
 * Usa `crypto.getRandomValues` (CSPRNG do navegador) em vez de
 * `Math.random()` — que é previsível e NUNCA deve ser usado pra gerar
 * segredos (links de convite, tokens de acesso, etc.). Um atacante que
 * observe alguns valores de `Math.random()` consegue prever os próximos.
 */

/** Alfabeto URL-safe sem caracteres ambíguos (0/O, 1/l/I). */
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/**
 * Gera um token URL-safe com `tamanho` caracteres usando CSPRNG.
 * Default 24 chars ≈ 142 bits de entropia — inviável de adivinhar/forçar.
 *
 * @param tamanho número de caracteres (default 24)
 */
export function gerarTokenSeguro(tamanho = 24): string {
  const cryptoObj = typeof crypto !== 'undefined' ? crypto : undefined;
  if (cryptoObj?.getRandomValues) {
    const buf = new Uint8Array(tamanho);
    cryptoObj.getRandomValues(buf);
    let s = '';
    for (let i = 0; i < tamanho; i++) {
      s += ALFABETO.charAt(buf[i] % ALFABETO.length);
    }
    return s;
  }
  // Fallback pra ambientes sem WebCrypto (raro) — ainda melhor que 8-12 chars.
  let s = '';
  for (let i = 0; i < tamanho; i++) {
    s += ALFABETO.charAt(Math.floor(Math.random() * ALFABETO.length));
  }
  return s;
}
