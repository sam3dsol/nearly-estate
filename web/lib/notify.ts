// one call shows a toast on the page
// and, when the tab is hidden and the browser allows it, a system notification. Alerts run only while a nearly.trade tab is open.
export const notifyState = () => (typeof Notification === 'undefined' ? 'none' : Notification.permission)
export const askNotify = async () => (typeof Notification === 'undefined' ? 'none' : await Notification.requestPermission())
export function notify(title: string, body: string, url?: string) {
  if (typeof document === 'undefined') return
  const t = document.createElement('div'); t.className = 'mk-toast'; t.setAttribute('role', 'status')
  t.innerHTML = `<b></b><span></span>`; (t.firstChild as HTMLElement).textContent = title; (t.lastChild as HTMLElement).textContent = body
  if (url) t.onclick = () => { location.href = url }
  document.body.appendChild(t); setTimeout(() => t.classList.add('on'), 20); setTimeout(() => { t.classList.remove('on'); setTimeout(() => t.remove(), 400) }, 7000)
  if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try { const n = new Notification(title, { body, icon: '/apple-touch-icon.png' }); n.onclick = () => { window.focus(); if (url) location.href = url; n.close() } } catch {}
  }
}
