import { Controller } from '@hotwired/stimulus'
import { closeMenu, toggleSun } from '../services/theme_service'

function closest (el, id) {
  // https://stackoverflow.com/a/48726873/1124661
  if (el.id === id) {
    return el
  }
  if (el.parentNode && el.parentNode.nodeName !== 'BODY') {
    return closest(el.parentNode, id)
  }
  return null
}

export default class extends Controller {
  static get targets () {
    return ['toggle', 'homeToggle', 'form', 'homeMenu', 'commonMenu']
  }

  connect () {
    this.clickout = this._clickout.bind(this)
    this.formTargets.forEach(form => {
      form.addEventListener('submit', e => {
        e.preventDefault()
        return false
      })
    })
  }

  checkHomePage () {
    const originUrl = window.location.origin
    let href = window.location.href
    if (href.includes(originUrl)) {
      href = href.replace(originUrl, '')
      if (href === '/' || href === '') {
        return true
      }
      return false
    }
    return false
  }

  _clickout (e) {
    const target = e.target || e.srcElement
    if (!closest(target, 'hamburger-menu')) {
      document.removeEventListener('click', this.clickout)
      closeMenu()
    }
  }

  toggle (e) {
    if (this.toggleTarget.checked) {
      document.addEventListener('click', this.clickout)
    }
  }

  homeToggle (e) {
    if (this.homeToggleTarget.checked) {
      document.addEventListener('click', this.clickout)
    }
  }

  onSunClick () {
    toggleSun()
  }
}
