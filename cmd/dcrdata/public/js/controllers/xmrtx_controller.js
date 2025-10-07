import { Controller } from '@hotwired/stimulus'

export default class extends Controller {
  static get targets () {
    return ['inputAddress', 'inputViewKey', 'inputTxPrivateKey', 'inputReceiptAddress']
  }

  async connect () {
    this.txid = this.data.get('txid')
    // collect links and panes inside this controller element
    this.links = Array.from(this.element.querySelectorAll('.tx-tools .nav a'))
    this.panes = Array.from(this.element.querySelectorAll('.tx-tools .tab-pane'))

    // wire clicks
    this.links.forEach(a => a.addEventListener('click', ev => {
      ev.preventDefault()
      const href = a.getAttribute('href')
      this.showTab(href)
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', href)
      }
    }))

    // initial: try hash, else first link (or existing .active)
    const hash = window.location.hash
    if (hash && this.element.querySelector(hash)) {
      this.showTab(hash)
    } else {
      const activeLink = this.element.querySelector('.tx-tools .nav li.active a') || this.links[0]
      if (activeLink) this.showTab(activeLink.getAttribute('href'))
    }
  }

  showTab (idOrHash) {
    if (!idOrHash) return
    const id = idOrHash.startsWith('#') ? idOrHash : `#${idOrHash}`

    this.links.forEach(a => {
      const li = a.closest('li')
      if (a.getAttribute('href') === id) {
        if (li) li.classList.add('active')
        a.setAttribute('aria-selected', 'true')
      } else {
        if (li) li.classList.remove('active')
        a.setAttribute('aria-selected', 'false')
      }
    })

    this.panes.forEach(p => {
      if (`#${p.id}` === id) {
        p.classList.add('active')
        p.removeAttribute('hidden')
      } else {
        p.classList.remove('active')
        p.setAttribute('hidden', '')
      }
    })
  }
}
