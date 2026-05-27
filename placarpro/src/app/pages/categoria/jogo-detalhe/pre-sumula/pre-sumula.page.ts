import { Component, ElementRef, OnInit, ViewChild, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { LoadingController, ToastController } from '@ionic/angular';
import { Observable, combineLatest, firstValueFrom, of } from 'rxjs';
import { catchError, map, startWith } from 'rxjs/operators';
import { CampeonatosService } from '../../../../campeonatos/campeonatos.service';
import { CategoriasService } from '../../../../campeonatos/categorias.service';
import { JogosService } from '../../../../campeonatos/jogos.service';
import { EquipesService } from '../../../../campeonatos/equipes.service';
import { JogadoresService } from '../../../../campeonatos/jogadores.service';
import { Campeonato } from '../../../../campeonatos/campeonato.model';
import {
  Categoria,
  LogoHeaderPreSumula,
  PRE_SUMULA_CONFIG_PADRAO,
  PreSumulaConfig,
} from '../../../../campeonatos/categoria.model';
import { Equipe } from '../../../../campeonatos/models/equipe.model';
import { Jogador } from '../../../../campeonatos/models/jogador.model';
import { Jogo } from '../../../../campeonatos/models/jogo.model';
import { StorageService } from '../../../../shared/storage.service';
import { AuthService } from '../../../../auth/auth.service';
import { NavBackService } from '../../../../shared/nav-back.service';

interface PreSumulaView {
  campeonato?: Campeonato;
  categoria?: Categoria;
  jogo: Jogo;
  mandante?: Equipe;
  visitante?: Equipe;
  jogadoresMand: Jogador[];
  jogadoresVis: Jogador[];
}

/**
 * Página de Pré-Súmula com layout WYSIWYG + painel lateral de edição.
 * (Estilo carteirinhas-preview — não usa modal, controles ficam dentro da tela.)
 *
 * Esquerda: painel de configurações (toggle pra recolher).
 * Direita: visualização do documento que vai imprimir (folha A4 por equipe).
 *
 * O usuário edita os campos no painel e o preview atualiza em tempo real.
 * "Salvar" persiste `categoria.preSumulaConfig` no Firestore.
 * "Imprimir" dispara `window.print()` — o painel some via @media print.
 *
 * Rota: `/app/campeonato/:id/categoria/:catId/jogo/:jogoId/pre-sumula`
 */
@Component({
  selector: 'app-pre-sumula',
  templateUrl: './pre-sumula.page.html',
  styleUrls: ['./pre-sumula.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class PreSumulaPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly campsSrv = inject(CampeonatosService);
  private readonly catsSrv = inject(CategoriasService);
  private readonly jogosSrv = inject(JogosService);
  private readonly equipesSrv = inject(EquipesService);
  private readonly jogadoresSrv = inject(JogadoresService);
  private readonly storage = inject(StorageService);
  private readonly auth = inject(AuthService);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toastCtrl = inject(ToastController);
  private readonly navBack = inject(NavBackService);

  @ViewChild('logoPicker') logoPicker?: ElementRef<HTMLInputElement>;

  readonly campeonatoId = this.lerParam('id');
  readonly categoriaId = this.lerParam('catId');
  readonly jogoId = this.lerParam('jogoId');

  /** Quantidade fixa de linhas em cada tabela (encaixa em A4). */
  readonly LINHAS_JOGADORES = 18;
  /** Limite de logos extras no header. */
  readonly MAX_LOGOS = 4;

  /** Dados do jogo + equipes carregados via stream. */
  view$: Observable<PreSumulaView | undefined> = of(undefined);

  /** Config local — espelho do que está no Firestore, mas mutável aqui. */
  config: PreSumulaConfig = {
    ...PRE_SUMULA_CONFIG_PADRAO,
    tituloLinhas: ['', '', ''],
  };

  /** Painel lateral aberto/fechado (estilo carteirinhas-preview). */
  painelAberto = true;
  /** True enquanto carrega dados iniciais. */
  loading = true;
  /** True enquanto está persistindo no Firestore. */
  salvando = false;

  async ngOnInit(): Promise<void> {
    if (!this.campeonatoId || !this.categoriaId || !this.jogoId) {
      this.loading = false;
      return;
    }
    try {
      // Carrega a config atual da categoria pra preencher o painel.
      const cat = await firstValueFrom(this.catsSrv.get$(this.campeonatoId, this.categoriaId));
      const salvo = cat?.preSumulaConfig ?? {};
      const tit = [...(salvo.tituloLinhas ?? [])];
      // Garante 3 slots fixos pra simplificar o template (sempre 3 inputs).
      while (tit.length < 3) tit.push('');
      this.config = {
        ...PRE_SUMULA_CONFIG_PADRAO,
        ...salvo,
        tituloLinhas: tit.slice(0, 3),
        logosExtras: [...(salvo.logosExtras ?? [])],
      };
      // Migração de formato legado (v1 → v2).
      if (!this.config.tituloLinhas?.some(l => l.trim().length > 0)) {
        const legacy = [salvo.tituloCustom, salvo.subtituloCustom]
          .filter((s): s is string => !!s && s.trim().length > 0);
        if (legacy.length > 0) {
          const novo = [...legacy];
          while (novo.length < 3) novo.push('');
          this.config.tituloLinhas = novo.slice(0, 3);
        }
      }
    } catch (err) {
      console.warn('[PreSumula] load config erro', err);
    }
    this.view$ = this.montar();
    this.loading = false;
  }

  // ─────────── Painel lateral ───────────
  togglePainel(): void { this.painelAberto = !this.painelAberto; }

  voltar(): void {
    this.navBack.back([
      '/app/campeonato', this.campeonatoId,
      'categoria', this.categoriaId,
      'relatorios',
    ]);
  }

  imprimir(): void {
    window.print();
  }

  // ─────────── Setters do painel ───────────
  setLinha(idx: number, v: string): void {
    const linhas = [...(this.config.tituloLinhas ?? ['', '', ''])];
    linhas[idx] = v;
    this.config.tituloLinhas = linhas;
  }
  setLegenda(idx: number, v: string): void {
    const logos = [...(this.config.logosExtras ?? [])];
    if (logos[idx]) {
      logos[idx] = { ...logos[idx], legenda: v };
      this.config.logosExtras = logos;
    }
  }
  setUmaTabela(v: boolean): void { this.config.umaTabelaPorEquipe = v; }
  setIncluirFotos(v: boolean): void { this.config.incluirFotosJogadores = v; }
  setLinhasObs(v: number): void {
    this.config.linhasObservacoes = Math.max(0, Math.min(20, Math.floor(v || 0)));
  }

  // ─────────── Upload de logos ───────────
  acionarUploadLogo(): void {
    const total = this.config.logosExtras?.length ?? 0;
    if (total >= this.MAX_LOGOS) {
      void this.toast(`Limite de ${this.MAX_LOGOS} logos atingido.`, 'danger');
      return;
    }
    this.logoPicker?.nativeElement.click();
  }

  async onLogoEscolhido(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file) return;
    const uid = this.auth.currentUser?.uid;
    if (!uid) return;

    const loader = await this.loadingCtrl.create({ message: 'Enviando logo...' });
    await loader.present();
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `users/${uid}/campeonatos/${this.campeonatoId}/categorias/${this.categoriaId}/pre-sumula/${Date.now()}-${safe}`;
      const url = await this.storage.upload(path, file);
      const novo: LogoHeaderPreSumula = { url, path };
      this.config.logosExtras = [...(this.config.logosExtras ?? []), novo];
    } catch (err) {
      console.error('[PreSumula] upload logo erro', err);
      await this.toast('Falha ao enviar a logo.', 'danger');
    } finally {
      await loader.dismiss();
    }
  }

  async removerLogo(idx: number): Promise<void> {
    const logos = [...(this.config.logosExtras ?? [])];
    const removido = logos[idx];
    if (!removido) return;
    logos.splice(idx, 1);
    this.config.logosExtras = logos;
    if (removido.path) {
      try { await this.storage.remove(removido.path); } catch { /* ignore */ }
    }
  }

  // ─────────── Persistência ───────────
  async salvar(): Promise<void> {
    this.salvando = true;
    try {
      const linhas = (this.config.tituloLinhas ?? [])
        .map(l => l.trim())
        .filter(l => l.length > 0);
      const limpo: PreSumulaConfig = {
        tituloLinhas: linhas,
        logosExtras: (this.config.logosExtras ?? []).map(l => ({
          url: l.url,
          ...(l.path ? { path: l.path } : {}),
          ...(l.legenda?.trim() ? { legenda: l.legenda.trim() } : {}),
        })),
        umaTabelaPorEquipe: this.config.umaTabelaPorEquipe ?? true,
        incluirFotosJogadores: !!this.config.incluirFotosJogadores,
        linhasObservacoes: this.config.linhasObservacoes ?? 0,
      };
      await this.catsSrv.atualizar(this.campeonatoId, this.categoriaId, {
        preSumulaConfig: limpo,
      });
      await this.toast('Salvo!', 'success');
    } catch (err) {
      console.error('[PreSumula] salvar erro', err);
      await this.toast('Falha ao salvar.', 'danger');
    } finally {
      this.salvando = false;
    }
  }

  // ─────────── Helpers do preview ───────────
  preencherLinhas<T>(arr: T[] | undefined, n: number): Array<T | undefined> {
    const out: Array<T | undefined> = [...(arr ?? [])];
    while (out.length < n) out.push(undefined);
    return out.slice(0, n);
  }

  preencherJogadores(arr: Jogador[] | undefined, n: number): Array<Jogador | undefined> {
    return this.preencherLinhas<Jogador>(arr, n);
  }

  range(n: number): number[] {
    return Array.from({ length: Math.max(0, n) }, (_, i) => i + 1);
  }

  formatarSomenteData(iso?: string | null): string {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      return `${dd}/${mm}/${d.getFullYear()}`;
    } catch { return iso; }
  }

  formatarHora(iso?: string | null): string {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      const hh = String(d.getHours()).padStart(2, '0');
      const mi = String(d.getMinutes()).padStart(2, '0');
      return `${hh}:${mi}`;
    } catch { return ''; }
  }

  trackByIdx(i: number): number { return i; }

  /** True se alguma linha do título tem conteúdo. Usado pra escolher entre
   *  mostrar as linhas custom ou o fallback do título do campeonato. */
  temAlgumaLinha(linhas: string[] | undefined): boolean {
    return !!linhas && linhas.some(l => l && l.trim().length > 0);
  }

  // ─────────── Stream principal (só dados do jogo) ───────────
  private montar(): Observable<PreSumulaView | undefined> {
    const safe = <T>(o$: Observable<T>, fb: T): Observable<T> =>
      o$.pipe(startWith(fb), catchError(() => of(fb)));

    const campeonato$ = safe(this.campsSrv.get$(this.campeonatoId), undefined as Campeonato | undefined);
    const categoria$ = safe(
      this.catsSrv.get$(this.campeonatoId, this.categoriaId),
      undefined as Categoria | undefined,
    );
    const jogo$ = safe(
      this.jogosSrv.get$(this.campeonatoId, this.categoriaId, this.jogoId),
      undefined as Jogo | undefined,
    );
    const equipes$ = safe(this.equipesSrv.list$(this.campeonatoId, this.categoriaId), [] as Equipe[]);
    const jogadores$ = safe(this.jogadoresSrv.list$(this.campeonatoId, this.categoriaId), [] as Jogador[]);

    return combineLatest([campeonato$, categoria$, jogo$, equipes$, jogadores$]).pipe(
      map(([camp, cat, jogo, equipes, jogadores]) => {
        if (!jogo) return undefined;
        return {
          campeonato: camp,
          categoria: cat,
          jogo,
          mandante: equipes.find(e => e.id === jogo.mandanteId),
          visitante: equipes.find(e => e.id === jogo.visitanteId),
          jogadoresMand: jogadores
            .filter(j => j.equipeId === jogo.mandanteId)
            .sort((a, b) => (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR')),
          jogadoresVis: jogadores
            .filter(j => j.equipeId === jogo.visitanteId)
            .sort((a, b) => (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR')),
        };
      }),
    );
  }

  private lerParam(name: string): string {
    let cursor: ActivatedRoute | null = this.route;
    while (cursor) {
      const v = cursor.snapshot.paramMap.get(name);
      if (v) return v;
      cursor = cursor.parent;
    }
    return '';
  }

  private async toast(message: string, color: 'success' | 'danger' = 'success'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2200, position: 'top', color });
    await t.present();
  }
}
