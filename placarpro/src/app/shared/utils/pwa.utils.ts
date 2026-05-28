/**
 * Helpers de detecção de plataforma e modo de instalação PWA.
 *
 * Usados pra decidir UX baseado em onde o usuário está rodando o app:
 *   - iOS Safari (web)     → tem barra de URL, não permite fullscreen real
 *   - iOS PWA standalone   → sem barra, fullscreen funciona
 *   - Android Chrome web   → permite fullscreen real
 *   - Android PWA          → sem barra
 *   - Desktop browser      → fullscreen via API funciona normal
 *   - Capacitor native     → app nativo, sem barra alguma
 */

/** Detecta iOS (iPhone, iPad, iPod). */
export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || navigator.vendor || '';
  // iPad em iPadOS 13+ se identifica como "Macintosh" — adicionamos
  // check do `maxTouchPoints` pra detectar (Macs reais reportam 0).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isIpadOs13Plus = navigator.platform === 'MacIntel' &&
    (navigator as any).maxTouchPoints > 1;
  return /iPhone|iPad|iPod/i.test(ua) || isIpadOs13Plus;
}

/** Detecta se o browser é Safari (real Safari, não Chrome iOS/Firefox iOS). */
export function isSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  // Safari tem "Safari" mas NÃO tem "Chrome" / "CriOS" / "FxiOS"
  return /Safari/i.test(ua) &&
    !/Chrome|CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
}

/**
 * Detecta se a app está rodando em MODO PWA STANDALONE (instalada na
 * home screen / launched via ícone do PWA).
 *
 * Em iOS Safari: `(navigator as any).standalone === true` quando aberto
 *   pelo ícone PWA. False quando aberto no Safari normal.
 * Em outros browsers: usa media query `display-mode: standalone`.
 */
export function isPwaStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const iosStandalone = (window.navigator as any).standalone === true;
  if (iosStandalone) return true;
  if (window.matchMedia) {
    return window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      window.matchMedia('(display-mode: minimal-ui)').matches;
  }
  return false;
}

/** Detecta se rodando dentro do Capacitor (app nativo iOS/Android). */
export function isCapacitorNative(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const capacitor = (window as any).Capacitor;
  return !!(capacitor?.isNativePlatform?.() || capacitor?.platform === 'ios' || capacitor?.platform === 'android');
}

/**
 * Caso crítico onde mostraremos o tutorial de "Adicionar à Tela Inicial":
 * iOS Safari NÃO instalado como PWA NÃO rodando como app nativo Capacitor.
 *
 * Nesse cenário o user não consegue ter fullscreen real — a única solução
 * é instalar o app na home screen.
 */
export function precisaTutorialPwaIos(): boolean {
  return isIos() && isSafari() && !isPwaStandalone() && !isCapacitorNative();
}

/** Chave do localStorage onde guardamos a URL pra redirect pós-install. */
export const PENDING_REDIRECT_KEY = 'placarpro_pending_redirect_after_pwa_install';
/** Chave onde marcamos que o user já viu o tutorial PWA — evita re-exibir. */
export const PWA_TUTORIAL_SEEN_KEY = 'placarpro_pwa_tutorial_seen';

/** Marca que o user já viu (e fechou) o tutorial PWA — não exibe de novo. */
export function marcarTutorialPwaVisto(): void {
  try {
    localStorage.setItem(PWA_TUTORIAL_SEEN_KEY, '1');
  } catch { /* ignore */ }
}

/** Verifica se o user já viu o tutorial PWA anteriormente. */
export function tutorialPwaJaVisto(): boolean {
  try {
    return localStorage.getItem(PWA_TUTORIAL_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

/** Salva a URL atual no localStorage pra abrir após o user instalar o PWA. */
export function salvarRedirectPosInstall(url?: string): void {
  try {
    const target = url ?? (typeof window !== 'undefined' ? window.location.pathname + window.location.search : '');
    if (target) {
      localStorage.setItem(PENDING_REDIRECT_KEY, target);
    }
  } catch { /* localStorage pode estar bloqueado */ }
}

/** Lê (e LIMPA) a URL pendente de redirect. Retorna `null` se não houver. */
export function consumirRedirectPendente(): string | null {
  try {
    const url = localStorage.getItem(PENDING_REDIRECT_KEY);
    if (url) localStorage.removeItem(PENDING_REDIRECT_KEY);
    return url;
  } catch {
    return null;
  }
}
