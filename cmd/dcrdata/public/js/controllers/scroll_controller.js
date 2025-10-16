import { Controller } from '@hotwired/stimulus'
import { toggleSun } from '../services/theme_service'

$(document).mouseup(function (e) {
  const selectArea = $('#chainSelectList')
  if (!selectArea.is(e.target) && selectArea.has(e.target).length === 0) {
    if (selectArea.css('display') !== 'none') {
      selectArea.css('display', 'none')
    }
  }
})

$(window).on('resize', function (event) {
  const winWidth = $(window).width()
  if (winWidth > 700) {
    $('#menu').css('width', $('#topBarLeft').width())
    return
  }
  $('#menu').css('width', 'auto')
})

const multichainList = ['btc', 'ltc', 'xmr']

function isMutilchainUrl (url) {
  let isMultichain = false
  multichainList.forEach((chain) => {
    if (url.includes('/' + chain)) {
      isMultichain = true
    }
  })
  return isMultichain
}

export default class extends Controller {
  static get targets () {
    return ['navbar', 'coinSelect']
  }

  connect () {
    this.isMutilchain = isMutilchainUrl(window.location.href)
    if (this.isMutilchain) {
      const urlArr = window.location.href.split('/')
      let chain
      urlArr.forEach((element) => {
        multichainList.forEach((mchain) => {
          if (element === mchain || element.startsWith(mchain + '?')) {
            chain = mchain
          }
        })
      })
      this.coinSelectTarget.value = chain
      this.currentChain = chain
    } else {
      this.currentChain = 'dcr'
    }
    const _this = this
    document.addEventListener('scroll', function () {
      _this.handlerScroll()
    })
    _this.handlerScroll()
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
    $('#menu').css('width', $('#topBarLeft').width())
  }

  handlerScroll () {
    // Get the scroll position
    const scrollPos = window.pageYOffset
    if (scrollPos > 20) {
      this.navbarTarget.classList.add('scroll-topbar')
      $('#menuDivider').addClass('d-none')
    } else {
      this.navbarTarget.classList.remove('scroll-topbar')
      $('#menuDivider').removeClass('d-none')
    }
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
    if (window.location.pathname === '/' || originUrl.endsWith('/decred') || originUrl.endsWith('/' + oldChain)) {
      //  if current is decred home, coin difference with dcr
      if (window.location.pathname === '/' || originUrl.endsWith('/decred')) {
        if (coin === 'dcr') {
          return
        }
        window.location.href = originUrl.replaceAll('/decred', '/' + coin)
        return
      }
      if (oldChain === coin) {
        return
      }
      if (coin === 'dcr') {
        window.location.href = originUrl.replaceAll('/' + oldChain, '/decred')
      } else {
        window.location.href = originUrl.replaceAll('/' + oldChain, '/' + coin)
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
    //  if supply page
    if (href.includes('/parameters')) {
      const newHref = this.replaceChainFromURL(originUrl, 'parameters', oldChain, coin)
      window.location.href = newHref
      return
    }
    //  if visualblocks page
    if (href.includes('/visualblocks')) {
      const newHref = this.replaceChainFromURL(originUrl, 'visualblocks', oldChain, coin)
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
        window.location.href = '/' + coin
        break
    }
  }

  isSameChainChart (chartType, oldCoin, newCoin) {
    const sameChart = ['block-size', 'blockchain-size', 'tx-count', 'pow-difficulty', 'coin-supply', 'fees', 'hashrate']
    if (oldCoin !== 'dcr' && newCoin !== 'dcr') {
      return true
    }
    return sameChart.includes(chartType)
  }

  replaceChainFromURL (href, endsWith, oldCoin, newCoin) {
    //  if oldCoin is decred
    if (oldCoin === 'dcr') {
      let replaceStr = '/' + endsWith
      if (href.includes('/decred')) {
        replaceStr = '/decred' + replaceStr
      }
      return href.replaceAll(replaceStr, '/' + newCoin + '/' + endsWith)
    }
    if (newCoin === 'dcr') {
      return href.replaceAll('/' + oldCoin + '/' + endsWith, '/decred/' + endsWith)
    }
    return href.replaceAll('/' + oldCoin + '/' + endsWith, '/' + newCoin + '/' + endsWith)
  }

  topSunClick () {
    toggleSun()
  }
}
