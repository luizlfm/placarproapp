# Branding — PlacarPro

Salve as 4 variações do logo aqui com estes nomes:

| Arquivo                  | Uso                                     | Dimensão sugerida |
|--------------------------|-----------------------------------------|-------------------|
| `logo-vertical.png`      | Splash screen, login, ícone grande      | 1024x1024         |
| `logo-horizontal.png`    | Header / topbar do app                  | 1024x256          |
| `logo-trofeu.png`        | Favicon, ícone PWA, badges              | 1024x1024 (quadrado) |
| `logo-claro.png`         | Sidebar escuro (texto branco + Pro verde) | 1024x256 ou 1024x1024 |

## Gerar ícones PWA

Depois de salvar `logo-trofeu.png`, regerar os ícones em `public/icons/` com:

```bash
npx pwa-asset-generator src/assets/branding/logo-trofeu.png public/icons \
  --manifest public/manifest.webmanifest \
  --background "#1A1A1A" \
  --padding "10%"
```

Ou substituir manualmente os 8 PNGs (72, 96, 128, 144, 152, 192, 384, 512).

## Paleta

- Verde primary: `#7AC142`
- Preto sidebar: `#1A1A1A`
- Cinza texto: `#2D2D2D`
- Azul links: `#4DABF7`
