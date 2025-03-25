import { Controller } from '@hotwired/stimulus'
import { toggleSun } from '../services/theme_service'

export default class extends Controller {
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

  onSunClick () {
    toggleSun()
  }
}
