import { Injectable, inject } from '@angular/core';
import { AlertController, AlertOptions } from '@ionic/angular';

/**
 * Opções aceitas pelo `AlertService`. Subset do `AlertOptions` do Ionic
 * com a diferença que `message` aqui pode receber **texto puro** (com `\n`
 * pra quebras) — o service converte pra `<br>` automaticamente.
 *
 * Pra ENFATIZAR uma palavra, envolva-a em `**asterisco duplo**` (estilo
 * Markdown) — convertemos pra `<strong>` antes de mostrar.
 *
 * Não escreva `<b>`, `<br>`, ou outras tags HTML diretamente — o service
 * **escapa todo o HTML** que vier no input pra evitar XSS. Use os
 * marcadores `**` e `\n` em vez disso.
 */
export interface AlertConfig {
  header: string;
  /** Texto da mensagem. Use `\n` para quebra de linha e `**palavra**` pra negrito. */
  message?: string;
  /** Botões — use { text, role, handler? }. Sem botões = só "OK". */
  buttons?: AlertOptions['buttons'];
  /** Classe CSS opcional pro alert (ex.: 'alert-tipo-conta'). */
  cssClass?: string | string[];
}

/**
 * Helper centralizado pra criar alerts/confirms padronizados no app.
 *
 * **Por que existe**: o `AlertController` do Ionic aceita HTML cru, e devs
 * acabavam escrevendo `<b>` / `<br>` direto na string — quando o Ionic
 * escapava HTML (default em alguns modos), o usuário via `<b>` como texto.
 * Mesmo com `innerHTMLTemplatesEnabled: true` agora habilitado, queremos
 * uma camada uniforme que:
 *   - sanitize input do usuário (sem chance de XSS via dados dinâmicos)
 *   - converta `\n` → `<br>` automaticamente
 *   - converta `**texto**` → `<strong>texto</strong>` (visual de negrito sem HTML cru)
 *
 * Uso típico:
 * ```ts
 * await this.alerts.confirm({
 *   header: 'Tipo de conta diferente',
 *   message: `Você selecionou **SOU ${tipoEscolhido}**, mas esta conta\nestá cadastrada como **${tipoReal}**.`,
 *   confirmar: 'Trocar tipo',
 * });
 * ```
 */
@Injectable({ providedIn: 'root' })
export class AlertService {
  private readonly alertCtrl = inject(AlertController);

  /** Alert simples com botão "OK". Retorna quando fechado. */
  async info(config: AlertConfig): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: config.header,
      message: this.formatarMensagem(config.message ?? ''),
      cssClass: config.cssClass,
      buttons: config.buttons ?? [{ text: 'OK', role: 'cancel' }],
    });
    await alert.present();
    await alert.onDidDismiss();
  }

  /**
   * Confirm com dois botões. Retorna `true` se confirmado, `false` se cancelado.
   * `cancelar`/`confirmar` permitem customizar os labels dos botões.
   */
  async confirm(
    config: AlertConfig & {
      cancelar?: string;
      confirmar?: string;
      /** Quando true, o botão "confirmar" usa estilo destrutivo (vermelho). */
      destrutivo?: boolean;
    },
  ): Promise<boolean> {
    return new Promise(resolve => {
      void this.alertCtrl
        .create({
          header: config.header,
          message: this.formatarMensagem(config.message ?? ''),
          cssClass: config.cssClass,
          buttons: [
            {
              text: config.cancelar ?? 'Cancelar',
              role: 'cancel',
              handler: () => resolve(false),
            },
            {
              text: config.confirmar ?? 'Confirmar',
              role: config.destrutivo ? 'destructive' : 'confirm',
              handler: () => resolve(true),
            },
          ],
        })
        .then(alert => alert.present());
    });
  }

  /**
   * Formata a mensagem aplicando duas conversões:
   *  1. Escapa HTML cru pra evitar XSS (transforma `<` em `&lt;`, etc.)
   *  2. Reintroduz só os marcadores seguros: `**texto**` → `<strong>`, `\n` → `<br>`
   * Resultado é uma string segura pra `alert.message` mesmo com
   * `innerHTMLTemplatesEnabled: true`.
   */
  private formatarMensagem(raw: string): string {
    // 1) Escapa TUDO (incluindo tags HTML que o dev tenha escrito por engano)
    const escapado = raw
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    // 2) Reintroduz só marcadores controlados
    return escapado
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  }
}
