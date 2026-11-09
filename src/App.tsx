import { useEffect, useMemo, useRef, useState } from 'react'
import Cena, { frenteItem, idPrat, montarLayout, nomePrat } from './Cena'
import { Item, baixarModelo, fotoDaPeca, fotoEtiquetaSrc, dadosExemplo, dadosReais, endereco, fotoSrc, lerExcel, placeholder } from './dados'

type Dir = 'mais' | 'menos' | 'cima' | 'baixo'

export default function App() {
  const [itens, setItens] = useState<Item[]>(() => dadosReais())
  const [sel, setSel] = useState<Item | null>(null)
  const [foco, setFoco] = useState<string | null>(null) // prateleira em zoom (id "posto-corredor")
  const [preset, setPreset] = useState<{ c: number | null; n: number } | null>(null)
  const [busca, setBusca] = useState('')
  const [erro, setErro] = useState('')
  const [ampliar, setAmpliar] = useState(false)
  const [copiado, setCopiado] = useState(false)
  const [verEtiqueta, setVerEtiqueta] = useState(false)
  const arquivo = useRef<HTMLInputElement>(null)

  useEffect(() => setVerEtiqueta(false), [sel])

  const lay = useMemo(() => montarLayout(itens), [itens])

  const achados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return null
    return new Set(itens.filter(i => `${i.codigo} ${i.cor ?? ''} ${i.nome} ${endereco(i)}`.toLowerCase().includes(q)))
  }, [busca, itens])

  const naPrateleira = (i: Item) => i.tipo === 'prateleira'
  function clicarItem(i: Item) {
    if (naPrateleira(i) && foco !== idPrat(i)) { setFoco(idPrat(i)); setSel(null) }
    else { if (!naPrateleira(i)) setFoco(null); setSel(i) }
  }
  function escolher(i: Item) { setFoco(naPrateleira(i) ? idPrat(i) : null); setSel(i) }
  function fundo() { if (sel) setSel(null); else setFoco(null) }
  function irPara(c: number | null) { setSel(null); setFoco(null); setPreset({ c, n: Date.now() }) }
  function irPrateleira(id: string) { setSel(null); setFoco(id) }

  // vizinho do endereço selecionado (setas do teclado ou botões do painel), só dentro da mesma prateleira ou fileira de racks
  const grupoDe = (i: Item) => (i.tipo === 'prateleira' ? `P${idPrat(i)}` : `R${i.corredor}`)
  function vizinho(d: Dir): Item | undefined {
    if (!sel || sel.semEndereco) return
    const g = grupoDe(sel)
    if (d === 'cima' || d === 'baixo') {
      const alt = String.fromCharCode(sel.altura.charCodeAt(0) + (d === 'cima' ? 1 : -1))
      return itens.find(i => !i.semEndereco && grupoDe(i) === g && i.posto === sel.posto && i.posicao === sel.posicao && i.altura === alt)
    }
    const linha = itens.filter(i => !i.semEndereco && grupoDe(i) === g && i.altura === sel.altura).sort((a, b) => a.posto - b.posto || a.posicao - b.posicao)
    return linha[linha.indexOf(sel) + (d === 'mais' ? 1 : -1)]
  }
  // esquerda/direita na tela dependem de que lado do corredor a câmera está
  const lado = (esq: boolean): Dir => ((esq ? 1 : -1) * (sel ? frenteItem(sel, lay) : 1) === 1 ? 'menos' : 'mais')
  function mover(d: Dir) { const v = vizinho(d); if (v) escolher(v) }

  useEffect(() => {
    function tecla(e: KeyboardEvent) {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.key === 'Escape') { fundo(); return }
      const mapa: Record<string, Dir | 'esq' | 'dir'> = { ArrowLeft: 'esq', ArrowRight: 'dir', ArrowUp: 'cima', ArrowDown: 'baixo' }
      const m = mapa[e.key]
      if (!m || !sel) return
      e.preventDefault()
      mover(m === 'esq' ? lado(true) : m === 'dir' ? lado(false) : m)
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  })

  async function importar(f?: File) {
    if (!f) return
    try {
      const novos = await lerExcel(f)
      if (!novos.length) throw new Error('Nenhuma linha válida (precisa de posto, corredor, posição e altura).')
      setItens(novos); setSel(null); setFoco(null); setBusca(''); setErro('')
    } catch (e) { setErro((e as Error).message) }
  }
  async function copiar() {
    if (!sel) return
    try { await navigator.clipboard.writeText(endereco(sel)); setCopiado(true); setTimeout(() => setCopiado(false), 1500) } catch { /* sem permissão */ }
  }

  const pf = foco != null ? lay.prat.get(foco) : undefined
  const caixasFoco = foco != null ? itens.filter(i => i.tipo === 'prateleira' && idPrat(i) === foco) : []
  const pad = (n: number) => String(n).padStart(2, '0')
  const botoesNav: [string, Dir, string][] = [['◀', lado(true), 'Endereço à esquerda'], ['▲', 'cima', 'Andar de cima'], ['▼', 'baixo', 'Andar de baixo'], ['▶', lado(false), 'Endereço à direita']]

  return (
    <div className="app">
      <header>
        <b>Inventário 3D</b>
        <input
          placeholder="Buscar peça, código ou endereço…"
          value={busca}
          onChange={e => setBusca(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && achados?.size) { escolher([...achados][0]); e.currentTarget.blur() }
            if (e.key === 'Escape') setBusca('')
          }}
        />
        <details className="menu">
          <summary className="btn">Dados ▾</summary>
          <div className="menu-itens" onClick={e => ((e.currentTarget.parentElement) as HTMLDetailsElement).removeAttribute('open')}>
            <button className="btn" onClick={() => arquivo.current?.click()}>Importar Excel</button>
            <button className="btn modelo" onClick={baixarModelo}>Baixar modelo</button>
            <button className="btn" onClick={() => { setItens(dadosReais()); setSel(null); setFoco(null) }}>Dados reais</button>
            <button className="btn" onClick={() => { setItens(dadosExemplo()); setSel(null); setFoco(null) }}>Dados de exemplo</button>
          </div>
        </details>
        <input ref={arquivo} type="file" accept=".xlsx,.xls,.csv" hidden onChange={e => { importar(e.target.files?.[0]); e.target.value = '' }} />
      </header>
      <nav className="atalhos">
        <button className="chip" onClick={() => irPara(null)}>Visão geral</button>
        {[...lay.linhas.keys()].sort((a, b) => a - b).map(c => <button key={c} className="chip" onClick={() => irPara(c)}>Corredor {pad(c)}</button>)}
        {[...lay.prat.values()].map(p => <button key={p.id} className={`chip${foco === p.id ? ' on' : ''}`} onClick={() => irPrateleira(p.id)}>{nomePrat(p)}</button>)}
      </nav>
      {erro && <div className="erro">{erro}</div>}
      <Cena itens={itens} selecionado={sel} foco={foco} achados={achados} preset={preset} onSel={clicarItem} onFoco={id => { setFoco(id); setSel(null) }} onFundo={fundo} />
      {achados && !sel && (
        <ul className="lista">
          {[...achados].slice(0, 8).map((i, k) => (
            <li key={k} onClick={() => escolher(i)}><b>{endereco(i)}</b> {i.codigo} — {i.nome}</li>
          ))}
          {achados.size === 0 && <li>Nada encontrado</li>}
          {achados.size > 8 && <li>+{achados.size - 8} resultados…</li>}
        </ul>
      )}
      {foco != null && !sel && (
        <aside className="painel">
          <div className="end">{pf ? nomePrat(pf) : 'Prateleira'}</div>
          <div className="sub">{caixasFoco.length} caixas cadastradas · andares A (baixo) a {String.fromCharCode(64 + (pf?.niveis ?? 3))} (alto)</div>
          <h2>Clique na caixa que você quer ver</h2>
          <button className="btn" onClick={() => setFoco(null)}>← Sair da prateleira</button>
        </aside>
      )}
      {sel && (
        <aside className="painel">
          <button className="x" onClick={() => setSel(null)} aria-label="Fechar">×</button>
          <img className="foto" src={verEtiqueta && fotoEtiquetaSrc(sel) ? fotoEtiquetaSrc(sel) : fotoSrc(sel)} onClick={() => setAmpliar(true)} onError={e => ((e.target as HTMLImageElement).src = placeholder(sel.codigo))} alt={sel.nome} title="Clique para ampliar" />
          {fotoDaPeca(sel) && fotoEtiquetaSrc(sel) && (
            <button className="miniatura" onClick={() => setVerEtiqueta(v => !v)}>{verEtiqueta ? '← Ver a peça' : 'Ver foto da etiqueta'}</button>
          )}
          <div className="end">{endereco(sel)}</div>
          <div className="sub">{sel.semEndereco ? `caixa no chão, sem endereço · perto do corredor ${pad(sel.corredor)}` : `posto ${sel.posto} · corredor ${sel.corredor} · posição ${sel.posicao} · altura ${sel.altura}`}</div>
          <h2>{sel.nome || '(vazio)'}</h2>
          <div className="cod">{sel.codigo}{sel.cor && <span className="cor"> · cor {sel.cor}</span>}</div>
          {sel.lofo && <div>Lofo: {sel.lofo}</div>}
          {sel.embalagem && <div>Emb.: {sel.embalagem}</div>}
          {sel.qtd && <div>Quant./Embal.: {sel.qtd}</div>}
          {sel.obs && <div className="obs"><b>Observação:</b> {sel.obs}</div>}
          <div className="acoes">
            {botoesNav.map(([t, d, dica]) => <button key={t} className="btn nav" title={dica} disabled={!vizinho(d)} onClick={() => mover(d)}>{t}</button>)}
            <button className="btn" onClick={copiar}>{copiado ? 'Copiado ✓' : 'Copiar endereço'}</button>
          </div>
        </aside>
      )}
      {ampliar && sel && (
        <div className="lightbox" onClick={() => setAmpliar(false)}>
          <img src={verEtiqueta && fotoEtiquetaSrc(sel) ? fotoEtiquetaSrc(sel) : fotoSrc(sel)} alt={sel.nome} />
        </div>
      )}
      <footer>
        <span className="uso">Setas do teclado: ir ao endereço vizinho · Esc: voltar · clique numa caixa para ver a peça · vermelho: peça com observação</span>
        <span className="creditos">Criado por Fábio Sarri e Eviton Capistrano</span>
      </footer>
    </div>
  )
}
