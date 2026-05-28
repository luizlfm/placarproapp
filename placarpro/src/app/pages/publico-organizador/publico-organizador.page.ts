import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { UsersService } from '../../users/users.service';
import { UserProfile } from '../../users/models/user-profile.model';
import { CampeonatosService } from '../../campeonatos/campeonatos.service';
import { Campeonato } from '../../campeonatos/campeonato.model';

/** Abas/seções da página pública do organizador. */
type AbaOrg = 'inicio' | 'galeria' | 'sobre' | 'contatos';

interface AbaItem {
  id: AbaOrg;
  label: string;
  icon: string;
}

/**
 * Página pública do ORGANIZADOR — `/org/:slug`.
 *
 * Estilo copafacil.com/{slug}: mostra dados do organizador (logo, nome,
 * banner, sobre, redes sociais) + grid de campeonatos públicos dele.
 *
 * Acesso sem login.
 */
@Component({
  selector: 'app-publico-organizador',
  templateUrl: './publico-organizador.page.html',
  styleUrls: ['./publico-organizador.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class PublicoOrganizadorPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly usersSrv = inject(UsersService);
  private readonly campsSrv = inject(CampeonatosService);

  loading = true;
  erro = false;
  org?: UserProfile & { id: string };
  campeonatos$: Observable<Campeonato[]> = of([]);

  /** Banner padrão usado quando o organizador ainda não enviou banner. */
  readonly bannerPadrao = 'assets/branding/banner-default.svg';

  /** Retorna a URL de banner a exibir: a do organizador OU a padrão. */
  bannerOrg(o: UserProfile | null | undefined): string {
    return o?.bannerSiteUrl || o?.bannerAppUrl || this.bannerPadrao;
  }

  /** Tab atual exibida (sub-rota via query/path param ou só local). */
  aba: AbaOrg = 'inicio';

  /** Abas do menu — estilo copafacil.com/{slug}/{gallery|about|contacts}. */
  readonly abas: AbaItem[] = [
    { id: 'inicio',   label: 'Início',    icon: 'home-outline' },
    { id: 'galeria',  label: 'Galeria',   icon: 'images-outline' },
    { id: 'sobre',    label: 'Sobre',     icon: 'information-circle-outline' },
    { id: 'contatos', label: 'Contatos',  icon: 'call-outline' },
  ];

  selecionarAba(id: AbaOrg): void {
    this.aba = id;
    // Atualiza a URL pra refletir a aba (estilo copafacil /y7ah/gallery).
    // Usa `replaceUrl: true` pra não poluir o histórico do browser.
    const slug = this.route.snapshot.paramMap.get('slug') ?? '';
    if (!slug) return;
    const path = id === 'inicio' ? ['/', 'org', slug] : ['/', 'org', slug, id];
    void this.router.navigate(path, { replaceUrl: true });
  }

  async ngOnInit(): Promise<void> {
    const slug = this.route.snapshot.paramMap.get('slug') ?? '';
    // Sub-rota opcional /{aba} — mapeia gallery/about/contacts (estilo copafacil)
    // pros ids internos. Se inválida ou ausente, default = 'inicio'.
    this.aba = this.parseAba(this.route.snapshot.paramMap.get('aba'));
    if (!slug) {
      this.erro = true;
      this.loading = false;
      return;
    }

    try {
      const org = await this.usersSrv.getBySlug(slug);
      if (!org) {
        this.erro = true;
        return;
      }
      this.org = org;
      this.campeonatos$ = this.campsSrv.listPublicosDoOwner$(org.id).pipe(
        catchError(err => {
          console.warn('[PublicoOrganizador] erro lista', err);
          return of([] as Campeonato[]);
        }),
      );
    } catch (err) {
      console.error('[PublicoOrganizador] erro', err);
      this.erro = true;
    } finally {
      this.loading = false;
    }
  }

  /** Aceita aliases em inglês (gallery, about, contacts) e PT-BR (galeria, sobre, contatos). */
  private parseAba(raw: string | null): AbaOrg {
    const v = (raw ?? '').toLowerCase();
    if (v === 'gallery' || v === 'galeria') return 'galeria';
    if (v === 'about'   || v === 'sobre')   return 'sobre';
    if (v === 'contacts'|| v === 'contatos') return 'contatos';
    return 'inicio';
  }

  /** Constrói o link wa.me a partir do whatsapp do organizador.
   *  Remove tudo que não é dígito (parser do Angular template não aceita
   *  regex inline, por isso fica aqui). Retorna null se não houver número. */
  waLink(whatsapp?: string | null): string | null {
    if (!whatsapp) return null;
    const digits = whatsapp.replace(/\D/g, '');
    if (!digits) return null;
    return `https://wa.me/${digits}`;
  }

  // ─── Formulário "Fale Conosco" (aba Contatos) ───
  fcNome = '';
  fcEmail = '';
  fcTelefone = '';
  fcAssunto = '';
  fcMensagem = '';

  /**
   * Submete o formulário "Fale Conosco" — abre o cliente de email do user
   * com `mailto:` pré-preenchido. Sem backend, MVP funciona via mail nativo.
   */
  enviarFaleConosco(): void {
    if (!this.org?.email) return;
    const corpo = [
      `Nome: ${this.fcNome}`,
      `Email: ${this.fcEmail}`,
      this.fcTelefone ? `Telefone: ${this.fcTelefone}` : '',
      '',
      this.fcMensagem,
      '',
      '— Enviado via página pública do PlacarPro',
    ].filter(l => l !== '').join('\n');
    const url =
      `mailto:${this.org.email}` +
      `?subject=${encodeURIComponent(this.fcAssunto || 'Contato pela página pública')}` +
      `&body=${encodeURIComponent(corpo)}`;
    window.location.href = url;
  }

  /** Abre a página pública do campeonato (uma das opções renderizadas no grid). */
  abrirCampeonato(c: Campeonato): void {
    const slug = c.slug || c.id;
    if (!slug) return;
    void this.router.navigate(['/', slug]);
  }

  /** Voltar pra home pública. */
  voltarHome(): void {
    void this.router.navigateByUrl('/');
  }

  trackById(_i: number, c: Campeonato): string {
    return c.id ?? '';
  }
}
