export function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Brak wymaganego elementu #${id}.`);
  return node as T;
}

export function show(...nodes: HTMLElement[]): void {
  nodes.forEach((node) => node.classList.remove('hidden'));
}

export function hide(...nodes: HTMLElement[]): void {
  nodes.forEach((node) => node.classList.add('hidden'));
}

export function money(value: number): string {
  return `${(value / 1_000_000).toFixed(1)}M €`;
}

export function replaceChildren(container: HTMLElement, children: Node[]): void {
  container.replaceChildren(...children);
}

export function create<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export const cardClass = 'relative w-[260px] cursor-pointer overflow-hidden rounded-[15px] border border-[#555] bg-[linear-gradient(145deg,#232526,#414345)] p-[25px] text-left shadow-[0_8px_15px_rgba(0,0,0,0.5)] transition-all duration-300 before:absolute before:top-0 before:left-0 before:h-[5px] before:w-full before:bg-brand hover:scale-[1.02] hover:border-brand';
export const disabledCardClass = 'pointer-events-none opacity-40 hover:scale-100 hover:border-[#555]';
export const actionButtonClass = 'cursor-pointer rounded-[25px] bg-[linear-gradient(90deg,#00C9FF_0%,#92FE9D_100%)] px-[30px] py-3 text-base font-bold text-black uppercase shadow-[0_4px_15px_rgba(0,255,128,0.3)] transition-all duration-300 hover:scale-105 hover:shadow-[0_6px_20px_rgba(0,255,128,0.5)]';

export function detail(label: string, value: string): HTMLParagraphElement {
  const paragraph = create('p', 'my-[5px] text-[0.9em] text-[#ccc]');
  paragraph.append(document.createTextNode(`${label}: `), create('b', 'text-white', value));
  return paragraph;
}
