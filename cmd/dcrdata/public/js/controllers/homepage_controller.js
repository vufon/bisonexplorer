import { Controller } from '@hotwired/stimulus'
import humanize from '../helpers/humanize_helper'
import ws from '../services/messagesocket_service'
import { keyNav } from '../services/keyboard_navigation_service'
import globalEventBus from '../services/event_bus_service'
import Mempool from '../helpers/mempool_helper'
import TurboQuery from '../helpers/turbolinks_helper'
import { requestJSON } from '../helpers/http'

const conversionRate = 100000000
const pages = ['blockchain', 'mining', 'market', 'ticket', '24h', 'charts']

function getPageTitleName (index) {
  switch (index) {
    case 0:
      return 'Blockchain Summary'
    case 1:
      return 'Mempool And Mining'
    case 2:
      return 'Market Charts'
    case 3:
      return 'Staking And Voting'
    case 4:
      return '24h Metrics'
    case 5:
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
      return '/images/ticket.svg'
    case 4:
      return '/images/hour-24.svg'
    case 5:
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

function makeMempoolBlock (block) {
  let fees = 0
  if (!block.Transactions) return
  for (const tx of block.Transactions) {
    fees += tx.Fees
  }

  return `<div class="block-rows homepage-blocks-row">
                    ${makeRewardsElement(block.Subsidy, fees, block.Votes.length, '#')}
                    ${makeVoteElements(block.Votes)}
                    ${makeTicketAndRevocationElements(block.Tickets, block.Revocations, '/mempool')}
                    ${makeTransactionElements(block.Transactions, '/mempool')}
                </div>`
}

function makeTransactionElements (transactions, blockHref) {
  let totalDCR = 0
  const transactionElements = []
  if (transactions) {
    for (let i = 0; i < transactions.length; i++) {
      const tx = transactions[i]
      totalDCR += tx.Total
      transactionElements.push(makeTxElement(tx, `block-tx ${i === 0 ? 'left-vs-block-data' : ''} ${i === transactions.length - 1 ? 'right-vs-block-data' : ''}`, 'Transaction', true))
    }
  }

  if (transactionElements.length > 50) {
    const total = transactionElements.length
    transactionElements.splice(30)
    transactionElements.push(`<span class="block-tx" style="flex-grow: 10; flex-basis: 50px;" title="Total of ${total} transactions">
                                    <a class="block-element-link" href="${blockHref}">+ ${total - 30}</a>
                                </span>`)
  }

  // totalDCR = Math.round(totalDCR);
  totalDCR = 1
  return `<div class="block-transactions px-1 my-1" style="flex-grow: ${totalDCR}">
                ${transactionElements.join('\n')}
            </div>`
}

function makeTxElement (tx, className, type, appendFlexGrow) {
  // const style = [ `opacity: ${(tx.VinCount + tx.VoutCount) / 10}` ];
  const style = []
  if (appendFlexGrow) {
    style.push(`flex-grow: ${Math.round(tx.Total)}`)
  }

  return `<span class="${className}" style="${style.join('; ')}" data-homepage-target="tooltip"
                title='{"object": "${type}", "total": "${tx.Total}", "vout": "${tx.VoutCount}", "vin": "${tx.VinCount}"}'>
                <a class="block-element-link" href="/tx/${tx.TxID}"></a>
            </span>`
}

function makeTicketAndRevocationElements (tickets, revocations, blockHref) {
  let totalDCR = 0
  const ticketElements = []
  const revCount = revocations ? revocations.length : 0
  const ticketCount = tickets ? tickets.length : 0
  if (tickets) {
    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i]
      totalDCR += ticket.Total
      ticketElements.push(makeTxElement(ticket, `block-ticket ${i === 0 ? 'left-vs-block-data' : ''} ${i === tickets.length - 1 && revCount === 0 ? 'right-vs-block-data' : ''}`, 'Ticket'))
    }
  }
  if (ticketElements.length > 50) {
    const total = ticketElements.length
    ticketElements.splice(30)
    ticketElements.push(`<span class="block-ticket" style="flex-grow: 10; flex-basis: 50px;" title="Total of ${total} tickets">
                                <a class="block-element-link" href="${blockHref}">+ ${total - 30}</a>
                            </span>`)
  }
  const revocationElements = []
  if (revCount > 0) {
    for (let i = 0; i < revCount; i++) {
      const revocation = revocations[i]
      totalDCR += revocation.Total
      revocationElements.push(makeTxElement(revocation, `block-rev ${ticketCount === 0 && i === 0 ? 'left-vs-block-data' : ''} ${i === revCount - 1 ? 'right-vs-block-data' : ''}`, 'Revocation'))
    }
  }

  const ticketsAndRevocationElements = ticketElements.concat(revocationElements)

  // append empty squares to tickets+revs
  for (let i = ticketsAndRevocationElements.length; i < 20; i++) {
    ticketsAndRevocationElements.push('<span title="Empty ticket slot"></span>')
  }

  // totalDCR = Math.round(totalDCR);
  totalDCR = 1
  return `<div class="block-tickets px-1 mt-1" style="flex-grow: ${totalDCR}">
                ${ticketsAndRevocationElements.join('\n')}
            </div>`
}

function makeVoteElements (votes) {
  let totalDCR = 0
  const voteLen = votes ? votes.length : 0
  const voteElements = []
  if (voteLen > 0) {
    for (let i = 0; i < voteLen - 1; i++) {
      const vote = votes[i]
      totalDCR += vote.Total
      voteElements.push(`<span style="background: ${vote.VoteValid ? 'linear-gradient(to right, #2971ff 0%, #528cff 100%)' : 'linear-gradient(to right, #fd714a 0%, #f6896a 100%)'}" data-homepage-target="tooltip"
                        title='{"object": "Vote", "voteValid": "${vote.VoteValid}"}' class="${i === 0 ? 'left-vs-block-data' : ''} ${i === voteLen - 1 ? 'right-vs-block-data' : ''}">
                        <a class="block-element-link" href="/tx/${vote.TxID}"></a>
                    </span>`)
    }
  }
  // append empty squares to votes
  for (let i = voteElements.length; i < 5; i++) {
    voteElements.push('<span title="Empty vote slot"></span>')
  }

  // totalDCR = Math.round(totalDCR);
  totalDCR = 1
  return `<div class="block-votes px-1 mt-1" style="flex-grow: ${totalDCR}">
                ${voteElements.join('\n')}
            </div>`
}

function makeRewardsElement (subsidy, fee, voteCount, rewardTxId) {
  if (!subsidy) {
    return `<div class="block-rewards px-1 mt-1">
                    <span class="pow"><span class="paint left-vs-block-data" style="width:100%;"></span></span>
                    <span class="pos"><span class="paint left-vs-block-data" style="width:100%;"></span></span>
                    <span class="fund"><span class="paint left-vs-block-data" style="width:100%;"></span></span>
                    <span class="fees right-vs-block-data" title='{"object": "Tx Fees", "total": "${fee}"}'></span>
                </div>`
  }

  const pow = subsidy.pow / conversionRate
  const pos = subsidy.pos / conversionRate
  const fund = (subsidy.developer || subsidy.dev) / conversionRate

  const backgroundColorRelativeToVotes = `style="width: ${voteCount * 20}%"` // 5 blocks = 100% painting

  // const totalDCR = Math.round(pow + fund + fee);
  const totalDCR = 1
  return `<div class="block-rewards px-1 mt-1" style="flex-grow: ${totalDCR}">
                <span class="pow" style="flex-grow: ${pow}" data-homepage-target="tooltip"
                    title='{"object": "PoW Reward", "total": "${pow}"}'>
                    <span class="block-element-link">
                        <span class="paint left-vs-block-data" ${backgroundColorRelativeToVotes}></span>
                    </span>
                </span>
                <span class="pos" style="flex-grow: ${pos}" data-homepage-target="tooltip"
                    title='{"object": "PoS Reward", "total": "${pos}"}'>
                    <span class="block-element-link">
                        <span class="paint" ${backgroundColorRelativeToVotes}></span>
                    </span>
                </span>
                <span class="fund" style="flex-grow: ${fund}" data-homepage-target="tooltip"
                    title='{"object": "Project Fund", "total": "${fund}"}'>
                    <span class="block-element-link">
                        <span class="paint" ${backgroundColorRelativeToVotes}></span>
                    </span>
                </span>
                <span class="fees right-vs-block-data" style="flex-grow: ${fee}" data-homepage-target="tooltip"
                    title='{"object": "Tx Fees", "total": "${fee}"}'>
                    <span class="block-element-link"></span>
                </span>
            </div>`
}

export default class extends Controller {
  static get targets () {
    return ['difficulty',
      'bsubsidyTotal', 'bsubsidyPow', 'bsubsidyPos', 'bsubsidyDev',
      'coinSupply', 'blocksdiff', 'devFund', 'windowIndex', 'posBar',
      'rewardIdx', 'powBar', 'poolSize', 'poolValue', 'ticketReward',
      'targetPct', 'poolSizePct', 'hashrate', 'hashrateDelta',
      'nextExpectedSdiff', 'nextExpectedMin', 'nextExpectedMax', 'mempool',
      'mpRegTotal', 'mpRegCount', 'mpTicketTotal', 'mpTicketCount', 'mpVoteTotal', 'mpVoteCount',
      'mpRevTotal', 'mpRevCount', 'voteTally', 'blockVotes', 'blockHeight', 'blockSize',
      'blockTotal', 'consensusMsg', 'powConverted', 'convertedDev',
      'convertedSupply', 'convertedDevSub', 'exchangeRate', 'convertedStake',
      'mixedPct', 'searchKey', 'memBlock', 'tooltip', 'avgBlockTime', 'tspentAmount', 'tspentCount',
      'onlineNodes', 'blockchainSize', 'avgBlockSize', 'totalTxs', 'totalAddresses', 'totalOutputs',
      'totalSwapsAmount', 'totalContracts', 'redeemCount', 'refundCount', 'bwTotalVol', 'last30DayBwVol',
      'convertedMemSent', 'mempoolSize', 'mempoolFees', 'convertedMempoolFees', 'feeAvg', 'txfeeConverted',
      'poolsTable', 'rewardReduceRemain', 'marketCap', 'lastBlockTime', 'missedTickets', 'last1000BlocksMissed',
      'ticketFee', 'vspTable', 'mined24hBlocks', 'txs24hCount', 'sent24h', 'sent24hUsd', 'fees24h', 'fees24hUsd',
      'vout24h', 'activeAddr24h', 'powReward24h', 'powReward24hUsd', 'supply24h', 'supply24hUsd', 'treasuryBal24h',
      'treasuryBal24hUsd', 'staked24h', 'tickets24h', 'posReward24h', 'posReward24hUsd', 'voted24h', 'missed24h',
      'swapAmount24h', 'swapAmount24hUsd', 'swapCount24h', 'swapPartCount24h', 'bwVol24h', 'homeContent',
      'homeThumbs', 'exchangeRateBottom'
    ]
  }

  connect () {
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

    // get default exchange rate
    this.exchangeRate = Number(this.data.get('exchangeRate'))
    this.exchangeIndex = this.data.get('exchangeIndex')
    this.ticketsPerBlock = parseInt(this.mpVoteCountTarget.dataset.ticketsPerBlock)
    this.mempoolTotalSent = Number(this.mempoolTarget.dataset.memsent)
    this.mempoolFees = Number(this.mempoolFeesTarget.dataset.memfees)
    this.powReward = Number(this.bsubsidyPowTarget.dataset.powreward)
    this.txFeeAvg = Number(this.feeAvgTarget.dataset.feeavg)
    const mempoolData = this.mempoolTarget.dataset
    ws.send('getmempooltxs', mempoolData.id)
    this.mempool = new Mempool(mempoolData, this.voteTallyTargets)
    ws.registerEvtHandler('newtxs', (evt) => {
      const txs = JSON.parse(evt)
      this.mempool.mergeTxs(txs)
      this.setMempoolFigures()
      keyNav(evt, false, true)
      ws.send('getmempooltrimmed', '')
    })
    ws.registerEvtHandler('mempool', (evt) => {
      const m = JSON.parse(evt)
      this.mempool.replace(m)
      this.setMempoolFigures()
      keyNav(evt, false, true)
      ws.send('getmempooltxs', '')
      ws.send('getmempooltrimmed', '')
    })
    ws.registerEvtHandler('getmempooltxsResp', (evt) => {
      const m = JSON.parse(evt)
      this.mempool.replace(m)
      this.setMempoolFigures()
      keyNav(evt, false, true)
    })

    ws.registerEvtHandler('getmempooltrimmedResp', (event) => {
      this.handleMempoolUpdate(event)
    })

    this.processBlock = this._processBlock.bind(this)
    globalEventBus.on('BLOCK_RECEIVED', this.processBlock)
    this.processSummaryInfo = this._processSummary.bind(this)
    globalEventBus.on('SUMMARY_RECEIVED', this.processSummaryInfo)
    this.processSummary24hInfo = this._process24hInfo.bind(this)
    globalEventBus.on('SUMMARY_24H_RECEIVED', this.processSummary24hInfo)
    this.processXcUpdate = this._processXcUpdate.bind(this)
    globalEventBus.on('EXCHANGE_UPDATE', this.processXcUpdate)
    this.setupTooltips()
    const isDev = this.data.get('dev')
    if (isDev && isDev !== '') {
      this.setAvgBlockTime()
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
    if (index > this.contentHeights.length - 1) {
      return
    }
    this.pageIndex = index
    this.settings.page = pages[index]
    this.query.replace(this.settings)
    this.moveToPageByIndex(index)
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

  _processXcUpdate (update) {
    const xc = update.updater
    const cType = xc.chain_type
    if (cType && cType !== 'dcr') {
      return
    }
    const newPrice = update.price
    if (Number(newPrice) > 0) {
      this.exchangeRate = newPrice
      this.syncExchangeAllPrice()
    }
  }

  syncExchangeAllPrice () {
    if (this.mempoolTotalSent > 0 && this.hasConvertedMemSentTarget) {
      this.convertedMemSentTarget.textContent = `${humanize.threeSigFigs(this.mempoolTotalSent * this.exchangeRate)} ${this.exchangeIndex}`
    }
    if (this.mempoolFees > 0 && this.hasConvertedMempoolFeesTarget) {
      this.convertedMempoolFeesTarget.textContent = `${humanize.threeSigFigs(this.mempoolFees * this.exchangeRate)} ${this.exchangeIndex}`
    }
    if (this.hasExchangeRateTarget) {
      this.exchangeRateTarget.textContent = humanize.twoDecimals(this.exchangeRate)
    }
    if (this.hasExchangeRateBottomTarget) {
      this.exchangeRateBottomTarget.textContent = humanize.twoDecimals(this.exchangeRate)
    }
    if (this.powReward > 0 && this.hasPowConvertedTarget) {
      this.powConvertedTarget.textContent = `${humanize.twoDecimals(this.powReward / 1e8 * this.exchangeRate)} ${this.exchangeIndex}`
    }
    if (this.txFeeAvg > 0 && this.hasTxfeeConverted) {
      this.txfeeConvertedTarget.textContent = `${(this.txFeeAvg / 1e8 * this.exchangeRate).toFixed(5)} ${this.exchangeIndex}`
    }
  }

  async setAvgBlockTime () {
    const url = '/api/block/avg-block-time'
    const resData = await requestJSON(url)
    this.avgBlockTimeTarget.textContent = humanize.timeDuration(resData * 1000)
  }

  handleMempoolUpdate (evt) {
    const mempool = JSON.parse(evt)
    mempool.Time = Math.round((new Date()).getTime() / 1000)
    this.memBlockTarget.innerHTML = makeMempoolBlock(mempool)
    this.setupTooltips()
  }

  setupTooltips () {
    this.tooltipTargets.forEach((tooltipElement) => {
      try {
        // parse the content
        const data = JSON.parse(tooltipElement.title)
        let newContent
        if (data.object === 'Vote') {
          newContent = `<b>${data.object} (${data.voteValid ? 'Yes' : 'No'})</b>`
        } else {
          newContent = `<b>${data.object}</b><br>${humanize.decimalParts(data.total, false, 8, 2)} DCR`
        }

        if (data.vin && data.vout) {
          newContent += `<br>${data.vin} Inputs, ${data.vout} Outputs`
        }

        tooltipElement.title = newContent
      } catch (error) { }
    })

    import(/* webpackChunkName: "tippy" */ '../vendor/tippy.all').then(module => {
      const tippy = module.default
      tippy('.block-rows [title]', {
        allowTitleHTML: true,
        animation: 'shift-away',
        arrow: true,
        createPopperInstanceOnInit: true,
        dynamicTitle: true,
        performance: true,
        placement: 'top',
        size: 'small',
        sticky: true,
        theme: 'light'
      })
    })
  }

  disconnect () {
    ws.deregisterEvtHandlers('newtxs')
    ws.deregisterEvtHandlers('mempool')
    ws.deregisterEvtHandlers('getmempooltxsResp')
    ws.deregisterEvtHandlers('getmempooltrimmedResp')
    globalEventBus.off('BLOCK_RECEIVED', this.processBlock)
    globalEventBus.off('SUMMARY_RECEIVED', this.processSummaryInfo)
    globalEventBus.off('SUMMARY_24H_RECEIVED', this.processSummary24hInfo)
    globalEventBus.off('EXCHANGE_UPDATE', this.processXcUpdate)
    window.removeEventListener('resize', this.resizeEvent)
    window.removeEventListener('load', this.loadEvent)
  }

  setMempoolFigures () {
    const totals = this.mempool.totals()
    const counts = this.mempool.counts()
    const fees = this.mempool.fees()
    this.mpRegTotalTarget.textContent = humanize.threeSigFigs(totals.regular)
    this.mpRegCountTarget.textContent = counts.regular

    this.mpTicketTotalTarget.textContent = humanize.threeSigFigs(totals.ticket)
    this.mpTicketCountTarget.textContent = counts.ticket

    this.mpVoteTotalTarget.textContent = humanize.threeSigFigs(totals.vote)

    const ct = this.mpVoteCountTarget
    while (ct.firstChild) ct.removeChild(ct.firstChild)
    this.mempool.voteSpans(counts.vote).forEach((span) => { ct.appendChild(span) })

    this.mpRevTotalTarget.textContent = humanize.threeSigFigs(totals.rev)
    this.mpRevCountTarget.textContent = counts.rev

    this.mempoolTarget.textContent = humanize.threeSigFigs(totals.total)
    this.mempoolFeesTarget.innerHTML = humanize.decimalParts(fees.fees, false, 8, 5)

    if (this.exchangeRate > 0 && totals.total > 0) {
      this.convertedMemSentTarget.textContent = `${humanize.threeSigFigs(totals.total * this.exchangeRate)} ${this.exchangeIndex}`
      this.mempoolTotalSent = totals.total
    }
    if (this.exchangeRate > 0 && fees.fees > 0) {
      this.convertedMempoolFeesTarget.textContent = `${humanize.threeSigFigs(fees.fees * this.exchangeRate)} ${this.exchangeIndex}`
      this.mempoolFees = fees.fees
    }
    // set size
    this.mempoolSizeTarget.textContent = humanize.bytes(totals.size)
    this.setVotes()
  }

  setVotes () {
    const hash = this.blockVotesTarget.dataset.hash
    const votes = this.mempool.blockVoteTally(hash)
    this.blockVotesTarget.querySelectorAll('div').forEach((div, i) => {
      const span = div.firstElementChild
      if (i < votes.affirm) {
        span.className = 'd-inline-block dcricon-affirm'
        div.dataset.tooltip = 'the stakeholder has voted to accept this block'
      } else if (i < votes.affirm + votes.reject) {
        span.className = 'd-inline-block dcricon-reject'
        div.dataset.tooltip = 'the stakeholder has voted to reject this block'
      } else {
        span.className = 'd-inline-block dcricon-missing'
        div.dataset.tooltip = 'this vote has not been received yet'
      }
    })
    const threshold = this.ticketsPerBlock / 2
    if (votes.affirm > threshold) {
      this.consensusMsgTarget.textContent = 'approved'
      this.consensusMsgTarget.className = 'small text-green'
    } else if (votes.reject > threshold) {
      this.consensusMsgTarget.textContent = 'rejected'
      this.consensusMsgTarget.className = 'small text-danger'
    } else {
      this.consensusMsgTarget.textContent = ''
    }
  }

  getPoolProviderInnerHtml (poolType) {
    if (!poolType || poolType === '') {
      return '<p>N/A</p>'
    }
    const poolName = poolType === 'miningandco' ? 'miningandco.com' : poolType === 'e4pool' ? 'e4pool.com' : 'threepool.tech'
    const poolLink = poolType === 'miningandco' ? 'decred.miningandco.com' : poolType === 'e4pool' ? 'dcr.e4pool.com' : 'dcr.threepool.tech'
    const code = poolType === 'miningandco' ? 'CA' : poolType === 'e4pool' ? 'RU' : 'BR'
    return `<div class="tooltip1 me-1">
      <img src="/images/${code}_24.webp" width="24" height="24" alt="${code}" />
    </div>
    <a href="https://${poolLink}" target="_blank">
      ${poolName}
    </a>`
  }

  updateLastBlocksPools (blocksPools) {
    if (!blocksPools || blocksPools.length === 0) {
      return
    }
    let poolHtml = ''
    const _this = this
    blocksPools.forEach((pool) => {
      poolHtml += `<tr>
        <td class="text-start">
        <a data-turbolinks="false" href="/block/${pool.blockheight}"
        >${pool.blockheight}</a
    >
    </td>
    <td class="d-flex justify-content-center ai-center">
      ${_this.getPoolProviderInnerHtml(pool.poolType)}
    </td>
    <td class="text-center">
      ${pool.poolType !== '' ? pool.miner : 'N/A'}  
    </td>
    <td class="text-center">
      ${pool.poolType !== '' ? pool.minedby : 'N/A'}  
    </td>
  </tr>`
    })
    this.poolsTableTarget.innerHTML = poolHtml
  }

  _processSummary (data) {
    const summary = data.summary_info
    this.onlineNodesTarget.innerHTML = humanize.decimalParts(summary.peerCount, true, 0)
    this.totalTxsTarget.innerHTML = humanize.decimalParts(summary.total_transactions, true, 0)
    this.totalAddressesTarget.innerHTML = humanize.decimalParts(summary.total_addresses, true, 0)
    this.totalOutputsTarget.innerHTML = humanize.decimalParts(summary.total_outputs, true, 0)
    this.totalSwapsAmountTarget.innerHTML = humanize.decimalParts(summary.swapsTotalAmount / 100000000, true, 0)
    this.totalContractsTarget.innerHTML = humanize.decimalParts(summary.swapsTotalContract, true, 0)
    this.redeemCountTarget.innerHTML = humanize.decimalParts(summary.swapsTotalContract - summary.refundCount, true, 0)
    this.refundCountTarget.innerHTML = humanize.decimalParts(summary.refundCount, true, 0)
    this.bwTotalVolTarget.innerHTML = humanize.decimalParts(summary.bisonWalletVol, true, 0)
    this.last30DayBwVolTarget.innerHTML = humanize.decimalParts(summary.bwLast30DaysVol, true, 0)
    this.updateLastBlocksPools(summary.poolDataList)
    if (this.hasMissedTicketsTarget) {
      this.missedTicketsTarget.innerHTML = humanize.decimalParts(summary.ticketsSummary.missedTickets, true, 0)
      this.last1000BlocksMissedTarget.innerHTML = humanize.decimalParts(summary.ticketsSummary.last1000BlocksMissed, true, 0)
      this.ticketFeeTarget.innerHTML = humanize.decimalParts(summary.ticketsSummary.last1000BlocksTicketFeeAvg, false, 8, 5)
      this.vspTableTarget.innerHTML = this.getVspTable(summary.vspList)
    }
  }

  getVspTable (vspList) {
    if (!vspList || vspList.length <= 0) {
      return ''
    }
    let result = ''
    vspList.forEach((vsp) => {
      result += `<tr>
   <td class="text-start">
      <a data-turbolinks="false" target="_blank" href="https://${vsp.vspLink}">${vsp.vspLink}</a>
   </td>
   <td class="text-center">
      ${vsp.voting}
   </td>
   <td class="text-center">
    ${vsp.voted}
   </td>
   <td class="text-center">
    ${vsp.missed}
   </td>
   <td class="text-center">
    ${vsp.feepercentage}%
   </td>
  </tr>`
    })
    return result
  }

  // process for 24h info socket
  _process24hInfo (data) {
    const summary24h = data.summary_24h
    this.mined24hBlocksTarget.innerHTML = humanize.decimalParts(summary24h.blocks, true, 0)
    this.txs24hCountTarget.innerHTML = humanize.decimalParts(summary24h.numTx24h, true, 0)
    this.sent24hTarget.innerHTML = humanize.decimalParts(summary24h.sent24h / 1e8, true, 2)
    this.fees24hTarget.innerHTML = humanize.decimalParts(summary24h.fees24h / 1e8, true, 2)
    this.vout24hTarget.innerHTML = humanize.decimalParts(summary24h.numVout24h, true, 0)
    this.activeAddr24hTarget.innerHTML = humanize.decimalParts(summary24h.activeAddresses, true, 0)
    this.powReward24hTarget.innerHTML = humanize.decimalParts(summary24h.totalPowReward / 1e8, true, 2)
    this.supply24hTarget.innerHTML = humanize.decimalParts(summary24h.dcrSupply / 1e8, true, 2)
    this.treasuryBal24hTarget.innerHTML = `<span class="dcricon-arrow-${summary24h.treasuryBalanceChange > 0 ? 'up text-green' : 'down text-danger'}"></span>
        <span class="${summary24h.treasuryBalanceChange > 0 ? 'c-green-2' : 'c-red'}">${humanize.decimalParts(Math.abs(summary24h.treasuryBalanceChange) / 1e8, true, 2)}
        </span>`
    this.staked24hTarget.innerHTML = `<span class="dcricon-arrow-${summary24h.stakedDCR > 0 ? 'up text-green' : 'down text-danger'}"></span>
        <span class="${summary24h.stakedDCR > 0 ? 'c-green-2' : 'c-red'}">${humanize.decimalParts(Math.abs(summary24h.stakedDCR) / 1e8, true, 2)}
        </span>`
    this.tickets24hTarget.innerHTML =
      `<span class="dcricon-arrow-${summary24h.stakedDCR > 0 ? 'up text-green' : 'down text-danger'}"></span>
        <span class="${summary24h.stakedDCR > 0 ? 'c-green-2' : 'c-red'}">
        ${humanize.decimalParts(summary24h.numTickets, true, 0)}</span>`
    this.posReward24hTarget.innerHTML = humanize.decimalParts(summary24h.posReward / 1e8, true, 2)
    this.voted24hTarget.innerHTML = humanize.decimalParts(summary24h.voted, true, 0)
    this.missed24hTarget.innerHTML = humanize.decimalParts(summary24h.missed, true, 0)
    this.swapAmount24hTarget.innerHTML = humanize.decimalParts(summary24h.atomicSwapAmount / 1e8, true, 0)
    this.swapCount24hTarget.innerHTML = humanize.decimalParts(summary24h.swapRedeemCount + summary24h.swapRefundCount, true, 0)
    this.swapPartCount24hTarget.innerHTML = `${humanize.decimalParts(summary24h.swapRedeemCount, true, 0)} redemptions
    , ${humanize.decimalParts(summary24h.swapRefundCount, true, 0)} refunds`
    this.bwVol24hTarget.innerHTML = humanize.decimalParts(summary24h.bisonWalletVol, true, 0)
    if (this.exchangeRate <= 0) {
      return
    }
    if (this.hasSent24hUsdTarget) {
      this.sent24hUsdTarget.textContent = `${humanize.threeSigFigs(summary24h.sent24h / 1e8 * this.exchangeRate)} ${this.exchangeIndex}`
    }
    if (this.hasFees24hUsdTarget) {
      this.fees24hUsdTarget.textContent = `${humanize.threeSigFigs(summary24h.fees24h / 1e8 * this.exchangeRate)} ${this.exchangeIndex}`
    }
    if (this.hasPowReward24hUsdTarget) {
      this.powReward24hUsdTarget.textContent = `${humanize.threeSigFigs(summary24h.totalPowReward / 1e8 * this.exchangeRate)} ${this.exchangeIndex}`
    }
    if (this.hasSupply24hUsdTarget) {
      this.supply24hUsdTarget.textContent = `${humanize.threeSigFigs(summary24h.dcrSupply / 1e8 * this.exchangeRate)} ${this.exchangeIndex}`
    }
    if (this.hasPosReward24hUsdTarget) {
      this.posReward24hUsdTarget.textContent = `${humanize.threeSigFigs(summary24h.posReward / 1e8 * this.exchangeRate)} ${this.exchangeIndex}`
    }
    if (this.hasSwapAmount24hUsdTarget) {
      this.swapAmount24hUsdTarget.textContent = `${humanize.threeSigFigs(summary24h.atomicSwapAmount / 1e8 * this.exchangeRate)} ${this.exchangeIndex}`
    }
    if (this.hasTreasuryBal24hUsdTarget) {
      this.treasuryBal24hUsdTarget.innerHTML =
        `<span class="dcricon-arrow-${summary24h.treasuryBalanceChange > 0 ? 'up text-green' : 'down text-danger'}"></span>
      <span class="${summary24h.treasuryBalanceChange > 0 ? 'c-green-2' : 'c-red'}">
      ${humanize.threeSigFigs(summary24h.treasuryBalanceChange / 1e8 * this.exchangeRate)}</span> ${this.exchangeIndex}`
    }
  }

  _processBlock (blockData) {
    const ex = blockData.extra
    this.difficultyTarget.innerHTML = humanize.decimalParts(ex.difficulty, true, 0)
    this.bsubsidyPowTarget.innerHTML = humanize.decimalParts(ex.subsidy.pow / 100000000, false, 8, 2)
    this.bsubsidyPosTarget.innerHTML = humanize.decimalParts((ex.subsidy.pos / 500000000), false, 8, 2) // 5 votes per block (usually)
    this.bsubsidyDevTarget.innerHTML = humanize.decimalParts(ex.subsidy.dev / 100000000, false, 8, 2)
    this.tspentAmountTarget.innerHTML = humanize.decimalParts(ex.treasury_bal.spent / 100000000, true, 2, 0)
    this.tspentCountTarget.innerHTML = humanize.decimalParts(ex.treasury_bal.spend_count, true, 0) + ' spends'
    this.coinSupplyTarget.innerHTML = humanize.decimalParts(ex.coin_supply / 100000000, true, 0)
    this.mixedPctTarget.innerHTML = ex.mixed_percent.toFixed(0)
    this.blocksdiffTarget.innerHTML = humanize.decimalParts(ex.sdiff, false, 8, 2)
    this.nextExpectedSdiffTarget.innerHTML = humanize.decimalParts(ex.next_expected_sdiff, false, 2, 2)
    this.nextExpectedMinTarget.innerHTML = humanize.decimalParts(ex.next_expected_min, false, 2, 2)
    this.nextExpectedMaxTarget.innerHTML = humanize.decimalParts(ex.next_expected_max, false, 2, 2)
    this.windowIndexTarget.textContent = ex.window_idx
    this.posBarTarget.style.width = `${(ex.window_idx / ex.params.window_size) * 100}%`
    this.poolSizeTarget.innerHTML = humanize.decimalParts(ex.pool_info.size, true, 0)
    this.targetPctTarget.textContent = parseFloat(ex.pool_info.percent_target - 100).toFixed(2)
    this.rewardIdxTarget.textContent = ex.reward_idx
    this.powBarTarget.style.width = `${(ex.reward_idx / ex.params.reward_window_size) * 100}%`
    const blockRewardReduceDuration = (ex.params.reward_window_size - ex.reward_idx) * ex.params.target_block_time / 1e6
    this.rewardReduceRemainTarget.textContent = humanize.timeDuration(blockRewardReduceDuration, 'minute') + ' remaining'
    this.poolValueTarget.innerHTML = humanize.decimalParts(ex.pool_info.value, true, 0)
    this.ticketRewardTarget.innerHTML = `${ex.reward.toFixed(2)}%`
    this.poolSizePctTarget.textContent = parseFloat(ex.pool_info.percent).toFixed(2)
    this.feeAvgTarget.innerHTML = humanize.decimalParts(ex.txFeeAvg / 100000000, false, 8, 4)
    this.txFeeAvg = ex.txFeeAvg
    this.powReward = ex.subsidy.pow
    const treasuryTotal = ex.dev_fund + ex.treasury_bal.balance
    this.devFundTarget.innerHTML = humanize.decimalParts(treasuryTotal / 100000000, true, 0)
    if (ex.hash_rate > 0.001 && ex.hash_rate < 1) {
      ex.hash_rate = ex.hash_rate * 1000
    } else if (ex.hash_rate < 0.001) {
      ex.hash_rate = ex.hash_rate * 1000000
    }
    this.hashrateTarget.innerHTML = humanize.decimalParts(ex.hash_rate, false, 3, 2)
    this.hashrateDeltaTarget.innerHTML = humanize.fmtPercentage(ex.hash_rate_change_month)
    this.blockVotesTarget.dataset.hash = blockData.block.hash
    this.setVotes()
    const block = blockData.block
    this.blockHeightTarget.textContent = block.height
    this.blockHeightTarget.href = `/block/${block.hash}`
    this.blockSizeTarget.textContent = humanize.bytes(block.size)
    this.blockTotalTarget.textContent = humanize.threeSigFigs(block.total)
    this.blockchainSizeTarget.textContent = ex.formatted_size
    this.avgBlockSizeTarget.textContent = ex.formattedAvgBlockSize
    this.lastBlockTimeTarget.textContent = humanize.timeSince(block.blocktime_unix)
    this.lastBlockTimeTarget.dataset.age = block.blocktime_unix
    if (ex.exchange_rate) {
      const xcRate = ex.exchange_rate.value
      const btcIndex = ex.exchange_rate.index
      if (this.hasPowConvertedTarget) {
        this.powConvertedTarget.textContent = `${humanize.twoDecimals(ex.subsidy.pow / 1e8 * xcRate)} ${btcIndex}`
      }
      if (this.hasConvertedDevTarget) {
        this.convertedDevTarget.textContent = `${humanize.threeSigFigs(treasuryTotal / 1e8 * xcRate)} ${btcIndex}`
      }
      if (this.hasConvertedSupplyTarget) {
        this.convertedSupplyTarget.textContent = `${humanize.threeSigFigs(ex.coin_supply / 1e8 * xcRate)} ${btcIndex}`
      }
      if (this.hasConvertedDevSubTarget) {
        this.convertedDevSubTarget.textContent = `${humanize.twoDecimals(ex.subsidy.dev / 1e8 * xcRate)} ${btcIndex}`
      }
      if (this.hasConvertedStakeTarget) {
        this.convertedStakeTarget.textContent = `${humanize.twoDecimals(ex.sdiff * xcRate)} ${btcIndex}`
      }
      if (this.hasMarketCap) {
        this.hasMarketCapTarget.textContent = `${humanize.threeSigFigs(ex.coin_supply / 1e8 * xcRate)} ${btcIndex}`
      }
    }
  }
}
