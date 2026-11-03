import { createRoot } from 'react-dom/client'
import App from './App'
import './estilo.css'
createRoot(document.getElementById('root')!).render(<App />)

// instalável e funciona sem internet depois do primeiro acesso
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}))
}
