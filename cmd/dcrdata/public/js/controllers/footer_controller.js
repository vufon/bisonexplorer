import { Controller } from '@hotwired/stimulus'

export default class extends Controller {
  static get targets () {
    return ['footerBar']
  }

  connect () {
    this.isHomepage = this.data.get('isHomepage') === 'true'
    if (this.isHomepage) {
      this.footerBarTarget.classList.add('d-none')
    } else {
      this.footerBarTarget.classList.remove('d-none')
    }
  }
}
