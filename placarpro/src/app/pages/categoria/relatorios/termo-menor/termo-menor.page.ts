import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Observable, combineLatest, firstValueFrom, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { CampeonatosService } from '../../../../campeonatos/campeonatos.service';
import { CategoriasService } from '../../../../campeonatos/categorias.service';
import { Campeonato } from '../../../../campeonatos/campeonato.model';
import { Categoria } from '../../../../campeonatos/categoria.model';
import { NavBackService } from '../../../../shared/nav-back.service';

/**
 * Slots de logo no cabeçalho do termo (esquerda, centro, direita).
 * Cada slot tem URL e label opcional para acessibilidade.
 */
interface LogoSlot {
  id: 'esquerda' | 'centro' | 'direita';
  url: string;
  label: string;
}

/**
 * Página dedicada para gerar o "Termo de Autorização para Menor de 18 anos"
 * a partir de um modelo editável. O usuário pode:
 *
 *  - Substituir os 3 logos do cabeçalho (esquerda/centro/direita)
 *  - Editar o título do evento ("5ª COPA REGIONAL SPORT+ DE FUTEBOL SOCIETY")
 *  - Editar o ano
 *  - Editar o nome do organizador ("JOGA 10 SPORTS")
 *  - Imprimir/exportar como PDF via window.print()
 *
 * Todos os campos editáveis ficam num painel lateral (`.painel-edit`) — o
 * preview do termo é live e atualiza conforme o usuário digita.
 *
 * Rota: `/app/campeonato/:id/categoria/:catId/relatorios/termo-menor`
 */
@Component({
  selector: 'app-termo-menor',
  templateUrl: './termo-menor.page.html',
  styleUrls: ['./termo-menor.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class TermoMenorPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly campsSrv = inject(CampeonatosService);
  private readonly catsSrv = inject(CategoriasService);
  private readonly navBack = inject(NavBackService);

  readonly campeonatoId = this.route.snapshot.paramMap.get('id') ?? '';
  readonly categoriaId = this.route.snapshot.paramMap.get('catId') ?? '';

  /** Configuração editável do termo (em memória — não persiste por enquanto). */
  config = {
    /** Título principal do evento. Quebra automaticamente em 2-3 linhas. */
    titulo: '5ª COPA REGIONAL SPORT+ DE FUTEBOL SOCIETY',
    /** Ano do evento — aparece no título e nos parágrafos. */
    ano: new Date().getFullYear(),
    /** Nome do organizador (JOGA 10 SPORTS no modelo original). */
    organizador: 'JOGA 10 SPORTS',
    /**
     * Texto livre da declaração de responsabilidade. Permite edição
     * fina pra ajustar caso a federação tenha texto específico.
     */
    declaracao:
      'bem como também declaro que meu filho ( ou quem esteja sob minha guarda) ' +
      'possui plena saúde física e mental, isentando de responsabilidade civil e penal ' +
      'os administradores e {{organizador}}, no caso de ocorrência de eventos danosos ' +
      'e/ou sinistros adivinhos da disputa dos jogos, bem como por qualquer ocultação ' +
      'de informações sobre eventuais problemas de saúde.',
  };

  /** 3 slots de logo. Padrão: vazio (placeholder cinza). */
  logos: LogoSlot[] = [
    { id: 'esquerda', url: '', label: 'Logo Esquerda' },
    { id: 'centro',   url: '', label: 'Logo Centro' },
    { id: 'direita',  url: '', label: 'Logo Direita' },
  ];

  /** Stream dos dados do campeonato e categoria — usado pra pré-preencher. */
  contexto$: Observable<{ campeonato?: Campeonato; categoria?: Categoria }> = of({});

  ngOnInit(): void {
    if (!this.campeonatoId || !this.categoriaId) return;
    this.contexto$ = this.montarContexto();
    // Tenta pré-preencher logo central com a logo do campeonato
    void this.preencherDoCampeonato();
  }

  voltar(): void {
    this.navBack.back([
      '/app/campeonato',
      this.campeonatoId,
      'categoria',
      this.categoriaId,
      'relatorios',
    ]);
  }

  imprimir(): void {
    window.print();
  }

  /** Handler do input file por slot — converte a imagem em data URL. */
  onArquivoSelecionado(slot: LogoSlot, ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      slot.url = reader.result as string;
    };
    reader.readAsDataURL(file);
    // Reset do input pra permitir re-selecionar o mesmo arquivo
    input.value = '';
  }

  /** Remove o logo de um slot. */
  limparLogo(slot: LogoSlot): void {
    slot.url = '';
  }

  /**
   * Restaura os valores padrão da configuração — útil quando o usuário
   * "perdeu" a edição e quer começar do zero.
   */
  restaurarPadrao(): void {
    this.config = {
      titulo: '5ª COPA REGIONAL SPORT+ DE FUTEBOL SOCIETY',
      ano: new Date().getFullYear(),
      organizador: 'JOGA 10 SPORTS',
      declaracao:
        'bem como também declaro que meu filho ( ou quem esteja sob minha guarda) ' +
        'possui plena saúde física e mental, isentando de responsabilidade civil e penal ' +
        'os administradores e {{organizador}}, no caso de ocorrência de eventos danosos ' +
        'e/ou sinistros adivinhos da disputa dos jogos, bem como por qualquer ocultação ' +
        'de informações sobre eventuais problemas de saúde.',
    };
    this.logos.forEach(l => (l.url = ''));
    void this.preencherDoCampeonato();
  }

  /**
   * Renderiza a declaração substituindo `{{organizador}}` pelo nome configurado.
   * Mantido como pipe inline aqui (não vale a pena criar um pipe Angular).
   */
  declaracaoRenderizada(): string {
    return this.config.declaracao.replaceAll(
      '{{organizador}}',
      this.config.organizador || '___________',
    );
  }

  /**
   * Stream dos dados de contexto (campeonato + categoria). Usado só pra
   * exibir o título da página e pra pré-preencher o título quando o
   * campeonato já tem nome cadastrado.
   */
  private montarContexto(): Observable<{
    campeonato?: Campeonato;
    categoria?: Categoria;
  }> {
    const camp$ = this.campsSrv
      .get$(this.campeonatoId)
      .pipe(catchError(() => of(undefined)));
    const cat$ = this.catsSrv
      .get$(this.campeonatoId, this.categoriaId)
      .pipe(catchError(() => of(undefined)));

    return combineLatest([camp$, cat$]).pipe(
      map(([campeonato, categoria]) => ({ campeonato, categoria })),
    );
  }

  /**
   * Tenta carregar o nome do campeonato e a logo dele pra inicializar o
   * formulário. Só dispara uma vez (no ngOnInit). Se já houver edição, NÃO
   * sobrescreve — só preenche slots vazios.
   */
  private async preencherDoCampeonato(): Promise<void> {
    try {
      const camp = await firstValueFrom(this.campsSrv.get$(this.campeonatoId));
      if (!camp) return;
      // Se o título ainda é o default, substitui pelo nome do campeonato
      if (camp.titulo && this.config.titulo.startsWith('5ª COPA REGIONAL')) {
        this.config.titulo = camp.titulo.toUpperCase();
      }
      // Se o logo central está vazio, preenche com a logo do campeonato
      const centro = this.logos.find(l => l.id === 'centro');
      if (centro && !centro.url && camp.logoUrl) {
        centro.url = camp.logoUrl;
      }
    } catch {
      /* silencioso — usa defaults */
    }
  }
}
