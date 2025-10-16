import { Controller } from '@hotwired/stimulus'
import humanize from '../helpers/humanize_helper'
import globalEventBus from '../services/event_bus_service'
import mempoolJS from '../vendor/mempool'
import TurboQuery from '../helpers/turbolinks_helper'

const pages = ['blockchain', 'mining', 'market', 'charts']

function getPageTitleName (index) {
  switch (index) {
    case 0:
      return 'Blockchain Summary'
    case 1:
      return 'Mining'
    case 2:
      return 'Market Charts'
    case 3:
      return 'Chain Charts'
  }
  return ''
}

function getPageTitleIcon (index) {
  switch (index) {
    case 0:
      return '/images/blockchain-icon.svg'
    case 1:
      return '/images/mining-icon.svg'
    case 2:
      return '/images/market-icon.svg'
    case 3:
      return '/images/chain-chart.svg'
  }
  return ''
}

function setMenuDropdownPos (e) {
  const submenu = e.querySelector('.home-menu-dropdown')
  if (!submenu) return
  const rect = submenu.getBoundingClientRect()
  const windowWidth = window.innerWidth
  if (rect.right > windowWidth) {
    submenu.style.left = '-' + (rect.right - windowWidth - 5) + 'px'
    submenu.style.right = 'auto'
  }
}

export default class extends Controller {
  static get targets () {
    return ['blockHeight', 'blockTotal', 'blockSize', 'blockTime',
      'exchangeRate', 'totalTransactions', 'coinSupply', 'convertedSupply',
      'powBar', 'rewardIdx', 'txCount', 'txOutCount', 'totalSent', 'totalFee',
      'minFeeRate', 'maxFeeRate', 'totalSize', 'remainingBlocks', 'timeRemaning',
      'diffChange', 'prevRetarget', 'blockTimeAvg', 'homeContent', 'homeThumbs',
      'totalFeesExchange', 'totalSentExchange', 'convertedTxFeesAvg', 'powRewardConverted',
      'nextRewardConverted', 'minedBlock', 'numTx24h', 'sent24h', 'fees24h', 'numVout24h',
      'feeAvg24h', 'blockReward', 'nextBlockReward', 'exchangeRateBottom', 'reward24h',
      'totalInputs', 'totalRingMembers', 'memInputCount', 'reward24hExchange',
      'fees24hExchange', 'avgTxFee24h', 'blockTxCount']
  }

  async connect () {
    this.chainType = this.data.get('chainType')
    this.query = new TurboQuery()
    this.settings = TurboQuery.nullTemplate(['page'])
    this.pageIndex = 0
    if (humanize.isEmpty(this.settings.page)) {
      const params = new URLSearchParams(window.location.search)
      if (!humanize.isEmpty(params.get('page'))) {
        this.settings.page = params.get('page')
      }
    }
    if (!humanize.isEmpty(this.settings.page)) {
      this.pageIndex = pages.indexOf(this.settings.page)
      if (this.pageIndex < 0) {
        this.pageIndex = 0
      }
    }
    this.content = document.getElementById('newHomeContent')
    this.thumbs = document.querySelectorAll('.new-home-thumb')
    this.snapPageContents = document.querySelectorAll('.snap-page-content')
    this.navBarHeight = this.newHomeMenuHeight = this.homeThumbnailHeight = this.viewHeight = 0
    this.contentHeights = []
    const _this = this
    this.loadEvent = this.handlerLoadEvent.bind(this)
    if (document.readyState === 'complete') {
      this.handlerLoadEvent()
    } else {
      window.addEventListener('load', this.loadEvent)
    }
    this.resizeEvent = this.handlerResizeEvent.bind(this)
    window.addEventListener('resize', this.resizeEvent)
    this.content.addEventListener('scroll', () => {
      const scrollTop = _this.content.scrollTop + 5
      let currentHeight = 0
      let index = 0
      while (currentHeight < scrollTop) {
        if (scrollTop < currentHeight + _this.contentHeights[index]) {
          break
        }
        currentHeight += _this.contentHeights[index]
        index++
      }
      _this.thumbs.forEach(thumb => thumb.classList.remove('active'))
      _this.thumbs[index].classList.add('active')
      const title = getPageTitleName(index)
      const icon = getPageTitleIcon(index)
      document.getElementById('pageBarTitleTop').textContent = title
      document.getElementById('pageBarIconTop').src = icon
      if (index !== _this.pageIndex) {
        _this.pageIndex = index
        _this.settings.page = pages[index]
        _this.query.replace(_this.settings)
      }
    })

    document.querySelectorAll('.menu-list-item').forEach(menuItem => {
      menuItem.addEventListener('mouseenter', function () {
        setMenuDropdownPos(this)
      })
    })

    const dropdowns = document.querySelectorAll('.menu-list-item')
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0
    if (isTouchDevice) {
      dropdowns.forEach(dropdown => {
        const btn = dropdown.querySelector('.home-menu-wrapper')
        const menu = dropdown.querySelector('.home-menu-dropdown')
        btn.addEventListener('touchstart', function (e) {
          e.preventDefault()
          menu.classList.toggle('show')
          dropdowns.forEach(otherDropdown => {
            if (otherDropdown !== dropdown) {
              otherDropdown.querySelector('.home-menu-dropdown').classList.remove('show')
            }
          })
        })
      })

      document.addEventListener('touchstart', function (e) {
        dropdowns.forEach(dropdown => {
          const menu = dropdown.querySelector('.home-menu-dropdown')
          if (!dropdown.contains(e.target)) {
            menu.classList.remove('show')
          }
        })
      })
    }
    this.processXcUpdate = this._processXcUpdate.bind(this)
    globalEventBus.on('EXCHANGE_UPDATE', this.processXcUpdate)
    const rateStr = this.data.get('exchangeRate')
    this.exchangeRate = 0.0
    if (rateStr && rateStr !== '') {
      this.exchangeRate = parseFloat(rateStr)
    }
    this.processBlock = this._processBlock.bind(this)
    this.processXmrMempool = this._processXmrMempool.bind(this)
    switch (this.chainType) {
      case 'ltc':
        globalEventBus.on('LTC_BLOCK_RECEIVED', this.processBlock)
        break
      case 'btc':
        globalEventBus.on('BTC_BLOCK_RECEIVED', this.processBlock)
        break
      case 'xmr':
        globalEventBus.on('XMR_BLOCK_RECEIVED', this.processBlock)
        globalEventBus.on('MEMPOOL_XMR_RECEIVED', this.processXmrMempool)
        break
    }
    this.ws = null
    if (this.chainType !== 'xmr') {
      this.wsHostName = this.chainType === 'ltc' ? 'litecoinspace.org' : 'mempool.space'
      const { bitcoin: { websocket } } = mempoolJS({
        hostname: this.wsHostName
      })
      this.ws = websocket.initClient({
        options: ['blocks', 'stats', 'mempool-blocks', 'live-2h-chart']
      })
      this.mempoolSocketInit()
    }
  }

  handlerResizeEvent () {
    this.navBarHeight = document.getElementById('navBar').offsetHeight
    this.newHomeMenuHeight = document.getElementById('newHomeMenu').offsetHeight
    this.homeThumbnailHeight = document.getElementById('homeThumbnail').offsetHeight
    this.viewHeight = window.innerHeight - this.navBarHeight - this.newHomeMenuHeight - this.homeThumbnailHeight - 2
    this.updateContentHeight()
  }

  handlerLoadEvent () {
    this.navBarHeight = document.getElementById('navBar').offsetHeight
    this.newHomeMenuHeight = document.getElementById('newHomeMenu').offsetHeight
    this.homeThumbnailHeight = document.getElementById('homeThumbnail').offsetHeight
    this.viewHeight = window.innerHeight - this.navBarHeight - this.newHomeMenuHeight - this.homeThumbnailHeight - 2
    this.updateContentHeight()
    if (this.pageIndex > 0) {
      this.moveToPageByIndex(this.pageIndex)
    }
  }

  updateContentHeight () {
    const _this = this
    this.contentHeights = []
    this.snapPageContents.forEach((pageContent) => {
      const cHeight = pageContent.offsetHeight
      _this.contentHeights.push(cHeight > _this.viewHeight ? cHeight : _this.viewHeight)
      const section = pageContent.querySelector('section')
      if (cHeight < _this.viewHeight && section) {
        section.style.height = _this.viewHeight + 'px'
        section.classList.remove('h-100')
      } else {
        section.classList.add('h-100')
      }
    })
  }

  moveToPageByIndex (index) {
    let toScroll = 0
    for (let i = 0; i < index; i++) {
      toScroll += this.contentHeights[i]
    }
    // scroll to view
    document.getElementById('newHomeContent').scrollTo({ top: toScroll, behavior: 'smooth' })
  }

  setPageIndex (e) {
    const index = Number(e.currentTarget.dataset.index)
    console.log('dataset index: ', index)
    if (index > this.contentHeights.length - 1) {
      return
    }
    this.pageIndex = index
    this.settings.page = pages[index]
    this.query.replace(this.settings)
    this.moveToPageByIndex(index)
  }

  _processXcUpdate (update) {
    const xc = update.updater
    const cType = xc.chain_type
    if (cType !== this.chainType) {
      return
    }
    this.exchangeRate = xc.price
    this.exchangeRateTarget.innerHTML = humanize.decimalParts(xc.price, true, 2, 2)
    this.exchangeRateBottomTarget.innerHTML = humanize.decimalParts(xc.price, true, 2, 2)
  }

  disconnect () {
    if (this.chainType !== 'xmr') {
      this.ws.close()
    }
    switch (this.chainType) {
      case 'ltc':
        globalEventBus.off('LTC_BLOCK_RECEIVED', this.processBlock)
        break
      case 'btc':
        globalEventBus.off('BTC_BLOCK_RECEIVED', this.processBlock)
        break
      case 'xmr':
        globalEventBus.off('XMR_BLOCK_RECEIVED', this.processBlock)
        globalEventBus.off('MEMPOOL_XMR_RECEIVED', this.processXmrMempool)
        break
    }
    globalEventBus.off('EXCHANGE_UPDATE', this.processXcUpdate)
    window.removeEventListener('resize', this.resizeEvent)
    window.removeEventListener('load', this.loadEvent)
  }

  _processBlock (blockData) {
    const block = blockData.block
    this.blockHeightTarget.textContent = block.height
    this.blockHeightTarget.href = `/${this.chainType}/block/${block.hash}`
    this.blockSizeTarget.textContent = humanize.bytes(block.size)
    this.blockTotalTarget.textContent = Number(block.total) > 0 ? humanize.threeSigFigs(block.total) : 'N/A'
    this.blockTimeTarget.dataset.age = block.blocktime_unix
    this.blockTimeTarget.textContent = humanize.timeSince(block.blocktime_unix)
    this.blockTxCountTarget.textContent = humanize.commaWithDecimal(block.tx, 0)
    // handler extra data
    const extra = blockData.extra
    if (!extra) {
      return
    }
    this.totalTransactionsTarget.textContent = humanize.commaWithDecimal(extra.total_transactions, 0)
    this.coinSupplyTarget.textContent = humanize.commaWithDecimal(extra.coin_value_supply, 2)
    if (this.exchangeRate > 0) {
      const exchangeValue = extra.coin_value_supply * this.exchangeRate
      this.convertedSupplyTarget.textContent = humanize.threeSigFigs(exchangeValue) + ' USD'
    }
    // handler for monero
    if (this.chainType === 'xmr') {
      // update for 24h metrics info
      const info24h = extra.block24hInfo
      if (!info24h) {
        return
      }
      if (this.hasMinedBlockTarget) {
        this.minedBlockTarget.textContent = info24h.blocks
        this.numTx24hTarget.textContent = humanize.commaWithDecimal(info24h.numTx24h, 0)
        const reward24hFloat = Number(info24h.totalPowReward) / 1e12
        const fee24hFloat = Number(info24h.fees24h) / 1e12
        const avgTxFee = Number(extra.txFeeAvg24h) / 1e12
        this.reward24hTarget.innerHTML = humanize.decimalParts(reward24hFloat, false, 8, 2)
        this.fees24hTarget.innerHTML = humanize.decimalParts(fee24hFloat, false, 8, 2)
        this.numVout24hTarget.textContent = humanize.commaWithDecimal(info24h.numVout24h, 0)
        this.feeAvg24hTarget.innerHTML = humanize.decimalParts(avgTxFee, false, 8, 2)
        if (this.exchangeRate > 0) {
          this.reward24hExchangeTarget.innerHTML = humanize.threeSigFigs(Number(this.exchangeRate) * reward24hFloat)
          this.fees24hExchangeTarget.innerHTML = humanize.threeSigFigs(Number(this.exchangeRate) * fee24hFloat)
          this.avgTxFee24hTarget.innerHTML = humanize.threeSigFigs(Number(this.exchangeRate) * avgTxFee)
        }
      }
    }
  }

  _processXmrMempool (mempoolData) {
    if (this.hasTxCountTarget) {
      const mempool = mempoolData.xmr_mempool
      if (!mempool || Number(mempool) <= 0 || Number(mempool.inputs_count) <= 0 || Number(mempool.outputs_count) <= 0) {
        return
      }
      this.txCountTarget.textContent = humanize.commaWithDecimal(mempool.tx_count, 0)
      this.memInputCountTarget.textContent = humanize.commaWithDecimal(mempool.inputs_count, 0)
      this.txOutCountTarget.textContent = humanize.commaWithDecimal(mempool.outputs_count, 0)
      const feeFloat = Number(mempool.total_fee) / 1e12
      this.totalFeeTarget.innerHTML = humanize.decimalParts(feeFloat, false, 8, 2)
      if (this.exchangeRate > 0) {
        const convertedFees = Number(this.exchangeRate) * feeFloat
        this.totalFeesExchangeTarget.innerHTML = humanize.threeSigFigs(convertedFees)
      }
      this.minFeeRateTarget.textContent = humanize.commaWithDecimal(mempool.min_fee_rate, 0)
      this.maxFeeRateTarget.textContent = humanize.commaWithDecimal(mempool.max_fee_rate, 0)
      this.totalSizeTarget.innerHTML = humanize.bytes(mempool.bytes_total)
    }
  }

  async mempoolSocketInit () {
    const _this = this
    this.ws.addEventListener('message', function incoming ({ data }) {
      const res = JSON.parse(data.toString())
      if (res.mempoolInfo) {
        _this.txCountTarget.innerHTML = humanize.decimalParts(res.mempoolInfo.size, true, 0)
        if (_this.chainType === 'btc') {
          _this.totalFeeTarget.innerHTML = humanize.decimalParts(res.mempoolInfo.total_fee, false, 8, 2)
          const convertedFees = Number(_this.exchangeRate) * Number(res.mempoolInfo.total_fee)
          _this.totalFeesExchangeTarget.innerHTML = humanize.threeSigFigs(convertedFees)
        }
      }
      if (res['mempool-blocks']) {
        let totalSize = 0
        let ltcTotalFee = 0
        let minFeeRatevB = Number.MAX_VALUE
        let maxFeeRatevB = 0
        res['mempool-blocks'].forEach(memBlock => {
          totalSize += memBlock.blockSize
          if (_this.chainType === 'ltc') {
            ltcTotalFee += memBlock.totalFees
          }
          if (memBlock.feeRange) {
            memBlock.feeRange.forEach(feevB => {
              if (minFeeRatevB > feevB) {
                minFeeRatevB = feevB
              }
              if (maxFeeRatevB < feevB) {
                maxFeeRatevB = feevB
              }
            })
          }
        })
        if (_this.chainType === 'ltc') {
          _this.totalFeeTarget.innerHTML = humanize.decimalParts(ltcTotalFee / 1e8, false, 8, 2)
          const convertedFees = Number(_this.exchangeRate) * Number(ltcTotalFee)
          _this.totalFeesExchangeTarget.innerHTML = humanize.threeSigFigs(convertedFees)
        }
        _this.minFeeRateTarget.innerHTML = humanize.decimalParts(minFeeRatevB, true, 0)
        _this.maxFeeRateTarget.innerHTML = humanize.decimalParts(maxFeeRatevB, true, 0)
        _this.totalSizeTarget.innerHTML = humanize.bytes(totalSize)
      }
      if (res.block) {
        const extras = res.block.extras
        _this.txOutCountTarget.innerHTML = humanize.decimalParts(extras.totalOutputs, true, 0)
        _this.totalSentTarget.innerHTML = humanize.decimalParts(extras.totalOutputAmt / 1e8, false, 8, 2)
        const convertedSent = Number(_this.exchangeRate) * Number(extras.totalOutputAmt / 1e8)
        _this.totalSentExchangeTarget.innerHTML = humanize.threeSigFigs(convertedSent)
      }
      if (res.blocks) {
        let txOutCount = 0
        let totalSent = 0
        res.blocks.forEach(block => {
          const extras = block.extras
          txOutCount += extras.totalOutputs
          totalSent += extras.totalOutputAmt
        })
        _this.txOutCountTarget.innerHTML = humanize.decimalParts(txOutCount, true, 0)
        _this.totalSentTarget.innerHTML = humanize.decimalParts(totalSent / 1e8, false, 3, 2)
        const convertedSent = Number(_this.exchangeRate) * Number(totalSent / 1e8)
        _this.totalSentExchangeTarget.innerHTML = humanize.threeSigFigs(convertedSent)
      }
      if (res.da) {
        const diffChange = res.da.difficultyChange
        const prevRetarget = res.da.previousRetarget
        const remainingBlocks = res.da.remainingBlocks
        const timeRemaining = res.da.remainingTime
        _this.diffChangeTarget.innerHTML = humanize.decimalParts(diffChange, false, 2, 0)
        if (diffChange > 0) {
          _this.diffChangeTarget.classList.remove('c-red')
          _this.diffChangeTarget.classList.add('c-green-2')
        } else {
          _this.diffChangeTarget.classList.add('c-red')
          _this.diffChangeTarget.classList.remove('c-green-2')
        }
        _this.prevRetargetTarget.innerHTML = humanize.threeSigFigs(prevRetarget)
        _this.remainingBlocksTarget.innerHTML = humanize.decimalParts(remainingBlocks, true, 0)
        _this.timeRemaningTarget.setAttribute('data-duration', timeRemaining)
        // _this.blockTimeAvgTarget.setAttribute('data-duration', timeAvg)
      }
    })
  }
}
