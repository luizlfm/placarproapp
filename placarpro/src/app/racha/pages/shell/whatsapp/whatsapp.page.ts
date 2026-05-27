import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { RachaService } from '../../../racha.service';
import { Racha } from '../../../models/racha.model';

/**
 * Página WhatsApp do Racha — integração via deep links `wa.me`.
 *
 * NÃO é bot completo (isso exigiria WhatsApp Business API — paga, com
 * aprovação Meta, webhooks server-side). É a versão MVP que entrega ~80%
 * do valor:
 *
 *  1. Admin salva o link do grupo (`chat.whatsapp.com/XXX`)
 *  2. Botões geram mensagens pré-formatadas (lista, sorteio, próximo jogo)
 *  3. Cada botão abre WhatsApp via `wa.me/?text=ENCODED` — usuário
 *     escolhe o grupo e a mensagem já vem pronta pra enviar
 *  4. Fallback "copiar texto" pra desktop sem WhatsApp instalado
 *
 * Pra ligar bot real no futuro, basta substituir `wa.me` por chamada
 * a uma Cloud Function que dispara via WhatsApp Business API.
 */
@Component({
  selector: 'app-racha-whatsapp',
  templateUrl: './whatsapp.page.html',
  styleUrls: ['./whatsapp.page.scss'],
  standalone: false,
})
export class RachaWhatsappPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly rachaSrv = inject(RachaService);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);

  racha?: Racha;
  rachaId = '';
  /** Stream subscription. */
  private sub?: Subscription;
  /** Salvando alguma mudança no doc (link do grupo, chave PIX). */
  salvando = false;

  ngOnInit(): void {
    this.rachaId = this.route.snapshot.parent?.paramMap.get('id') ?? '';
    if (!this.rachaId) {
      this.router.navigateByUrl('/racha');
      return;
    }
    this.sub = this.rachaSrv.get$(this.rachaId).subscribe(r => {
      this.racha = r;
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  /** True quando o admin já configurou o link do grupo. Controla quais
   *  ações ficam disponíveis (sem grupo, só pode salvar). */
  get grupoConfigurado(): boolean {
    return !!this.racha?.whatsappGrupoLink;
  }

  voltar(): void {
    if (this.rachaId) {
      this.router.navigate(['/racha', this.rachaId, 'inicio']);
    } else {
      this.router.navigateByUrl('/racha');
    }
  }

  // ============== Configuração do grupo ==============

  /** Mostra alert com input pra colar o link do grupo do WhatsApp. */
  async configurarGrupo(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Link do grupo WhatsApp',
      message:
        'Cole o link de convite do grupo (Configurações do grupo → Convite via link). ' +
        'Esse link é usado pra abrir o grupo direto pelo app.',
      inputs: [
        {
          name: 'link',
          type: 'url',
          placeholder: 'https://chat.whatsapp.com/...',
          value: this.racha?.whatsappGrupoLink ?? '',
        },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Salvar',
          handler: async (data: { link: string }) => {
            const link = (data.link ?? '').trim();
            if (link && !link.startsWith('https://chat.whatsapp.com/')) {
              await this.toast(
                'Link inválido. Use o formato https://chat.whatsapp.com/...',
                'danger',
              );
              return false;
            }
            await this.salvarGrupoLink(link);
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  private async salvarGrupoLink(link: string): Promise<void> {
    if (!this.racha?.id) return;
    this.salvando = true;
    try {
      await this.rachaSrv.atualizar(this.racha.id, { whatsappGrupoLink: link });
      await this.toast(link ? 'Grupo conectado! 🎉' : 'Link removido.', 'success');
    } catch (err) {
      console.error('[Whatsapp] salvar link erro', err);
      await this.toast('Erro ao salvar.', 'danger');
    } finally {
      this.salvando = false;
    }
  }

  /** Configurar chave PIX — útil pra cobranças nas mensagens. */
  async configurarPix(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Chave PIX do racha',
      message: 'Será incluída nas mensagens de cobrança automática.',
      inputs: [
        {
          name: 'chave',
          type: 'text',
          placeholder: 'CPF, e-mail, telefone ou chave aleatória',
          value: this.racha?.chavePix ?? '',
        },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Salvar',
          handler: async (data: { chave: string }) => {
            const chave = (data.chave ?? '').trim();
            if (!this.racha?.id) return true;
            this.salvando = true;
            try {
              await this.rachaSrv.atualizar(this.racha.id, { chavePix: chave });
              await this.toast(chave ? 'PIX salvo.' : 'PIX removido.', 'success');
            } catch (err) {
              console.error('[Whatsapp] salvar pix erro', err);
              await this.toast('Erro ao salvar.', 'danger');
            } finally {
              this.salvando = false;
            }
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  /** Abre o grupo do WhatsApp em nova aba — admin precisa estar logado no Zap. */
  abrirGrupo(): void {
    const link = this.racha?.whatsappGrupoLink;
    if (!link) {
      void this.configurarGrupo();
      return;
    }
    window.open(link, '_blank', 'noopener');
  }

  // ============== Geração de mensagens ==============

  /** Helper genérico: abre WhatsApp com mensagem pré-formatada.
   *  Em mobile, abre o app direto. Em desktop, abre o WhatsApp Web.
   *  Usuário escolhe o grupo destino — mensagem já vem pronta. */
  private compartilharNoWhatsapp(mensagem: string): void {
    const encoded = encodeURIComponent(mensagem);
    // wa.me sem número → abre picker de contatos/grupos
    window.open(`https://wa.me/?text=${encoded}`, '_blank', 'noopener');
  }

  /** Lista de presença — link público pra galera confirmar presença. */
  compartilharListaPresenca(): void {
    const r = this.racha;
    if (!r) return;
    // TODO: quando tiver rota pública de presença, usar `/racha/{slug}/presenca`.
    // Por enquanto usa o convite genérico.
    const link = this.linkPublico();
    const data = this.formatarProximoJogo();
    const msg =
      `🔔 *Lista de presença aberta!* — ${r.nome}\n\n` +
      `${data ? `📅 ${data}\n` : ''}` +
      `${r.local ? `📍 ${r.local}\n` : ''}` +
      `\nConfirma sua presença aqui:\n${link}\n\n` +
      `Vagas: ${r.capacidadeTotal ?? 0}. Quem chegar primeiro confirma.`;
    this.compartilharNoWhatsapp(msg);
  }

  /** Avisar próxima pelada — data, horário, local. */
  compartilharProximoJogo(): void {
    const r = this.racha;
    if (!r) return;
    const data = this.formatarProximoJogo();
    const link = this.linkPublico();
    const msg =
      `⚽ *${r.nome}* — próximo jogo!\n\n` +
      `${data ? `📅 ${data}\n` : '📅 Data a confirmar\n'}` +
      `${r.local ? `📍 ${r.local}\n` : ''}` +
      `${r.tipoCampo ? `🏟️ ${r.tipoCampo}\n` : ''}` +
      `👥 ${r.qtdTimes ?? 2} times de ${r.jogadoresPorTime ?? 5} jogadores\n` +
      `\nLink pra acompanhar / confirmar presença:\n${link}`;
    this.compartilharNoWhatsapp(msg);
  }

  /** Cobrança PIX (mensalidade / diária). */
  compartilharCobranca(): void {
    const r = this.racha;
    if (!r) return;
    if (!r.chavePix) {
      void this.toast('Configure sua chave PIX primeiro (botão acima).', 'medium');
      return;
    }
    const valor = r.mensalistaPadraoRs ?? 0;
    const msg =
      `💰 *Cobrança do racha — ${r.nome}*\n\n` +
      `${valor > 0 ? `Valor: R$ ${valor.toFixed(2).replace('.', ',')}\n` : ''}` +
      `Chave PIX: \`${r.chavePix}\`\n\n` +
      `Depois de pagar, manda o comprovante aqui no grupo. 🙏`;
    this.compartilharNoWhatsapp(msg);
  }

  /** Compartilhar link do convite/grupo aberto (pra novos jogadores entrarem). */
  compartilharConvite(): void {
    const r = this.racha;
    if (!r) return;
    const link = this.linkPublico();
    const grupoLink = r.whatsappGrupoLink;
    const msg =
      `🎉 *Bem-vindo(a) ao ${r.nome}!*\n\n` +
      `Acompanhe os jogos, ranking e lista de presença aqui:\n${link}\n\n` +
      `${grupoLink ? `📱 E entre no grupo do WhatsApp:\n${grupoLink}` : ''}`;
    this.compartilharNoWhatsapp(msg);
  }

  // ============== Helpers ==============

  /** Monta o link público do racha (slug se tiver, senão ID). */
  private linkPublico(): string {
    const r = this.racha;
    if (!r) return '';
    const slug = r.slug || r.id || '';
    return `${location.origin}/racha/c/${slug}`;
  }

  /** Formata "dia da semana + horário" em string amigável. Retorna string
   *  vazia quando nenhum dos campos está preenchido. */
  private formatarProximoJogo(): string {
    const r = this.racha;
    if (!r) return '';
    const diaLabel: Record<string, string> = {
      dom: 'Domingo',
      seg: 'Segunda',
      ter: 'Terça',
      qua: 'Quarta',
      qui: 'Quinta',
      sex: 'Sexta',
      sab: 'Sábado',
    };
    const dia = r.diaSemana ? diaLabel[r.diaSemana] : '';
    const hora = r.horarioInicio || r.horario || '';
    return [dia, hora].filter(Boolean).join(' às ');
  }

  // ============== Toast ==============

  private async toast(
    message: string,
    color: 'success' | 'danger' | 'medium' = 'success',
  ): Promise<void> {
    const t = await this.toastCtrl.create({
      message,
      duration: 2400,
      position: 'top',
      color,
    });
    await t.present();
  }
}
