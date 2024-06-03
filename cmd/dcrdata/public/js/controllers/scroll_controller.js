import { Controller } from '@hotwired/stimulus'

let navTarget

$(document).mouseup(function (e) {
  const selectArea = $('#chainSelectList')
  if (!selectArea.is(e.target) && selectArea.has(e.target).length === 0) {
    if (selectArea.css('display') !== 'none') {
      selectArea.css('display', 'none')
    }
  }
})

export default class extends Controller {
  static get targets () {
    return ['navbar', 'coinSelect']
  }

  connect () {
    this.isMutilchain = window.location.href.includes('/chain/')
    if (this.isMutilchain) {
      const urlArr = window.location.href.split('/')
      let chain
      urlArr.forEach((element, index) => {
        if (element === 'chain') {
          chain = urlArr[index + 1]
        }
      })
      this.coinSelectTarget.value = chain
      this.currentChain = chain
    } else {
      this.currentChain = 'dcr'
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
    // handler for chain selection
    const chainArray = []
    const chainNameArr = []
    $('.vodiapicker option').each(function () {
      const img = $(this).attr('data-thumbnail')
      const text = this.innerText
      const value = $(this).val()
      const item = '<li><img src="' + img + '" alt="" value="' + value + '"/><span>' + text + '</span></li>'
      chainArray.push(item)
      chainNameArr.push(value)
    })
    $('#selectUl').html(chainArray)
    const chainIndex = chainNameArr.indexOf(this.currentChain)
    if (chainIndex >= 0) {
      $('.chain-selected-btn').html(chainArray[chainIndex])
      $('.chain-selected-btn').attr('value', this.currentChain)
    }
    const _this = this
    $('#selectUl li').click(function () {
      const value = $(this).find('img').attr('value')
      if (value === _this.currentChain) {
        $('.selection-area').toggle()
        return
      }
      _this.keepWithUrl(value)
      // const img = $(this).find('img').attr('src')
      // const text = this.innerText
      // const item = '<li><img src="' + img + '" alt="" /><span>' + text + '</span></li>'
      // $('.chain-selected-btn').html(item)
      // $('.chain-selected-btn').attr('value', value)
      // $('.selection-area').toggle()
    })
    $('.chain-selected-btn').click(function () {
      $('.selection-area').toggle()
    })
  }

  changeCoin (e) {
    const coin = e.target.value
    this.keepWithUrl(coin)
  }

  removeUrlPostfixParam (href) {
    const indexOfParam = href.indexOf('?')
    if (indexOfParam < 0) {
      return href
    }
    return href.substring(0, indexOfParam)
  }

  getParamFromURL (href, key) {
    const indexOfParam = href.indexOf('?')
    if (indexOfParam < 0) {
      return ''
    }
    const paramStr = href.substring(indexOfParam + 1)
    const paramArr = paramStr.split('&')
    let value = ''
    paramArr.forEach(param => {
      if (!param || param === '') {
        return
      }
      const paramV = param.split('=')
      if (paramV.length < 2) {
        return
      }
      if (key === paramV[0].trim()) {
        value = paramV[1].trim()
      }
    })
    return value
  }

  keepWithUrl (coin) {
    const href = window.location.href
    const originUrl = this.removeUrlPostfixParam(href)
    const oldChain = this.currentChain
    this.currentChain = coin
    //  if is chainhome
    if (originUrl.endsWith('/decred') || originUrl.endsWith('/chain/' + oldChain)) {
      //  if current is decred home, coin difference with dcr
      if (originUrl.endsWith('/decred')) {
        if (coin === 'dcr') {
          return
        }
        window.location.href = originUrl.replaceAll('/decred', '/chain/' + coin)
        return
      }
      if (oldChain === coin) {
        return
      }
      if (coin === 'dcr') {
        window.location.href = originUrl.replaceAll('/chain/' + oldChain, '/decred')
      } else {
        window.location.href = originUrl.replaceAll('/chain/' + oldChain, '/chain/' + coin)
      }
    }
    //  if is market page
    if (href.includes('/market')) {
      let newHref = this.replaceChainFromURL(originUrl, 'market', oldChain, coin)
      //  get chart type
      const chartType = this.getParamFromURL(href, 'chart')
      if (chartType !== '') {
        newHref += '?chart=' + chartType
      }
      window.location.href = newHref
      return
    }
    //  if is blocks page
    if (href.includes('/blocks')) {
      let newHref = this.replaceChainFromURL(originUrl, 'blocks', oldChain, coin)
      //  get rows per page
      const rpp = this.getParamFromURL(href, 'rows')
      if (rpp !== '') {
        newHref += '?rows=' + rpp
      }
      window.location.href = newHref
      return
    }
    //  if mempool page
    if (href.includes('/mempool')) {
      const newHref = this.replaceChainFromURL(originUrl, 'mempool', oldChain, coin)
      window.location.href = newHref
      return
    }
    //  if supply page
    if (href.includes('/supply')) {
      const newHref = this.replaceChainFromURL(originUrl, 'supply', oldChain, coin)
      window.location.href = newHref
      return
    }
    //  if charts page
    if (href.includes('/charts')) {
      let newHref = this.replaceChainFromURL(originUrl, 'charts', oldChain, coin)
      //  get chart type
      const chartType = this.getParamFromURL(href, 'chart')
      if (chartType !== '') {
        if (this.isSameChainChart(chartType, oldChain, coin)) {
          newHref += '?chart=' + chartType
        }
      }
      window.location.href = newHref
      return
    }
    //  else
    switch (coin) {
      case 'dcr':
        window.location.href = '/decred'
        break
      default:
        window.location.href = '/chain/' + coin
        break
    }
  }

  isSameChainChart (chartType, oldCoin, newCoin) {
    const sameChart = ['block-size', 'blockchain-size', 'tx-count', 'pow-difficulty', 'coin-supply', 'fees', 'duration-btw-blocks', 'hashrate']
    if (oldCoin !== 'dcr' && newCoin !== 'dcr') {
      return true
    }
    return sameChart.includes(chartType)
  }

  replaceChainFromURL (href, endsWith, oldCoin, newCoin) {
    //  if oldCoin is decred
    if (oldCoin === 'dcr') {
      return href.replaceAll('/' + endsWith, '/chain/' + newCoin + '/' + endsWith)
    }
    if (newCoin === 'dcr') {
      return href.replaceAll('/chain/' + oldCoin + '/' + endsWith, '/' + endsWith)
    }
    return href.replaceAll('/' + oldCoin + '/' + endsWith, '/' + newCoin + '/' + endsWith)
  }
}
