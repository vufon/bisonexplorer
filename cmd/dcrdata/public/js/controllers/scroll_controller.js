import { Controller } from '@hotwired/stimulus'

let navTarget

export default class extends Controller {
  static get targets () {
    return ['navbar']
  }

  connect () {
    navTarget = this.navbarTarget
    document.addEventListener('scroll', function () {
      // Get the scroll position
      const scrollPos = window.pageYOffset
      if (scrollPos > 80) {
        navTarget.classList.add('scroll-topbar')
      } else {
        navTarget.classList.remove('scroll-topbar')
      }
    })
  }
}
