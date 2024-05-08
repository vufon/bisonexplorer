import { Controller } from '@hotwired/stimulus'

let navTarget

export default class extends Controller {
  static get targets () {
    return ['navbar', 'coinSelect']
  }

  connect () {
    const isMutilchain = window.location.href.includes('/chain/')
    if (isMutilchain) {
      const urlArr = window.location.href.split('/')
      let chain
      urlArr.forEach((element, index) => {
        if (element.includes('chain')) {
          chain = urlArr[index + 1]
        }
      })
      this.coinSelectTarget.value = chain
    }
    navTarget = this.navbarTarget
    document.addEventListener('scroll', function () {
      // Get the scroll position
      const scrollPos = window.pageYOffset
      if (scrollPos > 80) {
        navTarget.classList.add('scroll-topbar')
        $('#menuDivider').addClass('d-none')
      } else {
        navTarget.classList.remove('scroll-topbar')
        $('#menuDivider').removeClass('d-none')
      }
    })
    $('html').css('overflow-x', '')
  }

  changeCoin (e) {
    const coin = e.target.value
    switch (coin) {
      case 'dcr':
        window.location.href = '/'
        return
      default:
        window.location.href = '/chain/' + coin
    }
  }
}
