import {
  Directive,
  ElementRef,
  HostListener,
  Renderer2,
  inject,
} from '@angular/core';

/**
 * Adiciona um SKELETON SHIMMER em qualquer `<img>` enquanto a imagem
 * não terminou de carregar. Ao carregar (ou falhar), remove o skeleton.
 *
 * Aplica-se via seletor `img[skel]`:
 *
 *   <img skel src="..." alt="..." />
 *
 * O estilo do skeleton vive em `global.scss` (`.is-img-loading`),
 * pra reutilizar em qualquer tela sem importar o módulo aqui.
 */
@Directive({
  selector: 'img[skel]',
  standalone: false,
})
export class ImgSkeletonDirective {
  private readonly el = inject(ElementRef<HTMLImageElement>);
  private readonly renderer = inject(Renderer2);

  constructor() {
    // Marca como carregando ASSIM que o elemento é criado. Se a imagem
    // já está no cache, o `load` event dispara em seguida e o estado
    // some imediatamente — sem flash perceptível.
    this.renderer.addClass(this.el.nativeElement, 'is-img-loading');
  }

  @HostListener('load')
  onLoad(): void {
    this.renderer.removeClass(this.el.nativeElement, 'is-img-loading');
  }

  @HostListener('error')
  onError(): void {
    this.renderer.removeClass(this.el.nativeElement, 'is-img-loading');
    // Marca como erro pra eventualmente estilizar diferente
    this.renderer.addClass(this.el.nativeElement, 'is-img-error');
  }
}
